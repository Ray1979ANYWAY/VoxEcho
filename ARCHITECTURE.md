# VoxEcho 项目架构说明

> 本文档基于对项目源码的完整阅读整理，覆盖 `VoxEcho-extension`（Chrome 扩展）与 `VoxEcho-bridge`（本地桥接）两部分的文件职责、数据流与运行机制。

---

## 1. 项目概览

VoxEcho 是一款 Chrome 浏览器电子书朗读插件，支持 **Google Play Books**、**Koodo Reader（网页版）** 与 **微信读书（weread.qq.com）** 三个平台，支持中/英/西/日/韩五种语言的语音朗读。

整体采用**「浏览器扩展 + 本地桥接服务」两段式架构**：

```
┌─────────────────────────────┐        HTTP POST /speak        ┌─────────────────────────────┐
│   VoxEcho-extension         │  ────────────────────────────►  │   VoxEcho-bridge            │
│   (Chrome 扩展, 浏览器内)   │        文本 → MP3 音频          │   (本地 127.0.0.1:5005)     │
│   提取正文 / 切块 / 播放     │  ◄────────────────────────────  │   edge_tts 合成音频         │
└─────────────────────────────┘        GET /health 心跳         └─────────────────────────────┘
                                                                        │
                                                                        ▼
                                                              微软 Edge TTS 云服务
```

- **浏览器侧**：在网页中提取正文 → 按句子切块 → 请求本地服务合成音频 → 播放并高亮。
- **本地侧**：一个小型 Flask 服务（仅监听本机 `127.0.0.1:5005`），把扩展送来的文本交给微软 Edge TTS 合成 MP3 返回，带失败重试。

两者通过 `http://127.0.0.1:5005/speak` 通信。Chrome 扩展的 `host_permissions` 已包含该地址。

---

## 2. 目录结构总览

```
D:\Documents\VoxEcho\
├── README.md                       # 项目简介（对外）
├── ARCHITECTURE.md                 # 本文档
│
├── VoxEcho-bridge\                 # 【本地桥接】Python 工程
│   ├── launcher.py                 # 主程序：GUI 托盘 + 服务管理
│   ├── server.py                   # Flask TTS 服务
│   ├── build.bat / build.ps1       # onefile 打包脚本
│   ├── build_onedir.bat            # onedir 打包脚本（备用）
│   ├── VoxEcho-bridge.spec         # PyInstaller 配置
│   ├── requirements.txt            # Python 依赖
│   ├── VoxEcho.ico + icon\         # 多尺寸图标（16~256）
│   ├── tools\                      # 图标修复工具
│   ├── ICON.md                     # 图标问题专项文档
│   └── DEVELOPER.md                # 发布清单备忘
│
└── VoxEcho-extension\              # 【Chrome 扩展】浏览器侧
    ├── manifest.json               # MV3 清单
    ├── background.js               # 唯一 service worker 入口（路由）
    ├── background-playbooks.js     # Play Books 朗读逻辑
    ├── background-koodo.js         # Koodo 朗读逻辑
    ├── background-weread.js        # 微信读书朗读逻辑（空页翻页/标题页识别/书尾判断）
    ├── content-playbooks.js        # Play Books 正文提取
    ├── content-koodo.js            # Koodo 正文提取
    ├── content-weread.js           # 微信读书 isolated world（消息转发/空页上报/翻页指令）
    ├── content-weread-main.js      # 微信读书 main world（fillText hook 逐字采集/文本重建/高亮绘制）
    ├── chunking.js                 # 文本分块算法（平台无关）
    ├── offscreen.js                # 音频播放器
    ├── offscreen-client.js         # offscreen 生命周期管理
    ├── popup.html / popup.js       # 弹窗 UI
    ├── diagnostics.js              # 诊断日志汇总
    ├── _locales\                   # 多语言（zh_CN / en）
    ├── server\                     # 开发期备用 server（独立版本）
    └── icon\                       # 扩展图标
```

