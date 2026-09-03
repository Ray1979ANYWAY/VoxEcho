// ---- Koodo Reader 内容脚本 ----
//
// 跟 content-playbooks.js 完全独立，DOM 结构、注入方式都不一样。
//
// 当前实现范围（第二阶段——提取 + 坐标定位起点 + 接入消息链路）：
//   1. 跨 iframe 边界读取正文，按标签识别
//   2. 检测"整章刷新"（跨章节），触发重新提取，推送给 background
//   3. 坐标定位：判断当前视口内显示的是整章文字里的哪一段，用作朗读起点
// 还没做的部分（下一阶段）：
//   - 自动翻页跟随朗读进度（这需要先验证"怎么用代码触发翻页"这件事，
//     目前完全没有验证过，所以先不做，留到朗读能跑通之后再单独攻克）
//
// 已确认的关键约束：
//   - 正文装在 <iframe id="kookit-iframe">，src 是 about:blank，不能往它
//     内部注入脚本（sandbox 没开 allow-scripts），只能从顶层页面跨边界
//     读取 contentDocument（sandbox 开了 allow-same-origin，读取是被允许的）
//   - 翻页不改变 DOM：整章内容用 CSS 多栏布局一次性渲染，只有跨章节才会
//     整体刷新

(function () {
  function safeSendMessage(msg) {
    try {
      chrome.runtime.sendMessage(msg);
    } catch (e) {
      // 忽略：扩展上下文失效（重新加载扩展后旧页面还没刷新），等页面刷新后自愈
    }
  }

  function diagLog(message, data) {
    safeSendMessage({ type: "DIAG_LOG", source: "content-koodo", message, data });
  }

  const IFRAME_SELECTOR = "iframe#kookit-iframe";
  const SELECTOR = "p, h1, h2, h3, h4, h5, h6";

  // 跟 content-playbooks.js 里 TERMINAL_PUNCTUATION 同一份规则：判断一段文字
  // 是不是"正常收尾"，用来识别口号式短段落（不以标点结尾的短行当 heading 处理）。
  const TERMINAL_PUNCTUATION = /[。！？…—」』）)\]"'".!?;:''"]$/;
  const SHORT_LINE_MAX = 20;

  function pushParagraph(result, seen, el) {
    if (seen.has(el)) return false;
    seen.add(el);

    const text = el.textContent.replace(/\s+/g, " ").trim();
    if (!text) return false;

    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      result.push({ type: "heading", level: Number(tag[1]), text });
      return true;
    }

    const isShortNopunct = !TERMINAL_PUNCTUATION.test(text) && Array.from(text).length <= SHORT_LINE_MAX;
    result.push({ type: isShortNopunct ? "heading" : "body", text });
    return true;
  }

  // 找到当前可访问的 iframe contentDocument。iframe 可能还没加载出来，
  // 或者这次找到的跟上次是同一个（没有变化）——调用方自己判断变没变。
  function getIframeDocument() {
    const iframe = document.querySelector(IFRAME_SELECTOR);
    if (!iframe) return null;
    try {
      // 跨边界访问：只要 sandbox 开了 allow-same-origin 就不会抛出跨域错误；
      // 如果哪天页面结构变了导致这里抛错，用 try/catch 兜住，不让整个脚本挂掉。
      return iframe.contentDocument || null;
    } catch (e) {
      return null;
    }
  }

  // 返回 { data, elements, doc }：
  //   data —— 跟 content-playbooks.js 一致的 {type, text} 数组
  //   elements —— data 每一项对应的 DOM 元素（顺序严格对齐），用于坐标定位
  //   doc —— iframe 内部的 document，坐标定位时要用它的视口尺寸
  function extractChapterText() {
    const doc = getIframeDocument();
    if (!doc || !doc.body) return null;

    const seen = new Set();
    const data = [];
    const elements = [];
    doc.body.querySelectorAll(SELECTOR).forEach((el) => {
      if (pushParagraph(data, seen, el)) elements.push(el);
    });

    return data.length > 0 ? { data, elements, doc } : null;
  }

  // 在候选段落内部定位"当前视口内可见文字范围里，第一个大标点之后"的
  // 字符偏移——找到了返回具体偏移；这个段落视口内可见部分自始至终没有
  // 大标点（比如只显示了半句就翻页了），返回 null，让调用方去检查下一个
  // 候选段落（继续往后找，因为下一个候选段落如果也跟视口重叠，大概率是
  // 从它自己的开头就开始显示了）。
  //
  // 做法：用 Range API 逐字测量实际渲染坐标——先大步长粗扫找到大致落入
  // 视口的范围，再逐字精细回退找到真正的起点，然后从起点继续往后逐字
  // 扫描，边扫边判断字符是否还在视口内，一旦遇到大标点就返回；如果先
  // 扫出了视口范围（说明这段可见文字里没有大标点），返回 null。
  //
  // 不用二分查找（假设字符位置到渲染坐标单调递增）——如果这个段落内部的
  // 文字本身也被 CSS 多栏布局拆到了不止一栏渲染（完全可能，多栏布局是对
  // 整个容器统一排版，不会因为文字属于同一个 <p> 就被限制在一栏内），
  // 字符位置到坐标的映射会有跳跃、不是单调的，二分查找会给出错误结果。
  const STEP = 8; // 粗扫步长——先隔几个字测一次，缩小范围，再逐字精细定位
  // 任意标点都算分界：句号/问号/叹号，以及逗号、顿号、分号、冒号、
  // 省略号、破折号，还有各类右括号/右引号（中英文都覆盖）。
  // 从这些标点之后开始念，避免从视口内半截词语中间起读。
  const MAJOR_PUNCT_RE = /[。！？，、；：…—～,.!?;:…—\-）\)\]\}】」』》〉"'"]/;

  function findSentenceStartInViewport(el, doc) {
    const view = doc.defaultView;
    if (!view) return null;

    const rawText = el.textContent;
    const len = rawText.length;
    if (len === 0) return null;

    // Range 只能操作具体的文本节点，不能直接对 <p> 元素本身定位——
    // 用 TreeWalker 把这个元素内部所有文本节点和累计字符偏移列出来。
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    let combined = 0;
    let node;
    while ((node = walker.nextNode())) {
      textNodes.push({ node, start: combined, length: node.textContent.length });
      combined += node.textContent.length;
    }
    if (textNodes.length === 0) return null;

    function rectAt(charIndex) {
      for (const tn of textNodes) {
        if (charIndex >= tn.start && charIndex < tn.start + tn.length) {
          const range = doc.createRange();
          const offset = charIndex - tn.start;
          range.setStart(tn.node, offset);
          range.setEnd(tn.node, offset + 1);
          const rects = range.getClientRects();
          return rects.length > 0 ? rects[0] : null;
        }
      }
      return null;
    }

    function inViewport(rect) {
      return rect && rect.left >= 0 && rect.left < view.innerWidth && rect.top >= 0 && rect.top < view.innerHeight;
    }

    // 大步长粗扫，找到第一个落入视口附近的位置
    let coarseHit = -1;
    for (let i = 0; i < len; i += STEP) {
      if (inViewport(rectAt(i))) {
        coarseHit = i;
        break;
      }
    }
    if (coarseHit === -1) return null; // 这段完全不在视口内

    // 从粗扫命中点往前，逐字符精细回退，找到真正第一个落入视口的字符
    let fineHit = coarseHit;
    for (let i = Math.max(0, coarseHit - STEP); i < coarseHit; i++) {
      if (inViewport(rectAt(i))) {
        fineHit = i;
        break;
      }
    }

    // 从命中位置继续往后扫描，边扫边判断是否还在视口内，遇到大标点就返回；
    // 先扫出了视口范围（这段可见文字里没有大标点）就返回 null。
    let rawOffset = null;
    for (let i = fineHit; i < len; i++) {
      const rect = rectAt(i);
      if (!inViewport(rect)) break; // 已经扫出当前页可见范围
      if (MAJOR_PUNCT_RE.test(rawText[i])) {
        rawOffset = i + 1;
        break;
      }
    }
    if (rawOffset === null) return null;

    // 提取阶段用的是规范化后的文本（连续空白压缩成一个空格、首尾去空白），
    // 这里算出的 rawOffset 是基于原始 el.textContent 的偏移，两者字符
    // 位置不完全对应，需要转换成规范化文本里的偏移，才能正确地在
    // extracted.data[i].text 上做 slice。
    const rawPrefix = rawText.slice(0, rawOffset);
    const normalizedPrefix = rawPrefix.replace(/\s+/g, " ").trimStart();
    return normalizedPrefix.length;
  }

  // 找到当前视口里第一个完整句子的起点，返回 { segmentIndex, charOffset }。
  //
  // 段落级别的候选定位试过两种更"精确"的方法都失败了，记录一下排除过程：
  //   1. 判断段落外接矩形是否跟视口相交——多栏布局下，一个很长的 <p> 标签
  //      内容会被浏览器自动断开渲染到好几栏里，getBoundingClientRect() 
  //      返回的是包住所有分裂部分的最小外接矩形，会横跨好几个视觉页面，
  //      导致早就翻过去的内容也被误判成"可见"。
  //   2. 用 caretRangeFromPoint 在某个采样点精确定位——试了 iframe 左上角、
  //      也试了去找 #page-area 容器再取它范围内的点，都不准。根源是我们
  //      对 Koodo 内部真正的坐标系统、容器层级缺乏可靠信息（#page-area 
  //      实际上是包裹 iframe 的外层容器，属于顶层文档，不在 iframe 内部，
  //      两者是不同的坐标系，贸然去 iframe 内部找它必然找不到；就算改成去
  //      顶层文档找，还需要做跨坐标系换算，继续在这条路上摸索、不断根据
  //      猜测调整，性价比很低）。
  //
  // 现在的做法：把所有跟视口 [0, viewportWidth] 有横向重叠的段落都当作
  // 候选（不再只取"重叠最大"的那一个）——用户反馈过：如果当前页顶部还
  // 残留着上一段落的收尾文字（哪怕只占一两行），应该优先从这部分文字里的
  // 下一个完整句子开始念，而不是跳过它、直接从"占据页面主体的那个新段落"
  // 开始（原来只取重叠最大的那一个段落，等于完全忽略了视口内其它段落的
  // 可见内容）。按正文顺序（对应阅读顺序）依次检查每个候选段落，在每个
  // 段落"视口内可见的那部分文字"里找标点——找到了就停，找不到就顺移到
  // 下一个候选段落继续找。
  function findVisibleStartIndex(extracted) {
    const doc = extracted.doc;
    const view = doc.defaultView;
    if (!view) return { segmentIndex: 0, charOffset: 0 };

    const viewportWidth = view.innerWidth;
    const candidates = [];
    let bestFallbackIndex = 0;
    let bestFallbackOverlap = -1;

    const geometry = extracted.elements.map((el, i) => {
      const rect = el.getBoundingClientRect();
      const overlap = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
      if (overlap > 0) candidates.push(i);
      if (overlap > bestFallbackOverlap) {
        bestFallbackOverlap = overlap;
        bestFallbackIndex = i;
      }
      return {
        i,
        text: extracted.data[i].text.slice(0, 10),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        overlap: Math.round(overlap),
      };
    });

    candidates.sort((a, b) => a - b); // 按正文顺序排列，对应阅读顺序

    for (const idx of candidates) {
      if (extracted.data[idx].type !== "body") {
        // heading 通常很短，不会跨页，不用找标点，直接作为起点
        diagLog(`坐标定位选中 segmentIndex=${idx}, charOffset=0（heading）`, { viewportWidth, geometry });
        return { segmentIndex: idx, charOffset: 0 };
      }
      const el = extracted.elements[idx];
      const found = findSentenceStartInViewport(el, doc);
      if (found !== null) {
        diagLog(`坐标定位选中 segmentIndex=${idx}, charOffset=${found}`, {
          viewportWidth,
          segmentTextPreview: extracted.data[idx].text.slice(found, found + 20),
          geometry,
        });
        return { segmentIndex: idx, charOffset: found };
      }
    }

    // 兜底：所有候选段落视口内可见部分都没找到大标点（比如整页文字是一句
    // 很长、没有句号的话），退回用重叠宽度最大的段落，从它的开头开始。
    diagLog(`所有候选段落都没找到视口内的大标点，兜底选 segmentIndex=${bestFallbackIndex}`, {
      viewportWidth,
      geometry,
    });
    return { segmentIndex: bestFallbackIndex, charOffset: 0 };
  }

  let lastReportedText = null;
  let bodyObserver = null;
  let currentDoc = null;

  // ---- 高亮当前朗读块 ----
  // 比 content-playbooks.js 简单：Koodo 整章内容一次性都在同一个 body 里，
  // 翻页只是视觉上位移切换显示哪一栏，不涉及内容增减，所以搜索范围直接是
  // 整个 iframe 的 body，不需要像 Play Books 那样处理"哪些是当前真正显示、
  // 哪些是预加载不可见"的过滤。高亮标记插入到正确的 DOM 位置后也不需要
  // 额外做滚动跟随——翻页翻到哪一栏，高亮自然出现在那一栏里，用户正好能
  // 用肉眼判断"朗读进度有没有超出当前显示范围、该翻页了"。

  let currentHighlightMarks = [];

  function clearHighlight() {
    for (const mark of currentHighlightMarks) {
      const parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    }
    currentHighlightMarks = [];
  }

  // 用整段 chunk 文字在 body 里定位，拆成多个不跨元素的小 Range 分别高亮——
  // 跟 content-playbooks.js 里验证过的思路一致：完整匹配优先，匹配失败就
  // 逐步缩短容错；surroundContents 只能处理"起点终点落在同一父节点"的范围，
  // 拆成多段各自限定在单一文本节点内，避免跨段落导致整体失败。
  const MIN_MATCH_LEN = 6;

  function findRangesForText(doc, searchText) {
    const fullText = searchText.replace(/\s+/g, " ").trim();
    if (!fullText || !doc.body) return [];

    const textNodes = [];
    let combined = "";
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      textNodes.push({ node, start: combined.length });
      combined += node.textContent;
    }

    const normalizedCombined = combined.replace(/\s+/g, " ");

    let matchLen = fullText.length;
    let idx = -1;
    let searchStr = fullText;
    while (matchLen >= MIN_MATCH_LEN) {
      searchStr = fullText.slice(0, matchLen);
      idx = normalizedCombined.indexOf(searchStr);
      if (idx !== -1) break;
      matchLen = Math.floor(matchLen * 0.75);
    }
    if (idx === -1) return [];

    let foundIdx = combined.indexOf(searchStr);
    if (foundIdx === -1) foundIdx = idx;

    let startNodeIdx = -1, startOffset = 0;
    for (let i = textNodes.length - 1; i >= 0; i--) {
      if (textNodes[i].start <= foundIdx) {
        startNodeIdx = i;
        startOffset = foundIdx - textNodes[i].start;
        break;
      }
    }
    if (startNodeIdx === -1) return [];

    const ranges = [];
    let remaining = fullText.length;
    let curOffset = startOffset;
    for (let ti = startNodeIdx; ti < textNodes.length && remaining > 0; ti++) {
      const tn = textNodes[ti].node;
      const available = tn.textContent.length - curOffset;
      const take = Math.min(available, remaining);
      if (take > 0) {
        const segmentText = tn.textContent.slice(curOffset, curOffset + take);
        if (segmentText.trim().length > 0) {
          try {
            const r = doc.createRange();
            r.setStart(tn, curOffset);
            r.setEnd(tn, curOffset + take);
            ranges.push(r);
          } catch (e) {
            // 跳过这一小段，不影响其他段落继续
          }
        }
      }
      remaining -= take;
      curOffset = 0;
    }
    return ranges;
  }

  // ---- 自动翻页跟随 ----
  function simulateNextPageKey() {
    const iframe = document.querySelector(IFRAME_SELECTOR);
    const doc = iframe && iframe.contentDocument;
    if (!doc) {
      diagLog("自动翻页失败：拿不到 kookit-iframe");
      return;
    }
    doc.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 120,
        deltaX: 0,
        deltaMode: 0,
        bubbles: true,
        cancelable: true,
      })
    );
  }

  function simulateNextChapter() {
    const btn = document.querySelector(".next-chapter");
    if (btn) {
      btn.click();
      diagLog("已点击 .next-chapter 切章");
      return;
    }
    diagLog("找不到 .next-chapter，切章失败");
  }

  const OVERFLOW_TURN_RATIO = 0.45;
  const AUTO_TURN_MAX_ATTEMPTS = 5;
  const AUTO_TURN_CHECK_DELAY_MS = 1100;

  function classifyHighlight(doc) {
    const view = doc.defaultView;
    if (!view || currentHighlightMarks.length === 0) {
      return { anyVisible: false, overflowRatio: 0 };
    }
    const W = view.innerWidth;
    const H = view.innerHeight;
    let visibleArea = 0;
    let pastArea = 0;

    for (const mark of currentHighlightMarks) {
      if (!mark.isConnected) continue;
      for (const rect of mark.getClientRects()) {
        if (rect.width <= 0 || rect.height <= 0) continue;
        const area = rect.width * rect.height;
        const inX = rect.right > 0 && rect.left < W;
        const inY = rect.bottom > 0 && rect.top < H;
        if (inX && inY) visibleArea += area;
        if (rect.left >= W - 1 || rect.top >= H - 1 || (rect.right > W + 8 && inY)) {
          pastArea += area;
        }
      }
    }
    const overflowRatio = pastArea / (visibleArea + pastArea || 1);
    return { anyVisible: visibleArea > 0, overflowRatio };
  }

