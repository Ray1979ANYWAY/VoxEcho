# VoxEcho 接入微信读书网页版（weread.qq.com）企划

> 用途：下一个对话的接入执行蓝本。基于 `ARCHITECTURE.md` + 当前源码（Play Books / Koodo 双平台已稳定、Koodo 防跳页修复已落地）整理。
> 目标：新增第三个平台 weread，复用现有架构，接入成本最小、回归风险可控。

---

## 1. 目标与范围

- 在 `https://weread.qq.com/web`（微信读书网页版）上实现与 Koodo 同等的朗读体验：提取正文 → 视口起点定位 → 切块 → 本地 TTS 播放 → 高亮 → 空页自动翻页 → 书尾判断。
- **不改造现有两个平台**；background.js 路由与 manifest 小改；chunking / diagnostics / offscreen 全部共享。
- 微信读书 DOM 结构未调研，第一步是现场探查（见 §7）。

---

## 2. 零改动直接复用的共享层

| 文件 | 导出的能力 | weread 用法 |
|---|---|---|
| `chunking.js` | `chunkTextByWords(text)` 按标点切块（MIN_CHUNK_WORDS=30，MAJOR/MINOR_PUNCT 已含中英标点）；`endsWithAnyPunctuation()`；`isCJKChar()` 等 | 切块直接调用，无需改 |
| `diagnostics.js` | `logEvent(source, message, data)` 统一日志（content/background/offscreen 汇总，popup 导出诊断） | content 用 `diagLog` 转发、background 用 `logEvent`，无需改 |
| `offscreen-client.js` | `ensureOffscreenDocument()` / `sendToOffscreen(message, retries=3, delayMs=250)` | background 侧统一走它，无需改 |
| `offscreen.js`（音频播放器） | 处理 `OFFSCREEN_PLAY / OFFSCREEN_APPEND / OFFSCREEN_RETRY / OFFSCREEN_STOP / OFFSCREEN_PAUSE / OFFSCREEN_RESUME / OFFSCREEN_SET_RATE / OFFSCREEN_SEEK`；发 `AUDIO_STARTED / AUDIO_ENDED / AUDIO_ERROR / PLAYBACK_PROGRESS / HIGHLIGHT_CHUNK`；含 fetch 30s 超时 + 重试 + PREFETCH_WINDOW | 平台无关播放器，**零改动** |

> 结论：播放链路（切块→合成→播放→进度→错误重试）整条无需碰，weread 只补"提取 + 状态机 + 高亮 + 翻页"这层。

---

## 3. 需要新建的文件

### 3.1 `content-weread.js`（核心工作量）
**参考模板：`content-koodo.js`（约 1100 行）——不是 content-playbooks.js。** 理由：Koodo 与微信读书同为"整章/整页一次性提取 + 单一阅读容器"，没有 Play Books 那套分批异步到达 + 跨页续接 + 内容对齐校验的复杂状态机。

必须实现的能力（照 Koodo 抄）：
1. **正文提取**：`extractChapterText()` 返回 `{ data:[{type:'heading'|'body', text}], elements, doc }`；`type` 判定规则（heading / 短无标点行 / body）直接抄 Koodo 的 `pushParagraph`。
2. **DOM 变化监听**：MutationObserver 防抖（Koodo 300ms）+ `pollForIframe`（若正文在 iframe）或直接顶层监听。
3. **视口起点定位**：`findVisibleStartIndex()`（视口内第一个大标点之后）+ 选中文本起点 `findSelectionStartIndex()`（用户选中优先），响应 `WEREAD_GET_START_INDEX`。
4. **高亮**：`buildHighlightIndex()`（索引串 + 逐字符归一化）、`findRangesForText()`（单向推进）、`applyHighlightRanges()`（不跨节点 Range）、charMap 失效重建 + `highlightRangeFailures` 计数重试。**整套抄 Koodo**。
5. **空页检测 + 周期上报**：`getEmptyPageFingerprint()`（textLen/textHead/imgCount/imgSrcs/scrollY）、`scheduleEmptyPageReport()` / `stopEmptyPageReport()`（1s 周期）。
6. **消息监听**：`WEREAD_GET_START_INDEX` / `WEREAD_TURN_PAGE` / `WEREAD_NEXT_CHAPTER` / `WEREAD_START_READING` / `WEREAD_STOP_READING` / `HIGHLIGHT_CHUNK`。
7. **发送**：`WEREAD_CHAPTER_UPDATED`（有文本）/ `WEREAD_EMPTY_PAGE`（空页）/ `WEREAD_HIGHLIGHT_HIT` / `WEREAD_HIGHLIGHT_MISS` / `DIAG_LOG`。

