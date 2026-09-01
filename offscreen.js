const player = document.getElementById("player");

// 诊断日志：offscreen document 也是独立上下文，转发给 background.js 汇总。
function diagLog(message, data) {
  try {
    chrome.runtime.sendMessage({ type: "DIAG_LOG", source: "offscreen", message, data });
  } catch (e) {
    // 忽略
  }
}

function textPreview(text, len = 12) {
  if (typeof text !== "string") return text;
  return text.length > len ? text.slice(0, len) + "…" : text;
}

let currentRate = 1;
let currentVoice = null;
let chunks = [];
let currentIndex = -1;
let sessionId = 0; // 每次新的 OFFSCREEN_PLAY 递增，旧会话的异步回调发现自己过期就放弃
let activeAbortControllers = [];
let pending = new Map(); // index -> Promise（resolve 出 Blob，或 {__error} 包装失败原因，永不 reject）
let playStartedAt = 0; // 当前这一块真正开始播放的时间戳，ended 触发时用来算实际播放了多久

// 提前囤多少句在飞——不是"读完一句才去拿下一句"，而是保持接下来这么多句
// 始终处于"已经在请求中"的状态，网络偶尔慢一点也有缓冲，不会读到哪等到哪。
const PREFETCH_WINDOW = 5;

function abortAllPending() {
  activeAbortControllers.forEach((c) => c.abort());
  activeAbortControllers = [];
}