let isTurningPage = false; // 翻页状态锁：防止动画与渲染未完成时重复触发

function ensureHighlightVisible(doc) {
  // 1. 正在翻页冷却中，直接跳过，防止动画未完成时排队触发
  if (isTurningPage) return;

  // 2. 高亮未命中（DOM未渲染或网络卡顿数据未到达），严禁翻页！直接返回
  if (!currentHighlightMarks || currentHighlightMarks.length === 0) return;

  const { anyVisible, overflowRatio } = classifyHighlight(doc);

  // 3. 高亮已经在视口内，且没有大面积右侧溢出，正常阅读，不翻页
  if (anyVisible && overflowRatio < OVERFLOW_TURN_RATIO) return;

  // 4. 仅当高亮确实存在、且确信它在屏幕右侧溢出时才触发单次翻页
  if (overflowRatio >= OVERFLOW_TURN_RATIO) {
    diagLog(`高亮溢出视口，执行翻页 overflow=${overflowRatio.toFixed(2)}`);
    
    isTurningPage = true;
    simulateNextPageKey();

    // 留出 800ms 冷却时间（兼容翻页动画与网络延迟），期间拒绝任何翻页指令
    setTimeout(() => {
      isTurningPage = false;
      // 冷却结束后重新校验一次，若高亮跨多栏仍未落入视口，再补翻一次
      if (currentDoc) {
        const checkAgain = classifyHighlight(currentDoc);
        if (!checkAgain.anyVisible || checkAgain.overflowRatio >= OVERFLOW_TURN_RATIO) {
          ensureHighlightVisible(currentDoc);
        }
      }
    }, 800);
  }
}