---

## 3. 浏览器侧（VoxEcho-extension）文件职责

### 3.1 入口与路由

| 文件 | 职责 |
|------|------|
| `manifest.json` | MV3 配置。声明 `storage`/`offscreen` 权限；`host_permissions` 覆盖 Google Play Books、books.googleusercontent.com、web.koodoreader.com/.cn 与 `127.0.0.1:5005`；注册唯一 service worker（`background.js`）；按平台注入 content 脚本 |
| `background.js` | 唯一的 service worker 入口（MV3 限制一个扩展只能有一个后台脚本）。本身很薄，只做两件事：① 处理平台无关的诊断日志消息；② 把其余消息按平台分发给 `background-playbooks.js` / `background-koodo.js`。维护 `ACTIVE_PLATFORM_KEY`（记录"当前正在朗读哪个平台"，供暂停/继续等不查标签页的操作使用） |

### 3.2 平台朗读逻辑

| 文件 | 职责 |
|------|------|
| `background-playbooks.js` | Play Books 专属：文本提取结果缓存（`chrome.storage.session`）、朗读状态机、翻页等待/重试、内容对齐校验（防止缩水循环重播）、跨页残句（X 区）拼接、自动翻页上限控制 |
| `background-koodo.js` | Koodo 专属：整章内容一次性提取完成，无翻页状态机，直接切块→发 offscreen 播放。当前已实现：整章缓存、从当前可见段开始朗读、暂停/继续/停止/语速/进度；高亮与自动翻章标注为后续待做 |
| `background-weread.js` | 微信读书专属：canvas 渲染无 DOM 语义标签，通过 fillText hook 逐字采集文本。支持双栏/滚动两种排版模式。核心功能：文本重建与去重、翻页锚点搜索（片段搜索接续位置）、视口定位（跳过标题从正文第一句起读）、标题页识别（<30字无标点→不朗读继续翻页）、空页/插图页自动翻页（指纹比较判断书尾）、高亮状态机、静音占位（标题后450ms停顿） |
| `content-playbooks.js` | 注入 Play Books 顶层页面与正文 iframe。从 DOM 按标签（`p, h1~h6`）提取正文段落，过滤分页延续箭头，合并被硬切的碎片段落；响应起点查询时优先用「用户鼠标选中的文字」定位朗读起点，无选中再回退到视口内第一个完整句子 |
| `content-koodo.js` | 注入 Koodo 页面。因正文装在 `iframe#kookit-iframe`（sandbox 未开 allow-scripts，不能注入），只能从顶层页面跨边界读 `contentDocument`。检测整章刷新后重新提取，并定位视口内当前段作为朗读起点；同样支持「选中文字优先作为朗读起点」 |
| `content-weread.js` | 注入微信读书页面（isolated world，document_start）。负责：main world 与 background 之间的消息转发、空页周期上报（每1s检测视口内有无可见字符）、翻页指令执行（PageDown/ArrowRight）、划选起点查询转发、高亮消息转发 |
| `content-weread-main.js` | 注入微信读书页面（MAIN world，document_start）。核心：hook CanvasRenderingContext2D.fillText 逐字采集字符（记录x/y/size/font/transform/canvas元素引用），文本重建（排序/去重/标题行检测/虚拟句号插入），高亮绘制（离屏canvas measureText测实际字符宽度，应用ctx.transform的tx/ty，textBaseline=middle补偿），空页检测（视口内可见字符数），视口定位（正文字号众数基准识别标题行） |

### 3.3 平台无关共享模块

