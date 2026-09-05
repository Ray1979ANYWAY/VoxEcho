// ---- 微信读书 (weread.qq.com) 平台专属的朗读逻辑 ----
//
// 基于 background-koodo.js 改写：整章内容通过 content-weread.js 的 fillText hook
// 一次性采集完成（不是分批异步到达），所以复用 Koodo 的"整章缓存 + 一次性切块"
// 状态机。差异仅在消息名、storage key、空页指纹字段（weread 无 imgCount/imgSrcs）。
//
// 防跳页经验（从 Koodo 沉淀，全部保留）：
//   1. 空页上报校验来源 tab
//   2. 切章超时句柄化（armNextChapterTimeout / clearNextChapterTimeout）
//   3. 空页翻页重置切章超时
//   4. 提取到有文本章节时重置空页状态
//   5. content 空页上报加 __hasEverMatched 守卫（在 content 侧）
//   6. stop/start 朗读广播停空页定时器
//   7. 空页与高亮未命中翻页互斥
//   8. 空页书尾判断：MAX_EMPTY_STALL=4，指纹无变化→停滞+1

import { logEvent, textPreview } from "./diagnostics.js";
import { chunkTextByWords, endsWithAnyPunctuation } from "./chunking.js";
import { sendToOffscreen } from "./offscreen-client.js";

// ---- 章节内容缓存：每个 tabId 存一份最新采集到的整章数据 ----
function chapterKey(tabId) {
  return `wereadChapter:${tabId}`;
}

async function saveChapterForTab(tabId, url, data) {
  await chrome.storage.session.set({
    [chapterKey(tabId)]: { url, data, updatedAt: Date.now() },
  });
}

async function getChapterForTab(tabId) {
  const result = await chrome.storage.session.get(chapterKey(tabId));
  return result[chapterKey(tabId)] || null;
}

// ---- 朗读状态：独立存储 ----
const WEREAD_STATE_KEY = "wereadReadingState";

const DEFAULT_STATE = {
  isReading: false,
  isPaused: false,
  tabId: null,
  voice: null,
  rate: 1,
  connectionStatus: "idle",
  waitingForNextChapter: false,
  highlightMissStreak: 0,
  pageTurnStreak: 0,
  emptyPageStallCount: 0,
  emptyLastFingerprint: null,
  emptyLastTurnAt: 0,
  pendingTrailingText: null, // 页尾非终结标点的半句，翻页后与下一页开头合并
};

const MAX_MISS_BEFORE_TURN = 3;
const MAX_PAGE_TURNS = 3;
const MAX_EMPTY_STALL = 4;
const EMPTY_TURN_INTERVAL_MS = 1200;

let nextChapterTimeoutHandle = null;
const MAX_NEXT_CHAPTER_WAIT_MS = 8000;

function clearNextChapterTimeout() {
  if (nextChapterTimeoutHandle) {
    clearTimeout(nextChapterTimeoutHandle);
    nextChapterTimeoutHandle = null;
  }
}

function armNextChapterTimeout(tabId) {
  clearNextChapterTimeout();
  nextChapterTimeoutHandle = setTimeout(async () => {
    const s = await getReadingState();
    if (s.isReading && s.waitingForNextChapter && s.tabId === tabId) {
      logEvent("background", "[weread] 没有等到下一章（可能已是最后一章），停止朗读");
      await stopReading();
    }
  }, MAX_NEXT_CHAPTER_WAIT_MS);
}

async function getReadingState() {
  const result = await chrome.storage.session.get(WEREAD_STATE_KEY);
  return { ...DEFAULT_STATE, ...(result[WEREAD_STATE_KEY] || {}) };
}

async function setReadingState(patch) {
  const current = await getReadingState();
  const next = { ...current, ...patch };
  await chrome.storage.session.set({ [WEREAD_STATE_KEY]: next });
  return next;
}

// ---- 切块 ----
function buildChunksFromChapterData(items) {
  const chunks = [];
  let bodyBuffer = "";

  function flushBodyBuffer() {
    if (!bodyBuffer) return;
    const { chunks: pieces, trailing } = chunkTextByWords(bodyBuffer);
    chunks.push(...pieces);
    if (trailing) chunks.push(trailing);
    bodyBuffer = "";
  }

  for (const item of items) {
    if (item.type === "heading") {
      flushBodyBuffer();
      chunks.push(item.text);
    } else {
      bodyBuffer += item.text;
    }
  }
  flushBodyBuffer();
  return chunks;
}

