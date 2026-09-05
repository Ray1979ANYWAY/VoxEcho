// ---- 微信读书 main world 脚本 ----
// 在 manifest.json 中以 world: "MAIN" 注册，run_at: document_start。
// 不受页面 CSP 限制，直接修改页面的 CanvasRenderingContext2D.prototype。
// 负责：fillText hook、字符采集、坐标索引、覆盖层高亮。
// 通过 window.postMessage 与 isolated world 的 content-weread.js 通信。

(function () {
  "use strict";

  const SOURCE = "vox-weread-main";
  const CONTENT_SOURCE = "vox-weread-content";

  let charIndex = [];       // [{canvasIdx, x, y, size, ch, scaleX, scaleY}]
  let fullText = "";
  let canvasElements = [];
  let overlays = [];
  let rebuildTimer = null;
  let pageReported = false; // 当前 charIndex 是否已上报，下一页第一个 fillText 到来时清空

  // 绘制结束后静默多久认为一页完成（防抖）
  const REBUILD_DEBOUNCE_MS = 300;

  // 缓存每个 canvas 的 scale，避免每次 fillText 都调用 getTransform()
  const canvasScaleCache = new WeakMap();

  function getContextScale(ctx, canvas) {
    let cached = canvasScaleCache.get(canvas);
    if (!cached) {
      try {
        const t = ctx.getTransform();
        cached = { scaleX: t.a || 1, scaleY: t.d || 1 };
      } catch (e) {
        cached = { scaleX: 2, scaleY: 2 }; // 微信读书默认 scale(2,2)
      }
      canvasScaleCache.set(canvas, cached);
    }
    return cached;
  }

  // 逻辑坐标（fillText 的 x/y）转 CSS 坐标比例
  // 微信读书用 ctx.scale(2,2) 绘制，逻辑宽度 = canvas.width / scaleX
  // 用 getBoundingClientRect().width 作为 CSS 宽度，与覆盖层尺寸保持一致
  function logicalToCss(canvas, scaleX) {
    const r = canvas.getBoundingClientRect();
    const logicalWidth = canvas.width / (scaleX || 2);
    return r.width / logicalWidth;
  }

  // ---------- fillText hook ----------
  function installFillTextHook() {
    const R = CanvasRenderingContext2D.prototype;
    if (R.__voxWereadHooked) return;
    R.__voxWereadHooked = true;

    const origFillText = R.fillText;
    R.fillText = function (text, x, y, maxWidth) {
      try {
        const canvas = this.canvas;
        if (!canvas) return origFillText.apply(this, arguments);

        let idx = canvasElements.indexOf(canvas);
        if (idx === -1) {
          idx = canvasElements.length;
          canvasElements.push(canvas);
          ensureOverlayFor(canvas);
        }

        // 新页检测不在此处做——改为 hook clearRect / canvas.width 重置时清空
        // （见 installFillTextHook 末尾），避免零星绘制误清完整文本

        // 防抖：持续绘制时不断重置定时器，停手 300ms 后才重建
        if (rebuildTimer) clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(function () {
          rebuildTextAndNotify();
          pageReported = true;
        }, REBUILD_DEBOUNCE_MS);

        const str = String(text);
        const size = parseFloat(((this.font || "").match(/(\d+(?:\.\d+)?)px/) || [])[1]) || 16;
        const scale = getContextScale(this, canvas);

        for (let i = 0; i < str.length; i++) {
          const ch = str[i];
          if (ch === "\n" || ch === "\r") continue;
          charIndex.push({
            canvasIdx: idx,
            x: str.length === 1 ? x : x + i * size,
            y: y,
            size: size,
            ch: ch,
            scaleX: scale.scaleX,
            scaleY: scale.scaleY,
          });
        }
      } catch (e) {
        // hook 出错不影响原绘制
      }
      return origFillText.apply(this, arguments);
    };

    console.log("[VoxEcho] fillText hook installed (debounce 300ms + clearRect/width new-page detection)");

    // hook clearRect：只清空对应 canvas 的字符，不影响另一栏
    const origClearRect = R.clearRect;
    R.clearRect = function (x, y, w, h) {
      try {
        const canvas = this.canvas;
        if (canvas) {
          const idx = canvasElements.indexOf(canvas);
          if (idx !== -1 && charIndex.some(function (c) { return c.canvasIdx === idx; })) {
            charIndex = charIndex.filter(function (c) { return c.canvasIdx !== idx; });
            if (rebuildTimer) { clearTimeout(rebuildTimer); rebuildTimer = null; }
          }
        }
      } catch (e) {}
      return origClearRect.apply(this, arguments);
    };

    // hook canvas.width 重置：只清空对应 canvas 的字符
    const canvasWidthDesc = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width");
    if (canvasWidthDesc && typeof canvasWidthDesc.set === "function") {
      const origWidthSet = canvasWidthDesc.set;
      Object.defineProperty(HTMLCanvasElement.prototype, "width", {
        set: function (v) {
          try {
            const idx = canvasElements.indexOf(this);
            if (idx !== -1 && charIndex.some(function (c) { return c.canvasIdx === idx; })) {
              charIndex = charIndex.filter(function (c) { return c.canvasIdx !== idx; });
              if (rebuildTimer) { clearTimeout(rebuildTimer); rebuildTimer = null; }
            }
          } catch (e) {}
          return origWidthSet.call(this, v);
        },
        get: canvasWidthDesc.get,
        configurable: true,
      });
    }
  }

  // ---------- 文本重建 ----------
  function rebuildTextAndNotify() {
    if (charIndex.length === 0) return;

    // 排序：canvas 水平位置（左栏在前）→ y → x
    // 用 getBoundingClientRect().left 而非 offsetLeft，布局未完成时更准；
    // 两个 canvas left 相同时用 canvasIdx 兜底，避免左右栏同一行 x 重叠导致交错。
    charIndex.sort(function (a, b) {
      const ca = canvasElements[a.canvasIdx];
      const cb = canvasElements[b.canvasIdx];
      let leftA = 0, leftB = 0;
      try { leftA = ca ? ca.getBoundingClientRect().left : a.canvasIdx; } catch (e) { leftA = a.canvasIdx; }
      try { leftB = cb ? cb.getBoundingClientRect().left : b.canvasIdx; } catch (e) { leftB = b.canvasIdx; }
      if (Math.abs(leftA - leftB) > 2) return leftA - leftB;
      if (a.canvasIdx !== b.canvasIdx) return a.canvasIdx - b.canvasIdx; // 同位置时 canvasIdx 兜底
      if (Math.abs(a.y - b.y) > 3) return a.y - b.y;
      return a.x - b.x;
    });

    fullText = charIndex.map(function (c) { return c.ch; }).join("");

    if (fullText.length > 0) {
      console.log("[VoxEcho] 重建正文 len=" + fullText.length +
        " 前20字=" + fullText.slice(0, 20) +
        " canvas数=" + canvasElements.length);
      window.postMessage({
        source: SOURCE,
        type: "chapter-updated",
        url: location.href,
        text: fullText,
        charCount: charIndex.length,
      }, "*");
    }
  }

  // ---------- 覆盖层 ----------
  function ensureOverlayFor(canvas) {
    const idx = canvasElements.indexOf(canvas);
    if (overlays[idx]) return overlays[idx];
    const parent = canvas.parentElement;
    if (!parent) return null;
    if (getComputedStyle(parent).position === "static") {
      parent.style.position = "relative";
    }
    const overlay = document.createElement("div");
    overlay.className = "vox-weread-overlay";
    overlay.style.cssText = "position:absolute;pointer-events:none;z-index:2147483647;overflow:visible;";
    function syncSize() {
      overlay.style.left = canvas.offsetLeft + "px";
      overlay.style.top = canvas.offsetTop + "px";
      overlay.style.width = canvas.offsetWidth + "px";
      overlay.style.height = canvas.offsetHeight + "px";
    }
    syncSize();
    parent.appendChild(overlay);
    overlays[idx] = { el: overlay, syncSize: syncSize };
    return overlays[idx];
  }

  function clearHighlight() {
    overlays.forEach(function (o) { if (o && o.el) o.el.innerHTML = ""; });
  }

  // ---------- 高亮 ----------
  function highlightChunk(text) {
    if (!text || charIndex.length === 0) {
      window.postMessage({ source: SOURCE, type: "highlight-miss" }, "*");
      return;
    }
    clearHighlight();

    // chunk 是从 fullText 切出来的，直接 indexOf 即可；
    // 不要用去空白后的 norm 位置去 slice charIndex，会导致索引错位。
    let pos = fullText.indexOf(text);
    if (pos === -1) {
      // 兜底：去掉首尾空白后再试
      pos = fullText.indexOf(text.trim());
    }
    if (pos === -1) {
      window.postMessage({ source: SOURCE, type: "highlight-miss" }, "*");
      return;
    }

    const endPos = Math.min(pos + text.length, charIndex.length);
    const chars = charIndex.slice(pos, endPos);
    if (chars.length === 0) {
      window.postMessage({ source: SOURCE, type: "highlight-miss" }, "*");
      return;
    }

    const groups = {};
    chars.forEach(function (c) {
      const key = c.canvasIdx + "_" + Math.round(c.y);
      if (!groups[key]) groups[key] = { canvasIdx: c.canvasIdx, y: c.y, chars: [] };
      groups[key].chars.push(c);
    });

    Object.keys(groups).forEach(function (key) {
      const g = groups[key];
      const first = g.chars[0];
      const last = g.chars[g.chars.length - 1];
      const ov = overlays[g.canvasIdx];
      const canvas = canvasElements[g.canvasIdx];
      if (!ov || !canvas) return;
      ov.syncSize();
      // fillText 的 x/y 是逻辑坐标（ctx.scale 后的坐标），
      // 用 logicalToCss 转成覆盖层的 CSS 坐标，不能直接用 canvas.width 除
      const ratio = logicalToCss(canvas, first.scaleX);
      const cssX = first.x * ratio;
      const cssW = Math.max((last.x + last.size - first.x) * ratio, 2);
      const cssY = (first.y - first.size / 2) * ratio;
      const cssH = first.size * ratio;
      const rect = document.createElement("div");
      rect.style.cssText =
        "position:absolute;left:" + cssX + "px;top:" + cssY + "px;width:" + cssW +
        "px;height:" + cssH + "px;background:rgba(255,215,0,0.2);border-radius:3px;";
      ov.el.appendChild(rect);
    });

    window.postMessage({ source: SOURCE, type: "highlight-hit" }, "*");
  }

  // ---------- 起始位置定位 ----------
  // 与 Play Books / Koodo 对齐：
  //   1. 用户拖拽选中了文字 → 从选中起点字符开始读
  //   2. 没有选中 → 从视口内第一个可见字符往后找第一个大标点，从标点后开始
  //
  // 微信读书是 canvas 渲染，window.getSelection() 拿不到 canvas 上的选区，
  // 所以用鼠标坐标 + 我们自己采集的 charIndex 坐标来反查选中起点。
  const MAJOR_PUNCT_RE = /[。！？，、；：…—～,.!?;:…—\-）\)\]\}】」』》〉"'"]/;

  let mouseDownPos = null;
  let selectionStartCharIdx = null;

  // 用视口坐标在 charIndex 里找对应字符的索引
  function findCharAtPosition(clientX, clientY) {
    for (let i = 0; i < charIndex.length; i++) {
      const c = charIndex[i];
      const canvas = canvasElements[c.canvasIdx];
      if (!canvas) continue;
      const r = canvas.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const ratio = logicalToCss(canvas, c.scaleX);
      const charLeft = r.left + c.x * ratio;
      const charRight = charLeft + c.size * ratio;
      const charTop = r.top + (c.y - c.size / 2) * ratio;
      const charBottom = charTop + c.size * ratio;
      if (clientX >= charLeft - 2 && clientX <= charRight + 2 &&
          clientY >= charTop - 2 && clientY <= charBottom + 2) {
        return i;
      }
    }
    return -1;
  }

  // 监听鼠标拖拽：mousedown 记录起点，mouseup 时如果移动距离超过阈值，
  // 认为是拖拽选中，用起点坐标定位字符。
  document.addEventListener("mousedown", function (e) {
    mouseDownPos = { x: e.clientX, y: e.clientY };
  });

  document.addEventListener("mouseup", function (e) {
    if (!mouseDownPos) return;
    const dx = e.clientX - mouseDownPos.x;
    const dy = e.clientY - mouseDownPos.y;
    if (Math.abs(dx) < 5 && Math.abs(dy) < 5) {
      mouseDownPos = null;
      return; // 纯点击，不是拖拽选中
    }
    const idx = findCharAtPosition(mouseDownPos.x, mouseDownPos.y);
    if (idx !== -1) {
      selectionStartCharIdx = idx;
      console.log("[VoxEcho] 检测到拖拽选区起点 charIdx=" + idx + " char=" + charIndex[idx].ch);
    }
    mouseDownPos = null;
  });

  // 尝试 window.getSelection()（canvas 渲染通常拿不到，但目录等 DOM 文本可能命中）
  function getSelectionStartOffset() {
    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      const selText = sel.toString().replace(/\s+/g, " ").trim();
      if (!selText || selText.length < 2) return null;
      const pos = fullText.indexOf(selText);
      if (pos !== -1) return pos;
      const short = selText.slice(0, 6);
      const pos2 = fullText.indexOf(short);
      return pos2 !== -1 ? pos2 : null;
    } catch (e) {
      return null;
    }
  }

  // 用 charIndex 坐标找视口内第一个可见字符，再往后找第一个大标点
  function findViewportSentenceStart() {
    if (charIndex.length === 0) return 0;

    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;

    let firstVisible = -1;
    for (let i = 0; i < charIndex.length; i++) {
      const c = charIndex[i];
      const canvas = canvasElements[c.canvasIdx];
      if (!canvas) continue;
      const r = canvas.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const ratio = logicalToCss(canvas, c.scaleX);
      const charTop = r.top + (c.y - c.size / 2) * ratio;
      const charLeft = r.left + c.x * ratio;
      if (charTop >= -5 && charTop < viewportH && charLeft >= -5 && charLeft < viewportW) {
        firstVisible = i;
        break;
      }
    }

    if (firstVisible === -1) return 0;

    for (let i = firstVisible; i < charIndex.length; i++) {
      if (MAJOR_PUNCT_RE.test(charIndex[i].ch)) {
        return i + 1;
      }
    }

    return firstVisible;
  }

  function getStartIndex() {
    // 优先：鼠标拖拽选中的起点
    if (selectionStartCharIdx !== null && selectionStartCharIdx > 0) {
      const offset = selectionStartCharIdx;
      selectionStartCharIdx = null; // 消费一次，避免下次还从这里开始
      return { segmentIndex: 0, charOffset: offset };
    }
    // 其次：DOM 选区（canvas 渲染通常拿不到）
    const selOffset = getSelectionStartOffset();
    if (selOffset !== null && selOffset > 0) {
      return { segmentIndex: 0, charOffset: selOffset };
    }
    // 兜底：视口首个标点后
    return { segmentIndex: 0, charOffset: findViewportSentenceStart() };
  }

  // ---------- 空页指纹 ----------
  // 只有当前页确实没有文本时才返回指纹；有文本时返回 null，
  // content script 收到 null 就不上报 background，避免误触发翻页。
  function getEmptyPageFingerprint() {
    if (fullText.length > 0 || charIndex.length > 0) {
      return null;
    }
    return {
      textLen: 0,
      canvasCount: canvasElements.length,
      scrollY: Math.round(window.scrollY || document.documentElement.scrollTop),
      url: location.href,
    };
  }

  // ---------- 监听 isolated world 指令 ----------
  window.addEventListener("message", function (event) {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.source !== CONTENT_SOURCE) return;

    switch (d.type) {
      case "highlight-chunk":
        highlightChunk(d.text);
        break;
      case "clear-highlight":
        clearHighlight();
        break;
      case "get-start-index":
        window.postMessage({ source: SOURCE, type: "start-index", result: getStartIndex() }, "*");
        break;
      case "get-empty-fingerprint":
        window.postMessage({ source: SOURCE, type: "empty-fingerprint", result: getEmptyPageFingerprint() }, "*");
        break;
      case "get-debug":
        window.postMessage({
          source: SOURCE, type: "debug",
          result: {
            hooked: !!CanvasRenderingContext2D.prototype.__voxWereadHooked,
            chars: charIndex.length,
            textLen: fullText.length,
            canvases: canvasElements.length,
          },
        }, "*");
        break;
    }
  });

  // ---------- 监听 canvas 变化 ----------
  const canvasObserver = new MutationObserver(function () {
    for (let i = canvasElements.length - 1; i >= 0; i--) {
      if (!document.body || !document.body.contains(canvasElements[i])) {
        if (overlays[i] && overlays[i].el && overlays[i].el.parentNode) {
          overlays[i].el.parentNode.removeChild(overlays[i].el);
        }
        canvasElements.splice(i, 1);
        overlays.splice(i, 1);
        charIndex.forEach(function (c) { if (c.canvasIdx > i) c.canvasIdx--; });
      }
    }
  });

  function init() {
    canvasObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
    window.addEventListener("resize", function () {
      overlays.forEach(function (o) { if (o && o.syncSize) o.syncSize(); });
    });
  }

  // hook 立即安装，不等 DOMContentLoaded
  installFillTextHook();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
