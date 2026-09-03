# -*- coding: utf-8 -*-
"""
ebooks-tts bridge launcher
Left controls + right terminal log + tray
UI language: zh-CN / zh-TW / en (auto from system)
"""
from __future__ import annotations

import json
import locale
import os
import queue
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

HOST, PORT = "127.0.0.1", 5005
REQUIRED_PKGS = ["edge-tts", "flask", "flask-cors"]
MIN_PY = (3, 10)

# ---------------------------------------------------------------------------
# i18n
# ---------------------------------------------------------------------------

def detect_ui_lang() -> str:
    """Return 'zh-CN' | 'zh-TW' | 'en'."""
    candidates = []
    try:
        loc = locale.getdefaultlocale()
        if loc and loc[0]:
            candidates.append(loc[0])
    except Exception:
        pass
    for key in ("LANG", "LC_ALL", "LC_MESSAGES"):
        v = os.environ.get(key)
        if v:
            candidates.append(v)
    if sys.platform == "win32":
        try:
            import ctypes

            buf = ctypes.create_unicode_buffer(85)
            # GetUserDefaultLocaleName
            if hasattr(ctypes.windll.kernel32, "GetUserDefaultLocaleName"):
                n = ctypes.windll.kernel32.GetUserDefaultLocaleName(buf, 85)
                if n:
                    candidates.insert(0, buf.value)
        except Exception:
            pass
        try:
            # e.g. Chinese (Simplified)_China.utf8
            candidates.append(locale.setlocale(locale.LC_ALL, ""))
        except Exception:
            pass

    blob = " ".join(candidates).replace("-", "_").lower()
    # Traditional first (more specific tags)
    if any(
        x in blob
        for x in (
            "zh_tw",
            "zh_hk",
            "zh_mo",
            "zh_hant",
            "chinese (traditional)",
            "cht",
        )
    ):
        return "zh-TW"
    if any(
        x in blob
        for x in (
            "zh_cn",
            "zh_sg",
            "zh_hans",
            "chinese (simplified)",
            "chs",
            "zh",
        )
    ):
        # bare "zh" without tw/hk → simplified (common on mainland)
        if "zh_tw" in blob or "zh_hk" in blob or "zh_mo" in blob or "hant" in blob:
            return "zh-TW"
        return "zh-CN"
    return "en"


_LANG = detect_ui_lang()