| 文件 | 职责 |
|------|------|
| `chunking.js` | 文本分块算法。核心：中日韩文字符每字计 1 单位，拉丁连续字母串计 1，连续数字串计 1（小数点在数字中不算分隔符）。攒够 `MIN_CHUNK_WORDS=30` 后再遇标点切块，避免切碎；引号/括号等收尾符并入上一句，避免孤零零甩到句首 |
| `offscreen.js` | offscreen 音频播放器：管理播放队列、预取后 5 块（`PREFETCH_WINDOW=5`）、单块合成失败重试 3 次（间隔递增）、连续失败 3 次才停播；用 `AbortController` 处理会话切换/停止时的取消 |
| `offscreen-client.js` | offscreen 文档生命周期管理：发送前确保 offscreen 存在（Chrome 会回收长时间不发声的 offscreen），发送失败重建后重试 |
| `diagnostics.js` | 诊断日志汇总。content / offscreen / background 各自 console 分散，统一收拢成一条时间线，最多保留 4000 条；`textPreview` 截断长文本避免日志过大 |

### 3.4 UI 与杂项

| 文件 | 职责 |
|------|------|
| `popup.html` / `popup.js` | 扩展弹窗：开始/暂停/继续/停止按钮（状态联动禁用）、语速调整、显示当前标签页提取内容预览、导出/清空诊断日志。界面按浏览器系统语言自动选择 6 套语言包（简中/繁中/英/西/日/韩），其余语言兜底英文；朗读起点注释「从选定文本开始朗读，或者从页首开始朗读」随语言切换 |
| `_locales/` | `zh_CN` / `en` 多语言（扩展名称、描述） |
| `server/` | 开发期未打包时使用的备用独立 server（功能与 bridge 的 server.py 相同，代码更简，无 rate 支持） |

---

## 4. 本地侧（VoxEcho-bridge）文件职责

| 文件 | 职责 |
|------|------|
| `launcher.py` | 主程序。`run_gui()`：Tk 窗口 + pystray 系统托盘 + 服务状态显示 + 开机自启选项 + 桌面快捷方式；`main()` 支持 `--run-server` 参数（仅启 server 无 GUI）。含多语言翻译、图标加载（`apply_window_icons`）、设置 AppUserModelID 等 |
| `server.py` | Flask 服务：`POST /speak` 接收 `{text, voice, rate}` → edge_tts 合成 MP3 返回（`MAX_ATTEMPTS=3` 重试，间隔 1s）；`GET /health` 心跳。监听 `127.0.0.1:5005`，默认音色 `zh-CN-XiaoxiaoNeural` |
| `build.bat` | onefile 打包：装依赖 → PyInstaller `--onefile --windowed --icon VoxEcho.ico --add-data VoxEcho.ico;.` → copy ico 到 dist。**不要**对 onefile 跑 rcedit（会毁 PKG） |
| `build.ps1` | build.bat 的 PowerShell 版 |
| `build_onedir.bat` | onedir 打包（文件夹分发），可安全对文件夹内 exe 跑 rcedit 换图标 |
| `VoxEcho-bridge.spec` | PyInstaller 配置 |
| `requirements.txt` | `edge-tts` / `flask` / `flask-cors` / `pystray` / `Pillow` / `pyinstaller` |
| `VoxEcho.ico` + `icon/` | 多尺寸图标（16/24/32/48/64/128/256） |
| `tools/` | `fix_exe_icon.py`（rcedit 版，仅 onedir 使用）；`fix_exe_icon_safe.py`（onefile 安全换图标：注入后原样拼回 PKG）；`rcedit-x64.exe` |
| `ICON.md` | 图标问题专项说明（含"onefile 不可用 rcedit"警告） |
| `DEVELOPER.md` | 发布清单备忘 |

---

## 5. 一次完整朗读的运作流程

### 5.1 启动阶段

1. 用户运行 `VoxEcho-bridge.exe` → launcher 启动 GUI + 托盘 → 自动拉起 server.py → 本地 `127.0.0.1:5005` 就绪。
2. 用户在 Chrome 加载扩展（开发者模式 → Load unpacked → 选 `VoxEcho-extension` 文件夹）。

### 5.2 朗读阶段（以 Play Books 为例）

