# -*- coding: utf-8 -*-
"""
PyInstaller on Windows often embeds only 16x16 + 32x32 from a multi-size ICO.
This script re-applies the FULL .ico onto the built exe using rcedit or Resource Hacker.
Run on Windows after PyInstaller.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path


def find_tool() -> tuple[str, list[str]] | None:
    """Return (kind, command_prefix)."""
    # 1) rcedit on PATH or local tools/
    for name in ("rcedit-x64.exe", "rcedit.exe"):
        p = shutil.which(name)
        if p:
            return "rcedit", [p]
        local = Path(__file__).resolve().parent / name
        if local.exists():
            return "rcedit", [str(local)]

    # 2) Resource Hacker common install paths
    rh_names = [
        Path(r"C:\Program Files (x86)\Resource Hacker\ResourceHacker.exe"),
        Path(r"C:\Program Files\Resource Hacker\ResourceHacker.exe"),
        Path(__file__).resolve().parent / "ResourceHacker.exe",
    ]
    for rh in rh_names:
        if rh.exists():
            return "reshacker", [str(rh)]
    w = shutil.which("ResourceHacker") or shutil.which("ResourceHacker.exe")
    if w:
        return "reshacker", [w]
    return None


def fix_with_rcedit(rcedit: list[str], exe: Path, ico: Path) -> None:
    cmd = rcedit + [str(exe), "--set-icon", str(ico)]
    print("Running:", " ".join(cmd))
    subprocess.check_call(cmd)


def fix_with_reshacker(rh: list[str], exe: Path, ico: Path) -> None:
    # addoverwrite ICONGROUP
    # -open exe -save exe -action addoverwrite -res ico -mask ICONGROUP,,
    cmd = rh + [
        "-open",
        str(exe),
        "-save",
        str(exe),
        "-action",
        "addoverwrite",
        "-res",
        str(ico),
        "-mask",
        "ICONGROUP,MAINICON,",
    ]
    print("Running:", " ".join(cmd))
    subprocess.check_call(cmd)


def main() -> int:
    if len(sys.argv) < 3:
        print("Usage: python fix_exe_icon.py <app.exe> <icon.ico>")
        return 2
    exe = Path(sys.argv[1]).resolve()
    ico = Path(sys.argv[2]).resolve()
    if not exe.exists():
        print("EXE not found:", exe)
        return 1
    if not ico.exists():
        print("ICO not found:", ico)
        return 1

    tool = find_tool()
    if not tool:
        print(
            """
No icon tool found.

PyInstaller only embeds 16x16 and 32x32. To restore all sizes in the EXE:

Option A — rcedit (recommended, small CLI):
  1. Download rcedit-x64.exe from:
     https://github.com/electron/rcedit/releases
  2. Put it in the tools\\ folder next to this script
  3. Re-run build.bat

Option B — Resource Hacker:
  1. Install https://www.angusj.com/resourcehacker/
  2. Re-run build.bat
"""
        )
        return 1

    kind, cmd = tool
    try:
        if kind == "rcedit":
            fix_with_rcedit(cmd, exe, ico)
        else:
            fix_with_reshacker(cmd, exe, ico)
    except subprocess.CalledProcessError as e:
        print("Icon fix failed:", e)
        return 1

    print("OK: full multi-size icon applied to", exe)
    print("WARNING: Never use this on PyInstaller --onefile builds; it can break the PKG archive.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