let highlightDebounceTimer = null;

function highlightChunk(text) {
  const doc = currentDoc;
  if (!doc) return;

  // 网络恢复时可能短时间内连续发来多个 Chunk，轻量防抖，只高亮最新的文本
  if (highlightDebounceTimer) clearTimeout(highlightDebounceTimer);

  highlightDebounceTimer = setTimeout(() => {
    if (bodyObserver) bodyObserver.disconnect();
    try {
      clearHighlight();
      if (!text) return;

      const ranges = findRangesForText(doc, text);
      for (const range of ranges) {
        try {
          const mark = doc.createElement("mark");
          mark.style.cssText = [
            "background: rgba(255, 200, 0, 0.45)",
            "color: inherit",
            "border-radius: 3px",
            "padding: 0 1px",
          ].join(";");
          range.surroundContents(mark);
          currentHighlightMarks.push(mark);
        } catch (e) {}
      }
      ensureHighlightVisible(doc);
    } catch (e) {
    } finally {
      if (doc.body) watchIframeBody(doc);
    }
  }, 50);
}

  function reportIfChanged() {
    const extracted = extractChapterText();
    if (!extracted) return;

    const serialized = JSON.stringify(extracted.data);
    if (serialized === lastReportedText) return;
    lastReportedText = serialized;

    diagLog(`提取到整章 ${extracted.data.length} 段`, {
      preview: extracted.data.slice(0, 3).map((d) => d.text.slice(0, 15)),
    });

    safeSendMessage({
      type: "KOODO_CHAPTER_UPDATED",
      url: location.href,
      data: extracted.data,
    });
  }

  function watchIframeBody(doc) {
    if (bodyObserver) bodyObserver.disconnect();
    bodyObserver = new MutationObserver(() => {
      clearTimeout(window.__koodoExtractDebounce);
      window.__koodoExtractDebounce = setTimeout(reportIfChanged, 300);
    });
    bodyObserver.observe(doc.body, { childList: true, subtree: true, characterData: true });
  }

  function pollForIframe() {
    const doc = getIframeDocument();
    if (doc && doc.body && doc !== currentDoc) {
      currentDoc = doc;
      diagLog("找到 kookit-iframe，开始监听内容变化");
      watchIframeBody(doc);
      attachIframeKeyListener(doc);
      reportIfChanged();
    } else if (doc) {
      attachIframeKeyListener(doc);
    }
  }

  setInterval(pollForIframe, 1000);
  pollForIframe();

  // 暂停/继续：主键盘 . 和小键盘 . 都触发。
  // 只在页面本身有焦点时生效，输入框/可编辑区域里按 . 不拦截。
  // Koodo 正文在 iframe 里，焦点常在 iframe 内，顶层和 iframe 的 document/window 都挂监听。
  // 主键盘 . 在中文输入法下有时 key 会变成 "。" / keyCode 229，所以同时认 code / key / keyCode。
  function isTypingTarget(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function isPeriodKey(e) {
    if (e.code === "Period" || e.code === "NumpadDecimal") return true;
    if (e.key === "." || e.key === "。" || e.key === "．") return true;
    // 190 = 主键盘 . ，110 = 小键盘 .
    const kc = e.keyCode || e.which;
    if (kc === 190 || kc === 110) return true;
    return false;
  }

  let lastToggleAt = 0;
  function onTogglePeriodKey(e) {
    if (!isPeriodKey(e)) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;

    const now = Date.now();
    if (now - lastToggleAt < 400) return; // 防抖：keydown+keyup、顶层+iframe 可能连发
    lastToggleAt = now;

    try {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
    } catch (_) {}

    diagLog("快捷键 . 触发暂停/继续", { code: e.code, key: e.key, keyCode: e.keyCode, type: e.type });
    safeSendMessage({ type: "TOGGLE_PLAYBACK" });
  }

  function bindToggleKeys(target) {
    if (!target || target.__koodoToggleBound) return;
    target.__koodoToggleBound = true;
    // keydown 优先；若页面在 keydown 里拦截了主键盘 .，keyup 仍可能收到
    target.addEventListener("keydown", onTogglePeriodKey, true);
    target.addEventListener("keyup", onTogglePeriodKey, true);
  }

  bindToggleKeys(document);
  bindToggleKeys(window);

  function attachIframeKeyListener(doc) {
    if (!doc) return;
    bindToggleKeys(doc);
    try {
      if (doc.defaultView) bindToggleKeys(doc.defaultView);
    } catch (_) {}
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "KOODO_GET_START_INDEX") {
      const extracted = extractChapterText();
      const result = extracted ? findVisibleStartIndex(extracted) : { segmentIndex: 0, charOffset: 0 };
      diagLog(`回应起点查询：segmentIndex=${result.segmentIndex}, charOffset=${result.charOffset}`);
      sendResponse(result);
      return true;
    }
    if (message.type === "HIGHLIGHT_CHUNK") {
      highlightChunk(message.text);
    }
    if (message.type === "KOODO_NEXT_CHAPTER") {
      simulateNextChapter();
    }
  });
})();