```
打开书页
   │
   ▼
content-playbooks.js 从 DOM 提取正文段落
   │  （PAGE_TEXT_UPDATED 消息）
   ▼
background.js 按 sender.tab.url 路由到 background-playbooks.js
   │  文本缓存到 chrome.storage.session
   ▼
用户点 popup「开始」 → content 先查「鼠标选中文字」再查「视口内完整句子」
   │  确定朗读起点（起点之前的正文作为 skipPrefix 交给后台裁掉）
   ▼
chunking.js 按字数/标点切块
   │
   ▼
background-playbooks.js 把文本块发给 offscreen.js
   │
   ▼
offscreen.js 请求 http://127.0.0.1:5005/speak（预取后 5 块）
   │
   ▼
server.py 调 edge_tts 合成 MP3 返回
   │
   ▼
offscreen.js 播放 MP3；同时上报 HIGHLIGHT_CHUNK 高亮当前句
   │
   ▼
读完当前页 → background 自动翻页 → content 提取下一页 → 循环
```

### 5.3 Koodo 平台差异

整章内容通过 `content-koodo.js` 一次性提取完成，不存在"这一页没读完、下一页还没来"的等待场景。因此：
- 直接切块、一次性发给 offscreen 播放；
- **没有** Play Books 那套翻页等待/重试/内容对齐/防缩水循环的状态机；
- 章节读完后正常停止（自动跳章未实现）。

---

## 6. 关键设计决策与坑位记录