### 3.2 `background-weread.js`
**参考模板：`background-koodo.js`（约 490 行）**，导出 `handleWereadMessage(message, sender, sendResponse)`。
- 独立 storage key（如 `wereadReadingState`）+ `DEFAULT_STATE`（含 `waitingForNextChapter / highlightMissStreak / pageTurnStreak / emptyPageStallCount / emptyLastFingerprint / emptyLastTurnAt`）。
- 章节缓存 key（如 `wereadChapter:tabId`）：`saveChapterForTab` / `getChapterForTab`。
- `startReading(tabId, voice, rate, {fromStart})` / `stopReading()` / `pauseReading()` / `resumeReading()` / `setRateLive()`。
- 消息处理：`WEREAD_CHAPTER_UPDATED`、`WEREAD_EMPTY_PAGE`、`WEREAD_HIGHLIGHT_HIT/MISS`、`AUDIO_ENDED`（切章）、`AUDIO_ERROR`、`HIGHLIGHT_CHUNK`、`PLAYBACK_PROGRESS`、`START_READING / STOP_READING / PAUSE_READING / RESUME_READING / SET_RATE / GET_READING_STATE / TOGGLE_PLAYBACK / SEEK`（popup 通用消息，**必须实现这些 case** 才能被 background.js 路由正确分发）。

---

## 4. 需要修改的文件（小改）

### 4.1 `background.js`（路由层）
```js
import { handleWereadMessage } from "./background-weread.js";
// detectPlatformFromUrl 加：
if (url.startsWith("https://weread.qq.com/")) return "weread";
// dispatch 加：
if (platform === "weread") return handleWereadMessage(message, sender, sendResponse);
```
- 其余（`NEEDS_ACTIVE_TAB_LOOKUP` / `USES_EXISTING_SESSION_*`）都是平台无关消息集，**weread 的 handleWereadMessage 实现对应 case 即可**，路由本身不用改。
- 注意 `getActivePlatform()` 默认值仍是 playbooks，不影响。

### 4.2 `manifest.json`
```json
"content_scripts": [ { "matches": ["https://weread.qq.com/*"], "js": ["content-weread.js"], "run_at": "document_idle" } ],
"host_permissions": [ "https://weread.qq.com/*" ]
```
- **待定**：正文在顶层还是 iframe？若正文在 iframe 且无法跨 frame 访问 → 需 `"all_frames": true` 并参考 content-playbooks 的 frame 处理；若顶层可访问（大概率，微信读书 web 版正文在顶层）→ 默认即可。

### 4.3 `popup.js`（可选，低优先级）
- 文案里 "Play Books / Koodo" → 加 weread。纯文案，不阻塞功能。

---

## 5. 必须带过去的防跳页经验（Koodo 本轮踩坑沉淀）

这些是**直接抄进 weread 的硬约束**，缺了会复现"插画后遇文本跳页"：