_TEXTS = {
    "en": {
        "title": "VoxEcho Voice Bridge",
        "heading": "VoxEcho local bridge",
        "status_stopped": "Status: stopped",
        "status_running": "Status: running  http://{host}:{port}",
        "status_env_bad": "Status: environment not ready",
        "hint": (
            "Keep this program running so the Chrome extension can read aloud.\n"
            "Closing the window minimizes to the tray (does not exit).\n"
            "To quit fully: tray icon → Exit."
        ),
        "autostart": "Start with Windows (keep running)",
        "btn_start": "Start service",
        "btn_stop": "Stop service",
        "btn_health": "Health check",
        "btn_open_health": "Open health page",
        "howto": (
            "How to use:\n"
            "1. Keep this app running (window or tray)\n"
            "2. Load the extension in Chrome\n"
            "3. Open Play Books / Koodo and start reading"
        ),
        "log_title": "Log (terminal)",
        "env_error_title": "Environment error",
        "env_error_body": "Dependencies are not ready. See the log panel.",
        "start_warn_title": "Start",
        "start_warn_body": "Service may not be ready. Check the log panel.",
        "health_ok_title": "Health check",
        "health_ok_body": "Service is healthy\nhttp://{host}:{port}/health",
        "health_fail_title": "Health check",
        "health_fail_body": "No response. Please start the service first.",
        "exit_confirm_title": "Exit",
        "exit_confirm_body": "The extension cannot read aloud after exit. Quit anyway?",
        "welcome_title": "Welcome to VoxEcho bridge",
        "welcome_body": (
            "Keep this program running so the Chrome extension can read aloud.\n\n"
            "You can enable Start with Windows.\n"
            "Closing the window goes to the tray (if available)."
        ),
        "tray_show": "Show window",
        "tray_start": "Start service",
        "tray_stop": "Stop service",
        "tray_exit": "Exit",
        "tray_tooltip": "VoxEcho bridge",
        "log_packed": "Running as packaged app; skip Python/pip checks.",
        "log_python": "Python: {v}",
        "log_need_py": "Error: need Python >= {a}.{b}",
        "log_deps_ok": "Dependencies OK.",
        "log_deps_missing": "Missing: {pkgs}. Installing with pip…",
        "log_pip_fail": "pip failed: {err}",
        "log_pip_ok": "Dependencies installed.",
        "log_pip_exc": "pip error: {e}",
        "log_already": "Service already running.",
        "log_reuse": "Healthy service already on port; reusing it.",
        "log_port_busy": "Port {port} is in use by another program.",
        "log_start_cmd": "Starting: {cmd}",
        "log_start_fail": "Start failed: {e}",
        "log_ready": "Bridge ready -> http://{host}:{port}",
        "log_proc_exit": "Service process exited.",
        "log_timeout": "Timed out waiting for ready. See log.",
        "log_not_running": "Service is not running.",
        "log_stopping": "Stopping service…",
        "log_stopped": "Service stopped.",
        "log_shortcut_ok": "Desktop shortcut created: {name}",
        "log_shortcut_fail": "Desktop shortcut failed (ignored): {e}",
        "log_autostart_on": "Start with Windows: enabled.",
        "log_autostart_off": "Start with Windows: disabled.",
        "log_autostart_fail": "Autostart setting failed: {e}",
        "log_autostart_os": "Autostart is only supported on Windows.",
        "log_tray_ok": "Tray icon ready.",
        "log_tray_missing": "pystray/Pillow not installed; closing window will ask to quit.",
        "log_min_tray": "Minimized to tray.",
        "log_boot": "VoxEcho voice bridge launcher",
        "log_workdir": "Working directory: {d}",
        "log_first": "First-run setup done.",
        "log_user_start": "—— User clicked Start ——",
        "log_health_ok": "Health check: OK",
        "log_health_fail": "Health check: failed",
        "shortcut_name": "VoxEcho Voice Bridge.lnk",
    },
    "zh-CN": {
        "title": "VoxEcho 语音桥接",
        "heading": "VoxEcho 本地桥接",
        "status_stopped": "状态：未启动",
        "status_running": "状态：运行中  http://{host}:{port}",
        "status_env_bad": "状态：环境未就绪",
        "hint": (
            "请保持本程序运行，Chrome 扩展才能朗读。\n"
            "关闭窗口会最小化到托盘（不会退出）。\n"
            "完全退出：托盘图标 → 退出。"
        ),
        "autostart": "开机时自动启动本程序（常驻）",
        "btn_start": "启动服务",
        "btn_stop": "停止服务",
        "btn_health": "健康检查",
        "btn_open_health": "打开健康页",
        "howto": (
            "使用顺序：\n"
            "1. 本程序保持运行（窗口或托盘）\n"
            "2. Chrome 加载扩展\n"
            "3. 打开 Play 图书 / Koodo 朗读"
        ),
        "log_title": "运行日志（终端）",
        "env_error_title": "环境错误",
        "env_error_body": "依赖未就绪，请查看右侧日志。",
        "start_warn_title": "启动",
        "start_warn_body": "服务可能未就绪，请看右侧日志。",
        "health_ok_title": "健康检查",
        "health_ok_body": "服务正常\nhttp://{host}:{port}/health",
        "health_fail_title": "健康检查",
        "health_fail_body": "服务未响应，请先启动。",
        "exit_confirm_title": "退出",
        "exit_confirm_body": "关闭后扩展将无法朗读。确定退出？",
        "welcome_title": "欢迎使用 VoxEcho 桥接",
        "welcome_body": (
            "请保持本程序运行，Chrome 扩展才能朗读。\n\n"
            "可勾选「开机启动」。\n"
            "关闭窗口会进入托盘（若可用）。"
        ),
        "tray_show": "显示主窗口",
        "tray_start": "启动服务",
        "tray_stop": "停止服务",
        "tray_exit": "退出",
        "tray_tooltip": "VoxEcho 桥接",
        "log_packed": "已打包运行，跳过 Python / pip 检测。",
        "log_python": "当前 Python: {v}",
        "log_need_py": "错误：需要 Python >= {a}.{b}",
        "log_deps_ok": "依赖已齐全。",
        "log_deps_missing": "缺少依赖: {pkgs}，开始 pip 安装…",
        "log_pip_fail": "pip 失败: {err}",
        "log_pip_ok": "依赖安装完成。",
        "log_pip_exc": "pip 异常: {e}",
        "log_already": "服务已在运行。",
        "log_reuse": "检测到端口上已有健康服务，直接使用。",
        "log_port_busy": "端口 {port} 被占用且不是本桥接。",
        "log_start_cmd": "启动: {cmd}",
        "log_start_fail": "启动失败: {e}",
        "log_ready": "桥接已就绪 -> http://{host}:{port}",
        "log_proc_exit": "服务进程已退出。",
        "log_timeout": "等待就绪超时，请看右侧日志。",
        "log_not_running": "服务未在运行。",
        "log_stopping": "正在停止服务…",
        "log_stopped": "服务已停止。",
        "log_shortcut_ok": "已创建桌面快捷方式: {name}",
        "log_shortcut_fail": "桌面快捷方式失败(可忽略): {e}",
        "log_autostart_on": "已设置开机启动。",
        "log_autostart_off": "已取消开机启动。",
        "log_autostart_fail": "设置开机启动失败: {e}",
        "log_autostart_os": "开机启动仅支持 Windows。",
        "log_tray_ok": "托盘图标已就绪。",
        "log_tray_missing": "未安装 pystray/Pillow，关闭窗口将询问是否退出。",
        "log_min_tray": "已最小化到托盘。",
        "log_boot": "VoxEcho 语音桥接启动器",
        "log_workdir": "工作目录: {d}",
        "log_first": "首次运行初始化完成。",
        "log_user_start": "—— 用户点击启动 ——",
        "log_health_ok": "健康检查：OK",
        "log_health_fail": "健康检查：失败",
        "shortcut_name": "VoxEcho 语音桥接.lnk",
    },
    "zh-TW": {
        "title": "VoxEcho 語音橋接",
        "heading": "VoxEcho 本機橋接",
        "status_stopped": "狀態：未啟動",
        "status_running": "狀態：執行中  http://{host}:{port}",
        "status_env_bad": "狀態：環境未就緒",
        "hint": (
            "請保持本程式執行，Chrome 擴充功能才能朗讀。\n"
            "關閉視窗會最小化到系統匣（不會結束）。\n"
            "完全結束：系統匣圖示 → 結束。"
        ),
        "autostart": "開機時自動啟動本程式（常駐）",
        "btn_start": "啟動服務",
        "btn_stop": "停止服務",
        "btn_health": "健康檢查",
        "btn_open_health": "開啟健康頁",
        "howto": (
            "使用順序：\n"
            "1. 本程式保持執行（視窗或系統匣）\n"
            "2. 在 Chrome 載入擴充功能\n"
            "3. 開啟 Play 圖書 / Koodo 並朗讀"
        ),
        "log_title": "執行記錄（終端）",
        "env_error_title": "環境錯誤",
        "env_error_body": "相依套件未就緒，請查看右側記錄。",
        "start_warn_title": "啟動",
        "start_warn_body": "服務可能尚未就緒，請查看右側記錄。",
        "health_ok_title": "健康檢查",
        "health_ok_body": "服務正常\nhttp://{host}:{port}/health",
        "health_fail_title": "健康檢查",
        "health_fail_body": "服務無回應，請先啟動。",
        "exit_confirm_title": "結束",
        "exit_confirm_body": "結束後擴充功能將無法朗讀。確定結束？",
        "welcome_title": "歡迎使用 VoxEcho 橋接",
        "welcome_body": (
            "請保持本程式執行，Chrome 擴充功能才能朗讀。\n\n"
            "可勾選「開機啟動」。\n"
            "關閉視窗會進入系統匣（若可用）。"
        ),
        "tray_show": "顯示主視窗",
        "tray_start": "啟動服務",
        "tray_stop": "停止服務",
        "tray_exit": "結束",
        "tray_tooltip": "VoxEcho 橋接",
        "log_packed": "已打包執行，略過 Python / pip 偵測。",
        "log_python": "目前 Python: {v}",
        "log_need_py": "錯誤：需要 Python >= {a}.{b}",
        "log_deps_ok": "相依套件已齊全。",
        "log_deps_missing": "缺少套件: {pkgs}，開始以 pip 安裝…",
        "log_pip_fail": "pip 失敗: {err}",
        "log_pip_ok": "相依套件安裝完成。",
        "log_pip_exc": "pip 例外: {e}",
        "log_already": "服務已在執行。",
        "log_reuse": "偵測到連接埠上已有健康服務，直接使用。",
        "log_port_busy": "連接埠 {port} 被占用且不是本橋接。",
        "log_start_cmd": "啟動: {cmd}",
        "log_start_fail": "啟動失敗: {e}",
        "log_ready": "橋接已就緒 -> http://{host}:{port}",
        "log_proc_exit": "服務行程已結束。",
        "log_timeout": "等待就緒逾時，請查看右側記錄。",
        "log_not_running": "服務未在執行。",
        "log_stopping": "正在停止服務…",
        "log_stopped": "服務已停止。",
        "log_shortcut_ok": "已建立桌面捷徑: {name}",
        "log_shortcut_fail": "桌面捷徑失敗(可忽略): {e}",
        "log_autostart_on": "已設定開機啟動。",
        "log_autostart_off": "已取消開機啟動。",
        "log_autostart_fail": "設定開機啟動失敗: {e}",
        "log_autostart_os": "開機啟動僅支援 Windows。",
        "log_tray_ok": "系統匣圖示已就緒。",
        "log_tray_missing": "未安裝 pystray/Pillow，關閉視窗將詢問是否結束。",
        "log_min_tray": "已最小化到系統匣。",
        "log_boot": "VoxEcho 語音橋接啟動器",
        "log_workdir": "工作目錄: {d}",
        "log_first": "首次執行初始化完成。",
        "log_user_start": "—— 使用者點選啟動 ——",
        "log_health_ok": "健康檢查：OK",
        "log_health_fail": "健康檢查：失敗",
        "shortcut_name": "VoxEcho 語音橋接.lnk",
    },
}


