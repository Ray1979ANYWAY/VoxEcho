// ---- 界面语言：根据浏览器系统语言自动选择 ----
// 基准文案（人工精修）：简体中文 / 繁体中文 / 英文。
// 扩充语言包：西班牙语 / 日语 / 韩语，以英文版为源文本翻译。
// 命中规则：zh / zh-CN / zh-SG / zh-MY → 简体；zh-TW / zh-HK / zh-MO → 繁体；
//           es → 西班牙语；ja → 日语；ko → 韩语；其余一律英文兜底。
let UI_LOCALE = "en";

const I18N = {
  "zh-CN": {
    title: "正文提取预览",
    refresh: "刷新提取结果",
    rateLabel: "语速",
    start: "🔊 开始朗读",
    pause: "⏸ 暂停",
    resume: "▶ 继续",
    stop: "⏹ 停止",
    seekBack: "⏪ -5秒",
    seekForward: "⏩ +5秒",
    exportLog: "📋 导出日志",
    clearLog: "🗑 清空日志",
    startAnnotation: "从选定文本开始朗读，或者从页首开始朗读",
    lightTitle: "灰色=未朗读，绿色=正常朗读，红色=正在重试连接",
    hotkeyHint: "先点击书页获得焦点，再按 . 暂停/继续",
    metaEmpty: "尚未提取正文",
    noText:
      "没有提取到正文，可能原因：当前标签页不是 Play Books / Koodo 阅读页面、书页还没加载完，或这本书的 DOM 结构需要重新适配。",
    metaCount: (n) => `共 ${n} 段`,
    synthesizing: "正在合成语音…",
    startFailed: (msg) => `启动失败：${msg}`,
    unknownError: "未知错误",
    stopped: "已停止",
    pausedStatus: "已暂停（关闭这个窗口不影响）",
    readingStatus: "正在朗读（关闭这个窗口不会中断播放）",
    errorStatus: "连接失败，正在自动重试…",
    logEmpty: "日志是空的，还没有可导出的内容",
    exported: (n) => `已导出 ${n} 条日志`,
    logCleared: "日志已清空",
    sponsor: "如果你觉得 VoxEcho 对你有帮助，欢迎请我喝杯咖啡！",
    // 音色分组 / 音色选项
    gZh: "中文", gEn: "英语", gEs: "西班牙语", gJa: "日语", gKo: "韩语",
    vZhXiaoxiao: "中文女声 Xiaoxiao（大陆）",
    vZhHsiaoChen: "中文女声 Hsiao Chen（台湾）",
    vZhYunyang: "中文男声 Yunyang（大陆）",
    vZhYunjian: "中文男声 Yunjian（大陆）",
    vZhHiuMaan: "粤语女声 HiuMaan（香港）",
    vZhWanLung: "粤语男声 WanLung（香港）",
    vEnAria: "英语女声 Aria（美国）",
    vEnMichelle: "英语女声 Michelle（美国）",
    vEnSonia: "英语女声 Sonia（英国）",
    vEnGuy: "英语男声 Guy（美国）",
    vEnAndrew: "英语男声 Andrew（美国）",
    vEnRyan: "英语男声 Ryan（英国）",
    vEsDalia: "西班牙语女声 Dalia（墨西哥）",
    vEsElvira: "西班牙语女声 Elvira（西班牙）",
    vEsJorge: "西班牙语男声 Jorge（墨西哥）",
    vEsAlvaro: "西班牙语男声 Álvaro（西班牙）",
    vJaNanami: "日语女声 Nanami",
    vJaKeita: "日语男声 Keita",
    vKoSunHi: "韩语女声 SunHi",
    vKoInJoon: "韩语男声 InJoon",
  },
  "zh-TW": {
    title: "正文擷取預覽",
    refresh: "重新整理擷取結果",
    rateLabel: "語速",
    start: "🔊 開始朗讀",
    pause: "⏸ 暫停",
    resume: "▶ 繼續",
    stop: "⏹ 停止",
    seekBack: "⏪ -5秒",
    seekForward: "⏩ +5秒",
    exportLog: "📋 匯出日誌",
    clearLog: "🗑 清空日誌",
    startAnnotation: "從選定文字開始朗讀，或從頁首開始朗讀",
    lightTitle: "灰色=未朗讀，綠色=正常朗讀，紅色=正在重試連線",
    hotkeyHint: "先點擊書頁取得焦點，再按 . 暫停/繼續",
    metaEmpty: "尚未擷取正文",
    noText:
      "沒有擷取到正文，可能原因：目前分頁不是 Play Books / Koodo 閱讀頁面、書頁還沒載入完成，或這本書的 DOM 結構需要重新適配。",
    metaCount: (n) => `共 ${n} 段`,
    synthesizing: "正在合成語音…",
    startFailed: (msg) => `啟動失敗：${msg}`,
    unknownError: "未知錯誤",
    stopped: "已停止",
    pausedStatus: "已暫停（關閉這個視窗不影響）",
    readingStatus: "正在朗讀（關閉這個視窗不會中斷播放）",
    errorStatus: "連線失敗，正在自動重試…",
    logEmpty: "日誌是空的，還沒有可匯出的內容",
    exported: (n) => `已匯出 ${n} 條日誌`,
    logCleared: "日誌已清空",
    sponsor: "如果你覺得 VoxEcho 對你有幫助，歡迎請我喝杯咖啡！",
    // 音色分組 / 音色選項
    gZh: "中文", gEn: "英語", gEs: "西班牙語", gJa: "日語", gKo: "韓語",
    vZhXiaoxiao: "中文女聲 Xiaoxiao（中國大陸）",
    vZhHsiaoChen: "中文女聲 Hsiao Chen（台灣）",
    vZhYunyang: "中文男聲 Yunyang（中國大陸）",
    vZhYunjian: "中文男聲 Yunjian（中國大陸）",
    vZhHiuMaan: "粵語女聲 HiuMaan（香港）",
    vZhWanLung: "粵語男聲 WanLung（香港）",
    vEnAria: "英語女聲 Aria（美國）",
    vEnMichelle: "英語女聲 Michelle（美國）",
    vEnSonia: "英語女聲 Sonia（英國）",
    vEnGuy: "英語男聲 Guy（美國）",
    vEnAndrew: "英語男聲 Andrew（美國）",
    vEnRyan: "英語男聲 Ryan（英國）",
    vEsDalia: "西班牙語女聲 Dalia（墨西哥）",
    vEsElvira: "西班牙語女聲 Elvira（西班牙）",
    vEsJorge: "西班牙語男聲 Jorge（墨西哥）",
    vEsAlvaro: "西班牙語男聲 Álvaro（西班牙）",
    vJaNanami: "日語女聲 Nanami",
    vJaKeita: "日語男聲 Keita",
    vKoSunHi: "韓語女聲 SunHi",
    vKoInJoon: "韓語男聲 InJoon",
  },
  en: {
    title: "Text Extraction Preview",
    refresh: "Refresh",
    rateLabel: "Speed",
    start: "🔊 Start Reading",
    pause: "⏸ Pause",
    resume: "▶ Resume",
    stop: "⏹ Stop",
    seekBack: "⏪ -5s",
    seekForward: "⏩ +5s",
    exportLog: "📋 Export Log",
    clearLog: "🗑 Clear Log",
    startAnnotation: "Start reading from the selected text, or from the beginning of the page.",
    lightTitle: "Gray=idle, green=reading, red=retrying",
    hotkeyHint: "Click the page first, then press . to pause/resume",
    metaEmpty: "Not extracted yet",
    noText:
      "No text extracted. Possible causes: the current tab is not a Play Books / Koodo reading page, the page is still loading, or this book's DOM structure needs adaptation.",
    metaCount: (n) => `${n} segments`,
    synthesizing: "Synthesizing audio...",
    startFailed: (msg) => `Failed to start: ${msg}`,
    unknownError: "Unknown error",
    stopped: "Stopped",
    pausedStatus: "Paused (closing this window won't affect playback)",
    readingStatus: "Reading (closing this window won't stop playback)",
    errorStatus: "Connection failed, retrying...",
    logEmpty: "Log is empty, nothing to export",
    exported: (n) => `Exported ${n} log entries`,
    logCleared: "Log cleared",
    sponsor: "If you find VoxEcho helpful, consider buying me a coffee!",
    // Voice groups / voice options
    gZh: "Chinese", gEn: "English", gEs: "Spanish", gJa: "Japanese", gKo: "Korean",
    vZhXiaoxiao: "Chinese Female Xiaoxiao (Mainland China)",
    vZhHsiaoChen: "Chinese Female Hsiao Chen (Taiwan)",
    vZhYunyang: "Chinese Male Yunyang (Mainland China)",
    vZhYunjian: "Chinese Male Yunjian (Mainland China)",
    vZhHiuMaan: "Cantonese Female HiuMaan (Hong Kong)",
    vZhWanLung: "Cantonese Male WanLung (Hong Kong)",
    vEnAria: "English Female Aria (US)",
    vEnMichelle: "English Female Michelle (US)",
    vEnSonia: "English Female Sonia (UK)",
    vEnGuy: "English Male Guy (US)",
    vEnAndrew: "English Male Andrew (US)",
    vEnRyan: "English Male Ryan (UK)",
    vEsDalia: "Spanish Female Dalia (Mexico)",
    vEsElvira: "Spanish Female Elvira (Spain)",
    vEsJorge: "Spanish Male Jorge (Mexico)",
    vEsAlvaro: "Spanish Male Álvaro (Spain)",
    vJaNanami: "Japanese Female Nanami",
    vJaKeita: "Japanese Male Keita",
    vKoSunHi: "Korean Female SunHi",
    vKoInJoon: "Korean Male InJoon",
  },
  es: {
    title: "Vista previa del texto extraído",
    refresh: "Actualizar",
    rateLabel: "Velocidad",
    start: "🔊 Iniciar lectura",
    pause: "⏸ Pausar",
    resume: "▶ Reanudar",
    stop: "⏹ Detener",
    seekBack: "⏪ -5 s",
    seekForward: "⏩ +5 s",
    exportLog: "📋 Exportar registro",
    clearLog: "🗑 Borrar registro",
    startAnnotation: "Inicia la lectura desde el texto seleccionado o desde el inicio de la página.",
    lightTitle: "Gris=sin lectura, verde=leyendo, rojo=reintentando conexión",
    hotkeyHint: "Haz clic en la página y luego presiona . para pausar o reanudar",
    metaEmpty: "Aún no se ha extraído texto",
    noText:
      "No se pudo extraer texto. Posibles causas: la pestaña actual no es una página de lectura de Play Books / Koodo, la página aún no terminó de cargar o el DOM de este libro requiere adaptación.",
    metaCount: (n) => (n === 1 ? "1 segmento" : `${n} segmentos`),
    synthesizing: "Generando audio…",
    startFailed: (msg) => `No se pudo iniciar: ${msg}`,
    unknownError: "Error desconocido",
    stopped: "Detenido",
    pausedStatus: "En pausa (cerrar esta ventana no lo afecta)",
    readingStatus: "Leyendo (cerrar esta ventana no detendrá la reproducción)",
    errorStatus: "Error de conexión, reintentando…",
    logEmpty: "El registro está vacío, no hay nada que exportar",
    exported: (n) => `Se exportaron ${n} entradas de registro`,
    logCleared: "Registro borrado",
    sponsor: "Si VoxEcho te resulta útil, ¡invítame un café!",
    // Voz: grupos / opciones
    gZh: "Chino", gEn: "Inglés", gEs: "Español", gJa: "Japonés", gKo: "Coreano",
    vZhXiaoxiao: "Voz femenina china Xiaoxiao (China continental)",
    vZhHsiaoChen: "Voz femenina china Hsiao Chen (Taiwán)",
    vZhYunyang: "Voz masculina china Yunyang (China continental)",
    vZhYunjian: "Voz masculina china Yunjian (China continental)",
    vZhHiuMaan: "Voz femenina cantonesa HiuMaan (Hong Kong)",
    vZhWanLung: "Voz masculina cantonesa WanLung (Hong Kong)",
    vEnAria: "Voz femenina en inglés Aria (EE. UU.)",
    vEnMichelle: "Voz femenina en inglés Michelle (EE. UU.)",
    vEnSonia: "Voz femenina en inglés Sonia (Reino Unido)",
    vEnGuy: "Voz masculina en inglés Guy (EE. UU.)",
    vEnAndrew: "Voz masculina en inglés Andrew (EE. UU.)",
    vEnRyan: "Voz masculina en inglés Ryan (Reino Unido)",
    vEsDalia: "Voz femenina en español Dalia (México)",
    vEsElvira: "Voz femenina en español Elvira (España)",
    vEsJorge: "Voz masculina en español Jorge (México)",
    vEsAlvaro: "Voz masculina en español Álvaro (España)",
    vJaNanami: "Voz femenina en japonés Nanami",
    vJaKeita: "Voz masculina en japonés Keita",
    vKoSunHi: "Voz femenina en coreano SunHi",
    vKoInJoon: "Voz masculina en coreano InJoon",
  },
  ja: {
    title: "抽出テキストのプレビュー",
    refresh: "更新",
    rateLabel: "速度",
    start: "🔊 読み上げ開始",
    pause: "⏸ 一時停止",
    resume: "▶ 再開",
    stop: "⏹ 停止",
    seekBack: "⏪ -5秒",
    seekForward: "⏩ +5秒",
    exportLog: "📋 ログをエクスポート",
    clearLog: "🗑 ログをクリア",
    startAnnotation: "選択したテキストから、またはページの先頭から読み上げを開始します。",
    lightTitle: "グレー=停止中、緑=読み上げ中、赤=接続再試行中",
    hotkeyHint: "ページをクリックしてから . キーで一時停止/再開",
    metaEmpty: "まだ抽出されていません",
    noText:
      "本文を抽出できませんでした。考えられる原因：現在のタブが Play Books / Koodo の読書ページではない、ページが読み込み中、またはこの本のDOM構造に適応が必要。",
    metaCount: (n) => `${n} セグメント`,
    synthesizing: "音声を生成中…",
    startFailed: (msg) => `開始に失敗しました：${msg}`,
    unknownError: "不明なエラー",
    stopped: "停止しました",
    pausedStatus: "一時停止中（このウィンドウを閉じても影響しません）",
    readingStatus: "読み上げ中（このウィンドウを閉じても再生は続きます）",
    errorStatus: "接続に失敗しました。再試行中…",
    logEmpty: "ログは空です。エクスポートする内容がありません",
    exported: (n) => `${n} 件のログをエクスポートしました`,
    logCleared: "ログをクリアしました",
    sponsor: "VoxEcho が役に立ったら、コーヒーをごちそうしてください！",
    // 音声：グループ / オプション
    gZh: "中国語", gEn: "英語", gEs: "スペイン語", gJa: "日本語", gKo: "韓国語",
    vZhXiaoxiao: "中国語（女性）Xiaoxiao（中国本土）",
    vZhHsiaoChen: "中国語（女性）Hsiao Chen（台湾）",
    vZhYunyang: "中国語（男性）Yunyang（中国本土）",
    vZhYunjian: "中国語（男性）Yunjian（中国本土）",
    vZhHiuMaan: "広東語（女性）HiuMaan（香港）",
    vZhWanLung: "広東語（男性）WanLung（香港）",
    vEnAria: "英語（女性）Aria（米国）",
    vEnMichelle: "英語（女性）Michelle（米国）",
    vEnSonia: "英語（女性）Sonia（英国）",
    vEnGuy: "英語（男性）Guy（米国）",
    vEnAndrew: "英語（男性）Andrew（米国）",
    vEnRyan: "英語（男性）Ryan（英国）",
    vEsDalia: "スペイン語（女性）Dalia（メキシコ）",
    vEsElvira: "スペイン語（女性）Elvira（スペイン）",
    vEsJorge: "スペイン語（男性）Jorge（メキシコ）",
    vEsAlvaro: "スペイン語（男性）Álvaro（スペイン）",
    vJaNanami: "日本語（女性）Nanami",
    vJaKeita: "日本語（男性）Keita",
    vKoSunHi: "韓国語（女性）SunHi",
    vKoInJoon: "韓国語（男性）InJoon",
  },
  ko: {
    title: "텍스트 추출 미리보기",
    refresh: "새로고침",
    rateLabel: "속도",
    start: "🔊 읽기 시작",
    pause: "⏸ 일시정지",
    resume: "▶ 계속",
    stop: "⏹ 정지",
    seekBack: "⏪ -5초",
    seekForward: "⏩ +5초",
    exportLog: "📋 로그 내보내기",
    clearLog: "🗑 로그 지우기",
    startAnnotation: "선택한 텍스트에서 읽기를 시작하거나 페이지의 처음부터 읽습니다.",
    lightTitle: "회색=정지, 초록=읽는 중, 빨강=재연결 중",
    hotkeyHint: "페이지를 클릭한 뒤 . 키로 일시정지/계속",
    metaEmpty: "아직 추출되지 않음",
    noText:
      "본문을 추출하지 못했습니다. 가능한 원인: 현재 탭이 Play Books / Koodo 읽기 페이지가 아님, 페이지가 아직 로딩 중, 또는 이 책의 DOM 구조에 대한 적응이 필요함.",
    metaCount: (n) => `${n}개 문단`,
    synthesizing: "음성 생성 중…",
    startFailed: (msg) => `시작 실패: ${msg}`,
    unknownError: "알 수 없는 오류",
    stopped: "정지됨",
    pausedStatus: "일시정지됨 (이 창을 닫아도 영향 없음)",
    readingStatus: "읽는 중 (이 창을 닫아도 재생이 멈추지 않음)",
    errorStatus: "연결 실패, 다시 시도 중…",
    logEmpty: "로그가 비어 있어 내보낼 내용이 없습니다",
    exported: (n) => `로그 ${n}개를 내보냈습니다`,
    logCleared: "로그를 지웠습니다",
    sponsor: "VoxEcho가 도움이 되셨다면 커피 한 잔 사주시면 감사하겠습니다!",
    // 음성: 그룹 / 옵션
    gZh: "중국어", gEn: "영어", gEs: "스페인어", gJa: "일본어", gKo: "한국어",
    vZhXiaoxiao: "중국어 여성 Xiaoxiao (중국 본토)",
    vZhHsiaoChen: "중국어 여성 Hsiao Chen (대만)",
    vZhYunyang: "중국어 남성 Yunyang (중국 본토)",
    vZhYunjian: "중국어 남성 Yunjian (중국 본토)",
    vZhHiuMaan: "광둥어 여성 HiuMaan (홍콩)",
    vZhWanLung: "광둥어 남성 WanLung (홍콩)",
    vEnAria: "영어 여성 Aria (미국)",
    vEnMichelle: "영어 여성 Michelle (미국)",
    vEnSonia: "영어 여성 Sonia (영국)",
    vEnGuy: "영어 남성 Guy (미국)",
    vEnAndrew: "영어 남성 Andrew (미국)",
    vEnRyan: "영어 남성 Ryan (영국)",
    vEsDalia: "스페인어 여성 Dalia (멕시코)",
    vEsElvira: "스페인어 여성 Elvira (스페인)",
    vEsJorge: "스페인어 남성 Jorge (멕시코)",
    vEsAlvaro: "스페인어 남성 Álvaro (스페인)",
    vJaNanami: "일본어 여성 Nanami",
    vJaKeita: "일본어 남성 Keita",
    vKoSunHi: "한국어 여성 SunHi",
    vKoInJoon: "한국어 남성 InJoon",
  },
};