// ---- 开始朗读 ----
// prefixText: 上一页页尾缓存的半句（非终结标点结尾），与当前页文本拼接后再切块，
// 实现"页尾一小段放到下一个 chunk 一起读"，避免句子在翻页处被断开。
async function startReading(tabId, voice, rate, { fromStart = false, prefixText = "" } = {}) {
  clearNextChapterTimeout();
  let charOffset = 0;

  if (!fromStart) {
    try {
      const result = await chrome.tabs.sendMessage(tabId, { type: "WEREAD_GET_START_INDEX" });
      if (result) {
        if (typeof result.segmentIndex === "number") charOffset = result.segmentIndex;
        if (typeof result.charOffset === "number") charOffset = result.charOffset;
      }
    } catch (e) {
      logEvent("background", `[weread] 查询起始位置失败，从头开始朗读: ${e.message}`);
    }
  }

  const chapter = await getChapterForTab(tabId);
  if (!chapter || !chapter.data || chapter.data.length === 0) {
    return { ok: false, error: "还没有采集到章节内容，请翻一页触发重绘后再试" };
  }

  // 拼接全文：上一页尾部（prefixText）+ 当前页文本，然后从 charOffset 截取
  let fullText = (prefixText || "") + chapter.data.map((d) => d.text).join("");
  fullText = fullText.slice(charOffset);

  const { chunks, trailing } = chunkTextByWords(fullText);
  const allChunks = chunks.slice();
  if (trailing) allChunks.push(trailing);

  if (allChunks.length === 0) {
    return { ok: false, error: "没有可朗读的内容" };
  }

  // 页尾断句：如果最后一个 chunk 不以终结标点结尾，缓存到下一页合并，
  // 不加入当前播放队列（避免半句被单独读完后断开）。
  let pendingTrailing = null;
  if (allChunks.length > 1 && !endsWithAnyPunctuation(allChunks[allChunks.length - 1])) {
    pendingTrailing = allChunks.pop();
  }

  logEvent(
    "background",
    `[weread] 开始朗读，charOffset=${charOffset}, 共 ${allChunks.length} 块` +
      (pendingTrailing ? `，页尾待合并 ${pendingTrailing.length} 字` : ""),
    { preview: allChunks.slice(0, 3).map((c) => textPreview(c, 12)) }
  );

  try {
    await sendToOffscreen({ type: "OFFSCREEN_PLAY", chunks: allChunks, voice, rate });
  } catch (e) {
    return { ok: false, error: `无法连接朗读播放器：${e.message}` };
  }

  await setReadingState({
    isReading: true,
    isPaused: false,
    tabId,
    voice,
    rate,
    connectionStatus: "ok",
    waitingForNextChapter: false,
    highlightMissStreak: 0,
    pageTurnStreak: 0,
    emptyPageStallCount: 0,
    emptyLastFingerprint: null,
    emptyLastTurnAt: 0,
    pendingTrailingText: pendingTrailing,
  });

  chrome.tabs.sendMessage(tabId, { type: "WEREAD_START_READING" }).catch(() => {});
  return { ok: true };
}

async function stopReading() {
  clearNextChapterTimeout();
  const prev = await getReadingState();
  if (prev.tabId) {
    chrome.tabs.sendMessage(prev.tabId, { type: "WEREAD_STOP_READING" }).catch(() => {});
  }
  await setReadingState({ ...DEFAULT_STATE });
  sendToOffscreen({ type: "OFFSCREEN_STOP" }, 1).catch(() => {});
}

async function pauseReading() {
  await setReadingState({ isPaused: true });
  sendToOffscreen({ type: "OFFSCREEN_PAUSE" }, 1).catch(() => {});
}

async function resumeReading() {
  await setReadingState({ isPaused: false });
  sendToOffscreen({ type: "OFFSCREEN_RESUME" }, 1).catch(() => {});
}

async function setRateLive(rate) {
  const state = await setReadingState({ rate });
  if (state.isReading) {
    sendToOffscreen({ type: "OFFSCREEN_SET_RATE", rate }, 1).catch(() => {});
  }
}

