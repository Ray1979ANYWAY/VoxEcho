function render(result) {
  const meta = document.getElementById("meta");
  const list = document.getElementById("list");
  list.innerHTML = "";

  if (!result || !result.data || result.data.length === 0) {
    meta.textContent = "没有提取到正文，可能原因：当前标签页不是 Play Books 阅读页面 / 书页还没加载完 / 这本书的 DOM 结构需要重新适配。\nNo text extracted. Possible causes: not a Play Books reading page / page still loading / this book's DOM structure needs adaptation.";
    return;
  }

  meta.textContent = `共 ${result.data.length} 段 / ${result.data.length} segments · ${new Date(
    result.updatedAt
  ).toLocaleTimeString()} · ${result.url}`;

  result.data.forEach((item) => {
    const div = document.createElement("div");
    div.className = `item ${item.type}`;
    div.textContent = item.text;
    list.appendChild(div);
  });
}

function fetchLatest() {
  chrome.runtime.sendMessage({ type: "GET_LATEST_FOR_ACTIVE_TAB" }, render);
}

function setStatus(text, kind) {
  const el = document.getElementById("status");
  el.textContent = text;
  el.className = "status" + (kind ? " " + kind : "");
}

function syncButtons(state) {
  const startBtn = document.getElementById("start");
  const pauseResumeBtn = document.getElementById("pauseResume");
  const stopBtn = document.getElementById("stop");

  const isReading = !!(state && state.isReading);
  const isPaused = !!(state && state.isPaused);

  startBtn.disabled = isReading;
  pauseResumeBtn.disabled = !isReading;
  stopBtn.disabled = !isReading;
  pauseResumeBtn.textContent = isPaused ? "▶ 继续 / Resume" : "⏸ 暂停 / Pause";

  if (isReading) {
    setStatus(isPaused ? "已暂停（关闭这个窗口不影响）" : "正在朗读（关闭这个窗口不会中断播放）", "ok");
  }
}

function syncButtons(state) {
  const startBtn = document.getElementById("start");
  const pauseResumeBtn = document.getElementById("pauseResume");
  const stopBtn = document.getElementById("stop");
  const light = document.getElementById("statusLight");

  const isReading = !!(state && state.isReading);
  const isPaused = !!(state && state.isPaused);
  const connectionStatus = (state && state.connectionStatus) || "idle";

  startBtn.disabled = isReading;
  pauseResumeBtn.disabled = !isReading;
  stopBtn.disabled = !isReading;
  pauseResumeBtn.textContent = isPaused ? "▶ 继续 / Resume" : "⏸ 暂停 / Pause";

  const seekBackBtn = document.getElementById("seekBack");
  const seekForwardBtn = document.getElementById("seekForward");
  seekBackBtn.disabled = !isReading;
  seekForwardBtn.disabled = !isReading;

  light.classList.remove("green", "red");
  if (isReading) {
    light.classList.add(connectionStatus === "error" ? "red" : "green");
    setStatus(
      isPaused
        ? "已暂停 / Paused（关闭窗口不影响 / closing this popup won't stop it）"
        : connectionStatus === "error"
        ? "连接失败，正在自动重试… / Connection failed, retrying…"
        : "正在朗读 / Reading（关闭窗口不会中断播放 / closing this popup won't stop it）",
      connectionStatus === "error" ? "error" : "ok"
    );
  }
}

let pollHandle = null;

function refreshReadingState() {
  chrome.runtime.sendMessage({ type: "GET_READING_STATE" }, syncButtons);
}

function startPolling() {
  if (pollHandle) return;
  pollHandle = setInterval(refreshReadingState, 2000);
}

function startReading() {
  const voice = document.getElementById("voice").value;
  const rate = parseFloat(document.getElementById("rate").value);
  setStatus("正在合成语音... / Synthesizing audio...");
  chrome.runtime.sendMessage({ type: "START_READING", voice, rate }, (result) => {
    if (!result || !result.ok) {
      setStatus(`启动失败 / Failed to start: ${(result && result.error) || "未知错误 / Unknown error"}`, "error");
      return;
    }
    refreshReadingState();
  });
}

function togglePauseResume() {
  chrome.runtime.sendMessage({ type: "GET_READING_STATE" }, (state) => {
    const messageType = state && state.isPaused ? "RESUME_READING" : "PAUSE_READING";
    chrome.runtime.sendMessage({ type: messageType }, () => refreshReadingState());
  });
}

function stopReading() {
  chrome.runtime.sendMessage({ type: "STOP_READING" }, () => {
    syncButtons(null);
    setStatus("已停止 / Stopped");
  });
}

const LAST_VOICE_KEY = "lastVoice";
const LAST_RATE_KEY = "lastRate";

function restoreLastVoice() {
  chrome.storage.local.get(LAST_VOICE_KEY, (result) => {
    const lastVoice = result[LAST_VOICE_KEY];
    if (lastVoice) {
      const select = document.getElementById("voice");
      if ([...select.options].some((opt) => opt.value === lastVoice)) {
        select.value = lastVoice;
      }
    }
  });
}

function restoreLastRate() {
  chrome.storage.local.get(LAST_RATE_KEY, (result) => {
    const lastRate = result[LAST_RATE_KEY];
    if (lastRate) {
      const select = document.getElementById("rate");
      if ([...select.options].some((opt) => opt.value === String(lastRate))) {
        select.value = String(lastRate);
      }
    }
  });
}

document.getElementById("voice").addEventListener("change", (e) => {
  chrome.storage.local.set({ [LAST_VOICE_KEY]: e.target.value });
});

document.getElementById("rate").addEventListener("change", (e) => {
  const rate = parseFloat(e.target.value);
  chrome.storage.local.set({ [LAST_RATE_KEY]: rate });
  // 朗读中调整语速立刻生效；没在朗读时只是存个偏好，下次开始朗读时使用
  chrome.runtime.sendMessage({ type: "SET_RATE", rate });
});

document.getElementById("refresh").addEventListener("click", fetchLatest);
document.getElementById("start").addEventListener("click", startReading);
document.getElementById("pauseResume").addEventListener("click", togglePauseResume);
document.getElementById("stop").addEventListener("click", stopReading);

document.getElementById("seekBack").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "SEEK", delta: -5 });
});
document.getElementById("seekForward").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "SEEK", delta: 5 });
});

// 导出诊断日志：把 background.js 汇总的完整时间线（content/background/offscreen 三方事件）
// 打包成一个文本文件下载下来，复现问题后把这个文件发出去，不用再分别打开三个不同的 devtools
// console 去对时间线。
document.getElementById("exportLog").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "EXPORT_DIAG_LOG" }, (result) => {
    if (!result || !result.text) {
      setStatus("日志是空的，还没有可导出的内容 / Log is empty, nothing to export", "error");
      return;
    }
    const blob = new Blob([result.text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url;
    a.download = `tts-diag-log-${ts}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatus(`已导出 ${result.count} 条日志 / Exported ${result.count} log entries`, "ok");
  });
});

document.getElementById("clearLog").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CLEAR_DIAG_LOG" }, () => {
    setStatus("日志已清空 / Log cleared", "ok");
  });
});

restoreLastVoice();
restoreLastRate();
fetchLatest();
refreshReadingState();
startPolling();