function fetchChunk(text, voice) {
  const controller = new AbortController();
  activeAbortControllers.push(controller);
  return fetch("http://127.0.0.1:5005/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice }),
    signal: controller.signal,
  }).then(async (resp) => {
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${resp.status}`);
    }
    return resp.blob();
  });
}

// 确保 [currentIndex+1, currentIndex+PREFETCH_WINDOW] 这个窗口内的句子都已经在请求中
function ensurePrefetched() {
  const start = currentIndex + 1;
  const end = Math.min(currentIndex + PREFETCH_WINDOW, chunks.length - 1);
  for (let i = start; i <= end; i++) {
    if (!pending.has(i)) {
      pending.set(
        i,
        fetchChunk(chunks[i], currentVoice).catch((e) => ({ __error: e }))
      );
    }
  }
}

async function playChunkList(newChunks, voice, rate) {
  diagLog(`OFFSCREEN_PLAY 收到 ${newChunks.length} 块，开新 session`, {
    preview: newChunks.map((c) => textPreview(c)),
  });
  abortAllPending();
  const mySession = ++sessionId;
  chunks = newChunks;
  currentIndex = -1;
  pending = new Map();
  currentVoice = voice;
  ranDry = false;
  if (rate) currentRate = rate;

  if (chunks.length === 0) {
    chrome.runtime.sendMessage({ type: "AUDIO_ERROR", error: "没有可朗读的内容" });
    return;
  }

  ensurePrefetched(); // 从头开始把窗口内的句子都发出去
  await advanceAndPlay(mySession);
}

// advanceAndPlay 有多个调用入口（ended 事件、appendChunks 的续播分支、retryCurrentChunk），
// 如果不加保护，两次调用可能在 currentIndex 还没被第一次推进之前就都算出同一个 nextIndex，
// 相互踩踏。用 advancing 锁保证同一时间只有一次在真正执行；如果加锁期间又来了新的推进请求，
// 记在 advancePending 里，等这次跑完了自动再补跑一次，不会丢请求。
let advancing = false;
let advancePending = false;

async function advanceAndPlay(mySession) {
  if (advancing) {
    advancePending = true;
    return;
  }
  advancing = true;
  try {
    await doAdvanceAndPlay(mySession);
  } finally {
    advancing = false;
    if (advancePending) {
      advancePending = false;
      // 用最新的 sessionId 重跑，不用这次调用闭包里的旧 mySession——
      // 等待期间如果已经切到新一页（sessionId 变了），拿旧值重跑会被判定过期直接跳过，
      // 新页播放就没人推进了，会卡住。
      advanceAndPlay(sessionId);
    }
  }
}

// 队列是否真的"耗尽在等新内容"——不能用 currentIndex + 1 >= chunks.length 推断，
// 那个式子在"最后一块正在播"和"最后一块已经播完在等下一页"这两种情况下算出来都是 true，
// 没法区分。翻页后 Play Books 增量渲染 DOM，每来一批新内容就 appendChunks 一次，如果这时候
// 恰好在播最后一块（增量到达节奏和播放节奏很容易撞在一起），旧逻辑会误判成"已耗尽"，
// 把正在播的这一块硬切断去追下一块——这是"翻页后几乎每页都丢、有时一页丢好几次"的主因。
// 用这个显式标志：只有真正触发过 AUDIO_ENDED（队列耗尽、确实在等）才置真，
// 一旦有新的一块开始播放就置回假。
let ranDry = false;

async function doAdvanceAndPlay(mySession) {
  const nextIndex = currentIndex + 1;
  if (nextIndex >= chunks.length) {
    if (mySession === sessionId) {
      ranDry = true;
      diagLog(`队列耗尽 (currentIndex=${currentIndex}, chunks.length=${chunks.length})，发 AUDIO_ENDED`);
      chrome.runtime.sendMessage({ type: "AUDIO_ENDED" }); // 这一页所有句子都播完了
    }
    return;
  }
  ranDry = false;

  // 兜底：这个位置理应已经被 ensurePrefetched 提前发出请求了，
  // 但如果之前失败过一次、pending 记录被清空后没人补上（比如触发路径绕开了专门的重试逻辑），
  // 这里主动补一次 fetch——不依赖调用方一定记得先把 pending 填好，从根上防止"pending 里找不到、
  // 直接吃到 undefined、这一块被当成空的跳过"这种情况。
  if (!pending.has(nextIndex)) {
    diagLog(`nextIndex=${nextIndex} 没有 pending 记录，补一次 fetch`);
    pending.set(
      nextIndex,
      fetchChunk(chunks[nextIndex], currentVoice).catch((e) => ({ __error: e }))
    );
  }

  try {
    const result = await pending.get(nextIndex);
    pending.delete(nextIndex);
    if (mySession !== sessionId) {
      diagLog(`session 已过期 (mySession=${mySession}, sessionId=${sessionId})，放弃 nextIndex=${nextIndex}`);
      return;
    }

    if (result && result.__error) throw result.__error;

    const url = URL.createObjectURL(result);

    // 切 src 之前先占用一个新代次号，这一批监听器只认这个代次。
    const epoch = ++srcEpoch;
    player.src = url;
    player.playbackRate = currentRate;
    await player.play();

    if (mySession !== sessionId || epoch !== srcEpoch) {
      diagLog(`播放确认前发现过期 (mySession match=${mySession === sessionId}, epoch match=${epoch === srcEpoch})，放弃 nextIndex=${nextIndex}`);
      return; // session 或 src 都可能在等待期间被新请求取代
    }

    // 只有确认真正播放成功之后才推进 currentIndex——
    // 之前是在 player.play() 之前就推进，一旦 createObjectURL 或 play() 中途失败，
    // currentIndex 已经指向了这一块，下次重试会算出下一个 nextIndex，这一块就被永久跳过、
    // 再也没机会重放了。现在任何一步失败，currentIndex 都留在原值，保证能重试同一块。
    currentIndex = nextIndex;
    const chunkText = chunks[currentIndex];
    const expectedSeconds = (chunkText.replace(/\s/g, "").length / 5).toFixed(1); // 粗略估算：中文按每秒5字算
    diagLog(
      `开始播放 chunk[${currentIndex}]，字数=${chunkText.length}，预估${expectedSeconds}s，` +
        `blob=${result.size}B，audio.duration=${player.duration.toFixed(2)}s`,
      { text: textPreview(chunkText, 20) }
    );
    playStartedAt = Date.now();
    ensurePrefetched(); // 窗口往前滚，补上刚空出来的位置

    // 挂上这一块专属代次的 ended 监听——触发时如果代次已经变了（比如又切了新的 src），
    // 说明这是迟到的旧事件，直接丢弃，不会误触发跳块。
    player.addEventListener(
      "ended",
      () => {
        if (epoch !== srcEpoch) {
          diagLog(`迟到的 ended 事件被挡下 (epoch=${epoch}, srcEpoch=${srcEpoch})`);
          return;
        }
        const elapsed = ((Date.now() - playStartedAt) / 1000).toFixed(2);
        diagLog(`chunk[${currentIndex}] ended 触发，实际播放耗时 ${elapsed}s（audio.duration=${player.duration.toFixed(2)}s）`);
        advanceAndPlay(sessionId);
      },
      { once: true }
    );

    chrome.runtime.sendMessage({ type: "PLAYBACK_PROGRESS" });
    // 通知 background 当前正在播哪一块文字，用于高亮
    chrome.runtime.sendMessage({ type: "HIGHLIGHT_CHUNK", text: chunks[currentIndex] });
    if (currentIndex === 0) {
      chrome.runtime.sendMessage({ type: "AUDIO_STARTED" }); // 只在第一句真正开始播放时通知一次
    }
  } catch (e) {
    if (e.name === "AbortError" || mySession !== sessionId) return;
    diagLog(`播放出错：${e.message}`, { nextIndex });
    chrome.runtime.sendMessage({ type: "AUDIO_ERROR", error: e.message });
  }
}

// 把下一页的内容接到现有播放队列末尾——跟 playChunkList 不一样，playChunkList 是整个换掉重开一个新 session，
// 这个是原地追加，不会打断当前正在播的这一句。如果队列恰好已经放完（正在等新内容接上来），接上后自动续播。
function appendChunks(newChunks, voice) {
  if (!newChunks || newChunks.length === 0) return;
  if (voice) currentVoice = voice;
  const shouldResume = ranDry; // 只有真的 ended 过、确实在等新内容，才自动续播——
  // 不能用 currentIndex 推断，见 ranDry 定义处的说明。
  diagLog(`OFFSCREEN_APPEND 收到 ${newChunks.length} 块，ranDry=${ranDry} → shouldResume=${shouldResume}`, {
    currentIndex,
    chunksLenBefore: chunks.length,
    preview: newChunks.map((c) => textPreview(c)),
  });
  ranDry = false;
  chunks = chunks.concat(newChunks);
  ensurePrefetched();
  if (shouldResume) {
    advanceAndPlay(sessionId);
  }
}

// 网络出错重试用这个——只重新去请求"卡住的那一句"，不清空已经播完的进度、
// 不重建 chunks 队列。跟 playChunkList（整页重开、从头播）不一样：
// 那样一旦网络反复抖动，就会变成永远只播到第一句，卡死循环。
function retryCurrentChunk() {
  // 防御性检查：如果当前确实正在正常播放（没暂停、没结束），说明根本没有卡住，
  // 不该做任何事。这是配合 background.js 那边 watchdog 心跳机制的双重保险——
  // 之前 watchdog 会在页面读到一半时被误判成"卡死"而触发这个函数，而这里原来的实现
  // 又用 currentIndex + 1（下一句）当成"卡住的那句"去重试，等于把正在正常播放的
  // 当前句强行截断、抢跑到下一句。现在双重防护：一是 watchdog 不再误触发，
  // 二是即使触发了，这里也会先确认"真的没在播"才继续。
  if (!player.paused && !player.ended && currentIndex >= 0 && player.src) {
    diagLog("retryCurrentChunk 被调用，但当前正在正常播放，判定为误触发，忽略");
    return;
  }
  const idx = currentIndex + 1;
  if (idx >= chunks.length) return; // 没有卡住的句子了，不用重试
  diagLog(`retryCurrentChunk 真正执行，重试 idx=${idx}`);
  pending.delete(idx); // 先删掉可能已存在的失败记录，保证下面一定会发起新请求
  pending.set(
    idx,
    fetchChunk(chunks[idx], currentVoice).catch((e) => ({ __error: e }))
  );
  advanceAndPlay(sessionId);
}

// 每次真正切 src 时递增的代次号。只用 removeEventListener 挡不干净——
// player.play() 内部有 await，会把控制权让给事件循环，这段窗口期如果旧音频的 ended
// 已经进了事件队列，remove 早已经来不及，还是会触发、还是会跳块。用 epoch 兜底：
// 监听器触发时比对自己绑定时的 epoch 和当前 epoch 是否一致，不一致就是迟到的，直接丢弃。
let srcEpoch = 0;

function stopPlayback() {
  abortAllPending();
  sessionId++; // 让任何还在飞的旧回调都失效
  srcEpoch++; // 让任何还挂着的旧 ended 监听器判定为过期，不会误触发
  ranDry = false;
  chunks = [];
  currentIndex = -1;
  pending = new Map();
  player.pause();
  player.removeAttribute("src");
  player.load();
  chrome.runtime.sendMessage({ type: "HIGHLIGHT_CHUNK", text: null }); // 清除高亮
}

function pausePlayback() {
  player.pause();
}

function resumePlayback() {
  player.play();
}

function setRate(rate) {
  currentRate = rate;
  player.playbackRate = rate;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "OFFSCREEN_PLAY") {
    playChunkList(message.chunks, message.voice, message.rate);
  } else if (message.type === "OFFSCREEN_RETRY") {
    retryCurrentChunk();
  } else if (message.type === "OFFSCREEN_APPEND") {
    appendChunks(message.chunks, message.voice);
  } else if (message.type === "OFFSCREEN_STOP") {
    stopPlayback();
  } else if (message.type === "OFFSCREEN_PAUSE") {
    pausePlayback();
  } else if (message.type === "OFFSCREEN_RESUME") {
    resumePlayback();
  } else if (message.type === "OFFSCREEN_SET_RATE") {
    setRate(message.rate);
  } else if (message.type === "OFFSCREEN_SEEK") {
    seekBy(message.delta);
  }
});

function seekBy(delta) {
  if (isNaN(player.duration) || player.duration === 0) return;
  player.currentTime = Math.max(0, Math.min(player.duration, player.currentTime + delta));
}