| 主题 | 结论 |
|------|------|
| MV3 单 service worker | 一个扩展只能注册一个后台脚本，故 `background.js` 做路由，平台逻辑拆到独立模块（`background-*.js`），彼此零共享 |
| Play Books DOM 适配 | 不同书渲染引擎不同，class 名每本书动态分配不可依赖 → 改为按标签（`p`/`h1~h6`）识别，过滤分页箭头用内容正则而非 class |
| Koodo iframe 限制 | `iframe#kookit-iframe` sandbox 未开 allow-scripts，无法注入 → 顶层页面跨边界读 `contentDocument`（sandbox 开了 allow-same-origin，允许读） |
| 文本切块粒度 | 纯按标点切会把中文对话切太碎 → 改成"先攒 30 字，够字再找标点收尾"；引号类收尾符并入上一句 |
| 朗读起点优先级 | 用户点「开始」时：① 若书页里有鼠标选中的文字（非空选区、起点落在正文段落里），从选中的第一个字开始朗读（选中可能跨段，只取起点）；② 无选中则按视口内第一个完整句子起读。两个平台共用这套规则，各自用 `skipPrefix`（Play Books）/ `segmentIndex+charOffset`（Koodo）实现 |
| 弹窗多语言 | 手动 JS 字典方案（不用 chrome.i18n）：`popup.js` 里按浏览器系统语言（`chrome.i18n.getUILanguage()`）选语言包，简中/繁中/英文为精修基准文案，西/日/韩以英文为源文本翻译；命中 es/ja/ko 及其地区变体用对应语言包，其余语言兜底英文。加语言 = 往 `I18N` 加一个字典块 |
| 合成失败处理 | server 侧 edge_tts 重试 3 次（连接不稳时大概率一两次即过）；offscreen 侧单块再重试 3 次；**不加** asyncio 强制超时（实测在 Windows 上与 edge-tts WebSocket 不兼容，反而全超时），极端卡顿由扩展 background 监控兜底 |
| offscreen 被回收 | Chrome 会关闭长时间无声的 offscreen → 每次发送前重新确认存在，失败重建重试 |
| onefile 图标 | PyInstaller `--icon` 会把完整 7 尺寸嵌入 exe（无"只嵌 16/32"限制）。**对 onefile 跑 rcedit/UpdateResource 会毁 PKG**；换图标唯一安全路径是 `tools/fix_exe_icon_safe.py`（注入后拼回 PKG） |
| 任务栏发糊 | 曾因 launcher 的 `iconbitmap` 用 16px 小帧覆盖 `iconphoto` 高清帧导致；已修复为 iconbitmap 仅兜底 |
| 微信读书 canvas 渲染 | 微信读书正文用 canvas 绘制，无 DOM 语义标签（p/h1等），无法用常规 DOM 提取。方案：MAIN world 注入 hook CanvasRenderingContext2D.fillText，逐字采集字符坐标/字号/字体/transform，重建文本。需注入两次：MAIN world（content-weread-main.js，document_start）hook fillText；isolated world（content-weread.js，document_start）转发消息 |
| 文本污染修复 | 切章时微信读书替换 canvas 元素，旧 canvas 采集的字符未清理，canvasIdx 回收指向新 canvas，导致新旧字符混排（上一章句子被插到新章中间）。修复：fillText 采集记录 `el: canvas` 元素引用；canvasObserver 移除 canvas 时按 `c.el !== removedEl` 同步过滤字符；重建前过滤过期字符；排序 comparator 防御 |
| 高亮坐标校准 | fillText 的 y 是 textBaseline=middle（文字中点），文字顶部 = y - size*0.5。必须应用 ctx.transform() 的 tx/ty 平移（之前忽略导致换文章后高亮错位）。高亮 cssY = (logicalY - size*0.5) * ratio，logicalY = c.y + c.ty/c.scaleY |
| 西语/英语高亮重叠 | 中文等宽字符用 size 估算宽度准确，但西语/英语字符宽度不统一（i窄w宽），统一用 size 导致窄字符框太宽重叠。修复：离屏 canvas measureText 测每个字符实际宽度（带缓存，key=font+char），font 为空时回退到 size |
| 空页检测：视口内可见字符 | 不能用全局 charIndex.length 判断空页——charIndex 是整章采集的（含视口外正文），即使当前页是纯插图，全局 charIndex 也可能 >0。改成统计当前视口内的可见字符数（应用 canvas transform + ratio 计算 absTop），只要视口内有一个可见字符就不是空页（保守判断） |
| 标题页识别 | 微信读书无 heading 语义标签，标题页/封面页（如章节标题）会被误判为正文朗读。方案：background 侧判断新章节文本 <30字 且 无标点 = 标题页，不朗读，直接翻页继续找正文。正文字号基准（前200字符字号众数）识别标题行，插入虚拟句号分隔标题与正文 |
| 书尾判断：指纹必须包含 URL | 空页翻页的书尾判断用指纹比较（连续4次无变化→书尾）。weread 是翻页模式，URL 每次翻页都会变，必须比较 `fp.url === last.url`。漏掉 URL 比较会导致连续插图页每次都被误判为"无变化"（textLen=0/canvasCount/scrollY 都相同），4次后误判为书尾。koodo 是滚动模式 URL 不变，用 imgCount/imgSrcs 判断内容变化 |
| 排序性能：预缓存 canvas rect | charIndex.sort 的 comparator 里每次比较都调用 getBoundingClientRect() 会触发 reflow，大章节（5000-10000字符）排序比较约14万次，直接卡死主线程。修复：排序前预缓存所有 canvas 的 getBoundingClientRect() 到数组，comparator 直接用缓存，getBoundingClientRect 从28万次降到2次 |

---

## 7. 开发常用命令

```bat
:: 打包 onefile（本地桥接）
cd D:\Documents\VoxEcho\VoxEcho-bridge
build.bat

:: 打包 onedir（备用，可 rcedit 改图标）
build_onedir.bat

:: 仅启动 TTS 服务（无 GUI，调试用）
python launcher.py --run-server

:: 手动验证服务
curl http://127.0.0.1:5005/health
```

扩展加载：Chrome → chrome://extensions → 开发者模式 → Load unpacked → 选 `D:\Documents\VoxEcho\VoxEcho-extension`。

---

*本文档由源码阅读整理，如需更新请同步修改对应代码后再改此处。*