def t(key: str, **kwargs) -> str:
    table = _TEXTS.get(_LANG) or _TEXTS["en"]
    s = table.get(key) or _TEXTS["en"].get(key) or key
    if kwargs:
        try:
            return s.format(**kwargs)
        except Exception:
            return s
    return s


# ---------------------------------------------------------------------------
# paths
# ---------------------------------------------------------------------------

def app_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def resource_path(*parts: str) -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(getattr(sys, "_MEIPASS")).joinpath(*parts)
    return app_dir().joinpath(*parts)


APP_DIR = app_dir()
CONFIG_PATH = APP_DIR / "bridge_config.json"
log_queue: "queue.Queue[str]" = queue.Queue()


def ui_log(msg: str) -> None:
    ts = time.strftime("%H:%M:%S")
    log_queue.put("[%s] %s" % (ts, msg))


def load_config() -> dict:
    defaults = {"autostart": False, "first_run_done": False}
    if CONFIG_PATH.exists():
        try:
            data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            defaults.update(data)
        except Exception:
            pass
    return defaults


def save_config(cfg: dict) -> None:
    try:
        CONFIG_PATH.write_text(
            json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except Exception:
        pass


def ensure_environment(log=ui_log) -> bool:
    if getattr(sys, "frozen", False):
        log(t("log_packed"))
        return True
    ver = sys.version_info
    log(t("log_python", v="%d.%d.%d" % (ver.major, ver.minor, ver.micro)))
    if (ver.major, ver.minor) < MIN_PY:
        log(t("log_need_py", a=MIN_PY[0], b=MIN_PY[1]))
        log("https://www.python.org/downloads/")
        return False
    import importlib.util

    missing = []
    mapping = {
        "edge-tts": "edge_tts",
        "flask": "flask",
        "flask-cors": "flask_cors",
    }
    for name in REQUIRED_PKGS:
        mod = mapping.get(name, name.replace("-", "_"))
        if importlib.util.find_spec(mod) is None:
            missing.append(name)
    if not missing:
        log(t("log_deps_ok"))
        return True
    log(t("log_deps_missing", pkgs=", ".join(missing)))
    cmd = [sys.executable, "-m", "pip", "install", "-U"] + missing
    try:
        p = subprocess.run(
            cmd, capture_output=True, text=True, encoding="utf-8", errors="replace"
        )
        if p.stdout:
            for line in p.stdout.splitlines()[-20:]:
                log(line)
        if p.returncode != 0:
            log(t("log_pip_fail", err=(p.stderr or "")[-400:]))
            return False
        log(t("log_pip_ok"))
        return True
    except Exception as e:
        log(t("log_pip_exc", e=e))
        return False


def port_open() -> bool:
    try:
        with socket.create_connection((HOST, PORT), timeout=0.5):
            return True
    except OSError:
        return False


def health_ok() -> bool:
    try:
        import urllib.request

        with urllib.request.urlopen(
            "http://%s:%d/health" % (HOST, PORT), timeout=2
        ) as r:
            return r.status == 200
    except Exception:
        return False


def desktop_path() -> Path:
    return Path(os.path.expanduser("~")) / "Desktop"


def startup_folder() -> Path:
    appdata = os.environ.get("APPDATA", "")
    return Path(appdata) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"


def exe_or_script() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve()
    return Path(__file__).resolve()


def create_shortcut(link_path: Path, target: Path) -> None:
    if sys.platform != "win32":
        return
    target_s = str(target).replace("'", "''")
    link_s = str(link_path).replace("'", "''")
    work_s = str(target.parent).replace("'", "''")
    ps = (
        "$ws = New-Object -ComObject WScript.Shell; "
        "$s = $ws.CreateShortcut('%s'); "
        "$s.TargetPath = '%s'; "
        "$s.WorkingDirectory = '%s'; "
        "$s.Save()"
    ) % (link_s, target_s, work_s)
    subprocess.run(
        ["powershell", "-NoProfile", "-Command", ps],
        capture_output=True,
        text=True,
    )


def ensure_desktop_shortcut(log=ui_log) -> None:
    if sys.platform != "win32":
        return
    link = desktop_path() / t("shortcut_name")
    if link.exists():
        return
    try:
        create_shortcut(link, exe_or_script())
        log(t("log_shortcut_ok", name=link.name))
    except Exception as e:
        log(t("log_shortcut_fail", e=e))


def set_autostart(enabled: bool, log=ui_log) -> None:
    if sys.platform != "win32":
        log(t("log_autostart_os"))
        return
    link = startup_folder() / "VoxEcho-bridge.lnk"
    try:
        if enabled:
            startup_folder().mkdir(parents=True, exist_ok=True)
            create_shortcut(link, exe_or_script())
            log(t("log_autostart_on"))
        else:
            if link.exists():
                link.unlink()
            log(t("log_autostart_off"))
    except Exception as e:
        log(t("log_autostart_fail", e=e))


class BridgeService:
    def __init__(self):
        self.proc = None

    def running(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def start(self, log=ui_log) -> bool:
        if self.running():
            log(t("log_already"))
            return True
        if port_open() and health_ok():
            log(t("log_reuse"))
            return True
        if port_open() and not health_ok():
            log(t("log_port_busy", port=PORT))
            return False

        if getattr(sys, "frozen", False):
            cmd = [str(sys.executable), "--run-server"]
        else:
            server_py = app_dir() / "server.py"
            cmd = [sys.executable, str(server_py)]

        log(t("log_start_cmd", cmd=" ".join(cmd)))
        try:
            self.proc = subprocess.Popen(
                cmd,
                cwd=str(APP_DIR),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
            )
        except Exception as e:
            log(t("log_start_fail", e=e))
            return False

        def pump():
            assert self.proc and self.proc.stdout
            for line in self.proc.stdout:
                line = line.rstrip("\n\r")
                if line:
                    log_queue.put(line)

        threading.Thread(target=pump, daemon=True).start()

        for _ in range(50):
            time.sleep(0.2)
            if health_ok():
                log(t("log_ready", host=HOST, port=PORT))
                return True
            if self.proc.poll() is not None:
                log(t("log_proc_exit"))
                return False
        log(t("log_timeout"))
        return False

    def stop(self, log=ui_log) -> None:
        if not self.running():
            log(t("log_not_running"))
            return
        assert self.proc
        log(t("log_stopping"))
        try:
            self.proc.terminate()
            self.proc.wait(timeout=5)
        except Exception:
            try:
                self.proc.kill()
            except Exception:
                pass
        self.proc = None
        log(t("log_stopped"))


service = BridgeService()




def resolve_app_icon_ico() -> Path | None:
    """Path to .ico for window title bar + taskbar."""
    candidates = [
        APP_DIR / "VoxEcho.ico",
        APP_DIR / "icon" / "VoxEcho.ico",
        resource_path("VoxEcho.ico"),
        resource_path("icon", "VoxEcho.ico"),
    ]
    for p in candidates:
        try:
            if p.exists():
                return p
        except Exception:
            continue
    return None


def set_windows_app_id(app_id: str = "VoxEcho.Bridge.1") -> None:
    """让任务栏按「正式应用」处理，优先用 exe 内嵌多尺寸图标，减少发糊。"""
    if sys.platform != "win32":
        return
    try:
        import ctypes

        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(app_id)
    except Exception:
        pass


def apply_window_icons(root) -> None:
    """
    设置窗口/任务栏图标。

    【背景 / 为什么这样写】
    Tk 的 iconbitmap 在高 DPI 下常只用到 ico 里较小的一帧导致发糊；
    这里用 PIL 取出 ico 中最大一帧，再 iconphoto 提交高清图。

    【历史修复记录（重要，勿回退）】
    早期版本在 iconphoto(256px 高清) 之后无条件调用 iconbitmap(ico)，
    后者会用 ico 里的 16x16 小帧覆盖掉刚提交的高清图，导致任务栏发糊。
    已修复：iconbitmap 仅作 iconphoto 失败时的兜底，不再覆盖高清图。

    【完整图标链路（配合 build.bat）】
    - build.bat 的 --icon VoxEcho.ico
      → 把 7 尺寸(16~256)图标内嵌进 exe 的 PE 资源
      → 资源管理器里看 exe 文件 = 清晰（与运行时无关，一直正常）
    - build.bat 的 --add-data VoxEcho.ico;.
      → 把 ICO 打包进 PKG 归档
      → 运行时 resource_path("VoxEcho.ico") 从解压目录取到 ICO
      → 本函数取最大帧(256px)经 iconphoto 提交 = 任务栏清晰
    - 发布只需单 exe：两条链路都在 exe 内部，无需 exe 旁再放 ico。

    【警告】
    对 onefile exe 运行 rcedit / Resource Hacker / UpdateResource
    改图标会重写整个 exe 并丢弃末尾 PKG 归档（报 "embedded PKG
    archive" 错误）。onefile 换图标只能用 tools/fix_exe_icon_safe.py
    （注入后原样拼回 PKG），日常构建不需要。
    """
    ico = resolve_app_icon_ico()
    if ico is None:
        return

    # 1) 尽量提供高分辨率 PhotoImage（任务栏/标题栏更清晰）
    photo_ok = False
    try:
        from PIL import Image, ImageTk

        im = Image.open(ico)
        # ICO 可能含多帧：选像素最多的一帧
        best = im
        try:
            n = getattr(im, "n_frames", 1) or 1
            pixels = 0
            for i in range(n):
                im.seek(i)
                frame = im.copy()
                px = frame.size[0] * frame.size[1]
                if px >= pixels:
                    pixels = px
                    best = frame
        except Exception:
            best = im.convert("RGBA")
        best = best.convert("RGBA")
        # 不要强行缩到 16：交给系统缩放，保留 256 更清晰
        if best.size[0] < 64:
            best = best.resize((256, 256), Image.Resampling.LANCZOS)
        photo = ImageTk.PhotoImage(best)
        root.iconphoto(True, photo)
        # 防止被 GC 收掉
        root._voxecho_icon_photo = photo  # type: ignore[attr-defined]
        photo_ok = True
    except Exception as e:
        ui_log("iconphoto failed: %s" % e)

    # 2) 仅当 iconphoto 失败时，才用 iconbitmap 兜底；
    #    若 iconphoto 已成功，不要再调用 iconbitmap——
    #    它会用 ico 里的 16x16 小帧覆盖掉刚提交的高清图，导致任务栏发糊。
    if not photo_ok:
        try:
            root.iconbitmap(str(ico))
        except Exception:
            try:
                root.iconbitmap(default=str(ico))
            except Exception as e:
                ui_log("iconbitmap failed: %s" % e)


def load_tray_image():
    """Load tray icon from VoxEcho.ico / png near exe or in bundle."""
    try:
        from PIL import Image
    except ImportError:
        return None
    candidates = [
        APP_DIR / "VoxEcho.ico",
        APP_DIR / "icon" / "VoxEcho.ico",
        APP_DIR / "icon" / "VoxEcho-32.png",
        APP_DIR / "icon" / "VoxEcho-48.png",
        APP_DIR / "icon" / "VoxEcho-16.png",
        resource_path("VoxEcho.ico"),
        resource_path("icon", "VoxEcho.ico"),
        resource_path("icon", "VoxEcho-32.png"),
        resource_path("icon", "VoxEcho-48.png"),
    ]
    for p in candidates:
        try:
            if p.exists():
                im = Image.open(p)
                # tray prefers small RGBA
                im = im.convert("RGBA")
                im.thumbnail((64, 64))
                return im
        except Exception:
            continue
    return None


def run_gui():
    set_windows_app_id()
    import tkinter as tk
    from tkinter import messagebox, scrolledtext, ttk

    cfg = load_config()
    root = tk.Tk()
    root.title(t("title"))
    root.geometry("960x540")
    root.minsize(760, 440)

    apply_window_icons(root)

    paned = ttk.Panedwindow(root, orient=tk.HORIZONTAL)
    paned.pack(fill=tk.BOTH, expand=True, padx=8, pady=8)
    left = ttk.Frame(paned, width=300)
    right = ttk.Frame(paned)
    paned.add(left, weight=0)
    paned.add(right, weight=1)

    ttk.Label(left, text=t("heading"), font=("", 12, "bold")).pack(
        anchor="w", pady=(0, 8)
    )
    status_var = tk.StringVar(value=t("status_stopped"))
    ttk.Label(left, textvariable=status_var, wraplength=280).pack(anchor="w", pady=4)
    ttk.Label(
        left, text=t("hint"), foreground="#444", wraplength=280, justify="left"
    ).pack(anchor="w", pady=8)

    auto_var = tk.BooleanVar(value=bool(cfg.get("autostart")))

    def on_auto():
        cfg["autostart"] = bool(auto_var.get())
        save_config(cfg)
        set_autostart(cfg["autostart"])

    ttk.Checkbutton(
        left, text=t("autostart"), variable=auto_var, command=on_auto
    ).pack(anchor="w", pady=6)

    def refresh_status():
        if service.running() or health_ok():
            status_var.set(t("status_running", host=HOST, port=PORT))
        else:
            status_var.set(t("status_stopped"))

    def do_start():
        ui_log(t("log_user_start"))
        if not ensure_environment():
            messagebox.showerror(t("env_error_title"), t("env_error_body"))
            return
        ok = service.start()
        refresh_status()
        if not ok:
            messagebox.showwarning(t("start_warn_title"), t("start_warn_body"))

    def do_stop():
        service.stop()
        refresh_status()

    def do_health():
        if health_ok():
            ui_log(t("log_health_ok"))
            messagebox.showinfo(
                t("health_ok_title"), t("health_ok_body", host=HOST, port=PORT)
            )
        else:
            ui_log(t("log_health_fail"))
            messagebox.showwarning(t("health_fail_title"), t("health_fail_body"))

    for text_key, cmd in (
        ("btn_start", do_start),
        ("btn_stop", do_stop),
        ("btn_health", do_health),
        (
            "btn_open_health",
            lambda: webbrowser.open("http://%s:%d/health" % (HOST, PORT)),
        ),
    ):
        ttk.Button(left, text=t(text_key), command=cmd).pack(fill=tk.X, pady=2)

    ttk.Separator(left, orient=tk.HORIZONTAL).pack(fill=tk.X, pady=12)
    ttk.Label(left, text=t("howto"), wraplength=280, justify="left").pack(anchor="w")

    ttk.Label(right, text=t("log_title"), font=("", 10, "bold")).pack(anchor="w")
    log_text = scrolledtext.ScrolledText(
        right,
        wrap=tk.WORD,
        font=("Consolas", 9),
        bg="#0c0c0c",
        fg="#d0d0d0",
        insertbackground="#ffffff",
    )
    log_text.pack(fill=tk.BOTH, expand=True, pady=(4, 0))
    log_text.configure(state=tk.DISABLED)

    def append_log_line(line: str):
        log_text.configure(state=tk.NORMAL)
        log_text.insert(tk.END, line + "\n")
        log_text.see(tk.END)
        log_text.configure(state=tk.DISABLED)

    def poll_logs():
        try:
            while True:
                append_log_line(log_queue.get_nowait())
        except queue.Empty:
            pass
        root.after(100, poll_logs)

    poll_logs()

    tray_icon = None

    def hide_to_tray():
        root.withdraw()
        ui_log(t("log_min_tray"))

    def show_from_tray(icon=None, item=None):
        root.after(0, root.deiconify)
        root.after(0, root.lift)

    def quit_app(icon=None, item=None):
        def _q():
            service.stop()
            if tray_icon:
                try:
                    tray_icon.stop()
                except Exception:
                    pass
            root.destroy()
            os._exit(0)

        root.after(0, _q)

    def setup_tray():
        nonlocal tray_icon
        try:
            import pystray
            from PIL import Image, ImageDraw
        except ImportError:
            ui_log(t("log_tray_missing"))
            return

        img = load_tray_image()
        if img is None:
            img = Image.new("RGB", (64, 64), "#1a1a2e")
            d = ImageDraw.Draw(img)
            d.ellipse((8, 8, 56, 56), fill="#4cc9f0")

        menu = pystray.Menu(
            pystray.MenuItem(t("tray_show"), show_from_tray, default=True),
            pystray.MenuItem(t("tray_start"), lambda: root.after(0, do_start)),
            pystray.MenuItem(t("tray_stop"), lambda: root.after(0, do_stop)),
            pystray.MenuItem(t("tray_exit"), quit_app),
        )
        tray_icon = pystray.Icon(
            "VoxEcho_bridge", img, t("tray_tooltip"), menu
        )
        threading.Thread(target=tray_icon.run, daemon=True).start()
        ui_log(t("log_tray_ok"))

    def on_close():
        try:
            import pystray  # noqa: F401

            hide_to_tray()
        except ImportError:
            if messagebox.askokcancel(
                t("exit_confirm_title"), t("exit_confirm_body")
            ):
                quit_app()

    root.protocol("WM_DELETE_WINDOW", on_close)

    def bootstrap():
        ui_log(t("log_boot"))
        ui_log(t("log_workdir", d=str(APP_DIR)))
        ui_log("UI lang: %s" % _LANG)
        if not ensure_environment():
            status_var.set(t("status_env_bad"))
            return
        if not cfg.get("first_run_done"):
            ensure_desktop_shortcut()
            cfg["first_run_done"] = True
            save_config(cfg)
            ui_log(t("log_first"))
            messagebox.showinfo(t("welcome_title"), t("welcome_body"))
        if cfg.get("autostart"):
            set_autostart(True)
        do_start()
        setup_tray()

    root.after(200, bootstrap)
    root.mainloop()


def main():
    if "--run-server" in sys.argv:
        if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
            sys.path.insert(0, str(getattr(sys, "_MEIPASS")))
        else:
            sys.path.insert(0, str(app_dir()))
        from server import main as server_main

        server_main()
        return
    run_gui()


if __name__ == "__main__":
    main()