function detectUiLanguage() {
  let raw = "";
  try {
    raw = chrome.i18n.getUILanguage() || navigator.language || "";
  } catch (e) {
    raw = navigator.language || "";
  }
  const lang = String(raw).replace("_", "-").toLowerCase();
  const primary = lang.split("-")[0];
  if (primary === "zh") {
    // 中文再细分简繁：无地区或新加坡/马来西亚等默认简体，台/港/澳为繁体
    if (lang === "zh" || lang.startsWith("zh-cn") || lang.startsWith("zh-sg") || lang.startsWith("zh-my")) {
      return "zh-CN";
    }
    if (lang.startsWith("zh-tw") || lang.startsWith("zh-hk") || lang.startsWith("zh-mo")) {
      return "zh-TW";
    }
    return "zh-CN";
  }
  if (primary === "es") return "es"; // 西班牙语（覆盖所有西语地区变体）
  if (primary === "ja") return "ja"; // 日语
  if (primary === "ko") return "ko"; // 韩语
  return "en"; // 其余一律英文兜底
}

function t(key) {
  return I18N[UI_LOCALE][key];
}

// 音色选项数据：分组标签和每条音色都走 I18N，用 labelKey 引用对应文案。
const VOICE_GROUPS = [
  {
    labelKey: "gZh",
    options: [
      { value: "zh-CN-XiaoxiaoNeural", labelKey: "vZhXiaoxiao" },
      { value: "zh-TW-HsiaoChenNeural", labelKey: "vZhHsiaoChen" },
      { value: "zh-CN-YunyangNeural", labelKey: "vZhYunyang" },
      { value: "zh-CN-YunjianNeural", labelKey: "vZhYunjian" },
      { value: "zh-HK-HiuMaanNeural", labelKey: "vZhHiuMaan" },
      { value: "zh-HK-WanLungNeural", labelKey: "vZhWanLung" },
    ],
  },
  {
    labelKey: "gEn",
    options: [
      { value: "en-US-AriaNeural", labelKey: "vEnAria" },
      { value: "en-US-MichelleNeural", labelKey: "vEnMichelle" },
      { value: "en-GB-SoniaNeural", labelKey: "vEnSonia" },
      { value: "en-US-GuyNeural", labelKey: "vEnGuy" },
      { value: "en-US-AndrewNeural", labelKey: "vEnAndrew" },
      { value: "en-GB-RyanNeural", labelKey: "vEnRyan" },
    ],
  },
  {
    labelKey: "gEs",
    options: [
      { value: "es-MX-DaliaNeural", labelKey: "vEsDalia" },
      { value: "es-ES-ElviraNeural", labelKey: "vEsElvira" },
      { value: "es-MX-JorgeNeural", labelKey: "vEsJorge" },
      { value: "es-ES-AlvaroNeural", labelKey: "vEsAlvaro" },
    ],
  },
  {
    labelKey: "gJa",
    options: [
      { value: "ja-JP-NanamiNeural", labelKey: "vJaNanami" },
      { value: "ja-JP-KeitaNeural", labelKey: "vJaKeita" },
    ],
  },
  {
    labelKey: "gKo",
    options: [
      { value: "ko-KR-SunHiNeural", labelKey: "vKoSunHi" },
      { value: "ko-KR-InJoonNeural", labelKey: "vKoInJoon" },
    ],
  },
];