1. **空页上报必须校验来源 tab**：background 处理 `WEREAD_EMPTY_PAGE` 时 `if (sender.tab && sender.tab.id !== state.tabId) return;`（对齐 Play Books / 修复 R1）。
2. **切章超时句柄化**：`armNextChapterTimeout(tabId)` / `clearNextChapterTimeout()` 模块级变量，别用内联 setTimeout；`AUDIO_ENDED` 后 8s（`MAX_NEXT_CHAPTER_WAIT_MS`）超时，`stopReading`/`startReading` 都清。
3. **空页翻页重置切章超时**：`WEREAD_EMPTY_PAGE` 处理中若 `waitingForNextChapter` → 重置超时（"空页翻页就是还在找下一章内容"）。
4. **提取到有文本章节时重置空页状态**：`WEREAD_CHAPTER_UPDATED` 有文本且是朗读 tab → 清 `emptyLastFingerprint/emptyPageStallCount`（修复 R2，防"插画→文本"误停）。
5. **content 空页上报加 `__hasEverMatched` 守卫**：只有本实例之前提取到过正文才 `scheduleEmptyPageReport()`（修复 R3，对齐 Play Books）。
6. **stop/start 朗读广播停空页定时器**：`stopReading()` 发 `WEREAD_STOP_READING`、`startReading()` 发 `WEREAD_START_READING`，content 收到后 `stopEmptyPageReport()`。
7. **空页与高亮未命中翻页互斥**：`WEREAD_EMPTY_PAGE` 处理时清 `highlightMissStreak/pageTurnStreak`。
8. **空页书尾判断**：`MAX_EMPTY_STALL=4`，指纹"有变化→归零继续翻 / 无变化→停滞+1，≥4 停"；`EMPTY_TURN_INTERVAL_MS=1200`。

---

## 6. 建议实施顺序

1. **现场调研微信读书 DOM**（§7 清单），开一本中文书 + 一本有插画/封面的书，用 DevTools 确认选择器。
2. 复制 `content-koodo.js` → 改名为 `content-weread.js`，把 `KOODO_*` 消息名批量替换为 `WEREAD_*`、`IFRAME_SELECTOR`/`SELECTOR` 换成调研结果。
3. 复制 `background-koodo.js` → `background-weread.js`，同法替换消息名、storage key、章节 key。
4. 改 `background.js` 路由 + `manifest.json`。
5. 先用 `node --check` 过语法，reload 扩展。
6. 手工验证：中文书朗读 / 高亮 / 暂停继续 / 停止 / 空页（封面）自动翻页 / 书尾停止。
7. 复用现有 verify 脚本模式，为 weread 写一套行为验证（可复制 `verify_koodo_empty_page.mjs` / `verify_koodo_sender_guard.mjs` 改消息名）。

---

## 7. 待调研的微信读书 DOM 清单（第一步动作）

- [ ] 正文容器/段落选择器：微信读书 web 版正文是 `<p>` 还是自定义 class（如 `.readerChapterContent`）？
- [ ] 章节标题元素：h1-h6 还是其他？
- [ ] 正文在顶层 DOM 还是 iframe？（决定 content 注入方式和 `getIframeDocument` 是否要写）
- [ ] 翻页方式：滚动式还是分页式？（影响 `WEREAD_TURN_PAGE` 是模拟滚动还是模拟翻页按键）
- [ ] 是否有 `data-` 属性标注章节/段落边界？
- [ ] 封面/插画页的 DOM 形态（`textLen`/`imgCount` 指纹怎么取）
- [ ] 章节切换入口（下一页/下一章按钮的选择器，供 `WEREAD_NEXT_CHAPTER`）

---

## 8. 风险与边界

- **DOM 会变**：微信读书是商业 SPA，DOM 可能频繁改版；选择器建议集中在文件头部常量，便于一处维护。
- **登录态**：微信读书需要登录才能读，扩展只做朗读不改登录逻辑。
- **翻页节奏**：weread 的渲染/翻页动画时长未知，`EMPTY_TURN_INTERVAL_MS` 可能需要按实际手感调（参考 Koodo 1200ms）。
- **多实例**：若 weread 页面有多个 content frame，空页上报的 `sender.tab` 校验（§5.1）是必须的。
- **语音**：5 种语言走同一 chunking + offscreen，无需平台适配。

---

## 9. 验收标准

- [ ] 中文/英文书：选中文本 → 朗读 → 高亮跟随 → 暂停/继续/停止/语速正常
- [ ] 封面/插画页：朗读中自动翻页到正文；连续插画不误停；书尾正确停止
- [ ] 插画区翻页后遇文本：正常接续朗读，不跳页、不停错
- [ ] 读完一章自动切下一章（或按 weread 实际情况）
- [ ] popup 状态/进度/停止正确反映
- [ ] 诊断日志可导出