// ---- 消息分发 ----
export function handleWereadMessage(message, sender, sendResponse) {
  switch (message.type) {
    case "WEREAD_CHAPTER_UPDATED": {
      if (!sender.tab) return;
      (async () => {
        await saveChapterForTab(sender.tab.id, message.url, message.data);
        const state = await getReadingState();
        if (state.tabId === sender.tab.id && message.data && message.data.length > 0) {
          if (state.emptyLastFingerprint || state.emptyPageStallCount) {
            logEvent("background", "[weread] 采集到有文本章节，重置空页翻页状态");
            await setReadingState({ emptyPageStallCount: 0, emptyLastFingerprint: null });
          }
        }
        if (
          state.isReading &&
          state.waitingForNextChapter &&
          state.tabId === sender.tab.id &&
          message.data &&
          message.data.length > 0
        ) {
          if (state.pendingTrailingText) {
            logEvent("background", `[weread] 下一章已采集，合并页尾 ${state.pendingTrailingText.length} 字后继续朗读`);
            await startReading(sender.tab.id, state.voice, state.rate, {
              fromStart: true,
              prefixText: state.pendingTrailingText,
            });
          } else {
            logEvent("background", `[weread] 下一章已采集 ${message.data.length} 段，从章首继续朗读`);
            await startReading(sender.tab.id, state.voice, state.rate, { fromStart: true });
          }
        }
      })();
      return;
    }

    case "GET_LATEST_FOR_ACTIVE_TAB": {
      (async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const chapter = tab ? await getChapterForTab(tab.id) : null;
        sendResponse(chapter);
      })();
      return true;
    }

    case "START_READING": {
      (async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) {
          sendResponse({ ok: false, error: "找不到当前标签页" });
          return;
        }
        const result = await startReading(tab.id, message.voice, message.rate);
        sendResponse(result);
      })();
      return true;
    }

    case "STOP_READING": {
      stopReading().then(() => sendResponse({ ok: true }));
      return true;
    }

    case "PAUSE_READING": {
      pauseReading().then(() => sendResponse({ ok: true }));
      return true;
    }

    case "RESUME_READING": {
      resumeReading().then(() => sendResponse({ ok: true }));
      return true;
    }

    case "TOGGLE_PLAYBACK": {
      (async () => {
        const state = await getReadingState();
        if (!state.isReading) {
          logEvent("background", "[weread] TOGGLE_PLAYBACK：当前未在朗读，忽略");
          return;
        }
        if (state.isPaused) {
          logEvent("background", "[weread] TOGGLE_PLAYBACK：继续朗读");
          await resumeReading();
        } else {
          logEvent("background", "[weread] TOGGLE_PLAYBACK：暂停朗读");
          await pauseReading();
        }
      })();
      return;
    }

    case "SET_RATE": {
      setRateLive(message.rate).then(() => sendResponse({ ok: true }));
      return true;
    }

    case "GET_READING_STATE": {
      (async () => {
        const state = await getReadingState();
        if (state.isReading) {
          const contexts = await chrome.runtime.getContexts({
            contextTypes: ["OFFSCREEN_DOCUMENT"],
          });
          if (contexts.length === 0) {
            const reset = await setReadingState({ ...DEFAULT_STATE });
            sendResponse(reset);
            return;
          }
        }
        sendResponse(state);
      })();
      return true;
    }

    case "SEEK": {
      sendToOffscreen({ type: "OFFSCREEN_SEEK", delta: message.delta }, 1).catch(() => {});
      return;
    }

    case "WEREAD_EMPTY_PAGE": {
      (async () => {
        const state = await getReadingState();
        if (!state.isReading || !state.tabId) return;
        // 校验来源 tab
        if (sender.tab && sender.tab.id !== state.tabId) return;
        const now = Date.now();
        if (now - (state.emptyLastTurnAt || 0) < EMPTY_TURN_INTERVAL_MS) return;
        const fp = message.fingerprint || null;
        const last = state.emptyLastFingerprint || null;
        // weread 指纹：textLen / canvasCount / scrollY / url（无 imgCount/imgSrcs）
        const same =
          last &&
          fp &&
          fp.textLen === last.textLen &&
          fp.canvasCount === last.canvasCount &&
          Math.abs((fp.scrollY || 0) - (last.scrollY || 0)) < 2;
        const stall = same ? (state.emptyPageStallCount || 0) + 1 : 0;
        await setReadingState({
          emptyPageStallCount: stall,
          emptyLastFingerprint: fp,
          emptyLastTurnAt: now,
          highlightMissStreak: 0,
          pageTurnStreak: 0,
        });
        logEvent("background", `[weread] 空页 ${same ? "无变化" : "有变化"}，停滞计数 ${stall}/${MAX_EMPTY_STALL}`, {
          fingerprint: fp,
        });
        if (stall >= MAX_EMPTY_STALL) {
          logEvent("background", "[weread] 连续多次翻页内容无变化，判断已到书尾，停止朗读");
          await stopReading();
          return;
        }
        if (state.waitingForNextChapter) {
          logEvent("background", "[weread] 空页翻页中，重置'等待下一章'超时");
          armNextChapterTimeout(state.tabId);
        }
        chrome.tabs.sendMessage(state.tabId, { type: "WEREAD_TURN_PAGE" }).catch(() => {});
      })();
      return;
    }

    case "WEREAD_HIGHLIGHT_HIT": {
      (async () => {
        const state = await getReadingState();
        if (state.highlightMissStreak || state.pageTurnStreak) {
          await setReadingState({ highlightMissStreak: 0, pageTurnStreak: 0 });
          logEvent("background", "[weread] 高亮命中，未命中/翻页计数清零");
        }
      })();
      return;
    }

    case "WEREAD_HIGHLIGHT_MISS": {
      (async () => {
        const state = await getReadingState();
        if (!state.isReading || !state.tabId) return;
        const streak = (state.highlightMissStreak || 0) + 1;
        if (streak < MAX_MISS_BEFORE_TURN) {
          await setReadingState({ highlightMissStreak: streak });
          logEvent("background", `[weread] 高亮未命中 ${streak}/${MAX_MISS_BEFORE_TURN}，继续观察`);
          return;
        }
        const turns = (state.pageTurnStreak || 0) + 1;
        if (turns > MAX_PAGE_TURNS) {
          logEvent("background", "[weread] 连续翻页仍高亮未命中，停止朗读");
          await stopReading();
          return;
        }
        await setReadingState({ highlightMissStreak: 0, pageTurnStreak: turns });
        logEvent("background", `[weread] 高亮未命中达阈值，翻页 ${turns}/${MAX_PAGE_TURNS}`);
        chrome.tabs.sendMessage(state.tabId, { type: "WEREAD_TURN_PAGE" }).catch(() => {});
      })();
      return;
    }

    case "HIGHLIGHT_CHUNK": {
      (async () => {
        const state = await getReadingState();
        if (!state.isReading || !state.tabId) return;
        chrome.tabs.sendMessage(state.tabId, { type: "HIGHLIGHT_CHUNK", text: message.text }).catch(() => {});
      })();
      return;
    }

    case "PLAYBACK_PROGRESS": {
      // 进度上报：weread 暂不做进度条，透传忽略
      return;
    }

    case "AUDIO_STARTED": {
      (async () => {
        await setReadingState({ connectionStatus: "ok" });
      })();
      return;
    }

    case "AUDIO_ENDED": {
      // 一章读完 → 切下一章（如果有页尾半句缓存，翻页后会自动合并）
      (async () => {
        const state = await getReadingState();
        if (!state.isReading || !state.tabId) return;
        if (state.pendingTrailingText) {
          logEvent("background", `[weread] 队列读完，页尾有 ${state.pendingTrailingText.length} 字待合并，翻页后与下一页拼接`);
        } else {
          logEvent("background", "[weread] 本章朗读结束，请求切下一章");
        }
        await setReadingState({ waitingForNextChapter: true });
        chrome.tabs.sendMessage(state.tabId, { type: "WEREAD_NEXT_CHAPTER" }).catch(() => {});
        armNextChapterTimeout(state.tabId);
      })();
      return;
    }

    case "AUDIO_ERROR": {
      (async () => {
        logEvent("background", "[weread] 音频播放错误", message.error || message);
        await setReadingState({ connectionStatus: "error" });
      })();
      return;
    }

    default: {
      logEvent("background", `[weread] 收到未处理的消息类型: ${message.type}`);
      return;
    }
  }
}