function buildVoiceOptions() {
  const select = document.getElementById("voice");
  select.innerHTML = "";
  VOICE_GROUPS.forEach((group) => {
    const og = document.createElement("optgroup");
    og.label = t(group.labelKey);
    group.options.forEach((opt) => {
      const option = document.createElement("option");
      option.value = opt.value;
      option.textContent = t(opt.labelKey);
      og.appendChild(option);
    });
    select.appendChild(og);
  });
}

// 把界面整体切成当前语言：语言标记、标题、静态文案、状态灯提示、新增的朗读起点注释、音色选项。
function applyUiLanguage() {
  const s = I18N[UI_LOCALE];
  document.documentElement.lang = UI_LOCALE;
  document.title = s.title;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    if (s[key]) el.textContent = s[key];
  });
  const light = document.getElementById("statusLight");
  if (light) light.title = s.lightTitle;
  // 暂停/继续按钮文案由 syncButtons 动态管理，这里先铺好当前语言的默认值，
  // 避免轮询响应到达前短暂闪现英文默认文案
  const pauseResumeBtn = document.getElementById("pauseResume");
  if (pauseResumeBtn) pauseResumeBtn.textContent = s.pause;
  buildVoiceOptions();
}

function render(result) {
  const meta = document.getElementById("meta");
  const list = document.getElementById("list");
  list.innerHTML = "";

  if (!result || !result.data || result.data.length === 0) {
    meta.textContent = t("noText");
    return;
  }

  meta.textContent = `${t("metaCount")(result.data.length)} · ${new Date(
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
  const light = document.getElementById("statusLight");

  const isReading = !!(state && state.isReading);
  const isPaused = !!(state && state.isPaused);
  const connectionStatus = (state && state.connectionStatus) || "idle";

  startBtn.disabled = isReading;
  pauseResumeBtn.disabled = !isReading;
  stopBtn.disabled = !isReading;
  pauseResumeBtn.textContent = isPaused ? t("resume") : t("pause");

  const seekBackBtn = document.getElementById("seekBack");
  const seekForwardBtn = document.getElementById("seekForward");
  seekBackBtn.disabled = !isReading;
  seekForwardBtn.disabled = !isReading;

  light.classList.remove("green", "red");
  if (isReading) {
    light.classList.add(connectionStatus === "error" ? "red" : "green");
    setStatus(
      isPaused
        ? t("pausedStatus")
        : connectionStatus === "error"
        ? t("errorStatus")
        : t("readingStatus"),
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
  setStatus(t("synthesizing"));
  chrome.runtime.sendMessage({ type: "START_READING", voice, rate }, (result) => {
    if (!result || !result.ok) {
      setStatus(t("startFailed")((result && result.error) || t("unknownError")), "error");
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
    setStatus(t("stopped"));
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
      setStatus(t("logEmpty"), "error");
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
    setStatus(t("exported")(result.count), "ok");
  });
});

document.getElementById("clearLog").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CLEAR_DIAG_LOG" }, () => {
    setStatus(t("logCleared"), "ok");
  });
});

// 启动：先按浏览器系统语言铺好界面，再恢复上次偏好、拉取内容、轮询朗读状态
UI_LOCALE = detectUiLanguage();
applyUiLanguage();
restoreLastVoice();
restoreLastRate();
fetchLatest();
refreshReadingState();
startPolling();
