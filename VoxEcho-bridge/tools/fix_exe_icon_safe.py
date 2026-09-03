# -*- coding: utf-8 -*-
"""
fix_exe_icon_safe.py — 安全地为 PyInstaller onefile exe 替换图标（不破坏 PKG）。

原理：
  rcedit / Resource Hacker / UpdateResource 都会重写整个 PE 文件，
  把 onefile 末尾的 PKG 归档(overlay)丢掉。本脚本分两步：
    1) 备份并提取原 exe 的 PKG 数据 + cookie；
    2) 在临时副本上用 UpdateResource API 注入完整多尺寸图标（此时文件是纯 PE），
       再把 PKG 数据拼回末尾，并按新 PE 长度修正 cookie 中的 toc_offset。

用法:
    python fix_exe_icon_safe.py <app.exe> <icon.ico>
    会生成 <app.exe>.bak 备份。
"""
import ctypes
import os
import shutil
import struct
import sys
from ctypes import wintypes

RT_ICON = 3
RT_GROUP_ICON = 14
COOKIE_MAGIC = b'MEI\014\013\012\013\016'
COOKIE_FMT = '!8sIIII64s'
COOKIE_LEN = struct.calcsize(COOKIE_FMT)

k32 = ctypes.windll.kernel32
BeginUpdateResourceW = k32.BeginUpdateResourceW
BeginUpdateResourceW.argtypes = [wintypes.LPCWSTR, wintypes.BOOL]
BeginUpdateResourceW.restype = wintypes.HANDLE
UpdateResourceW = k32.UpdateResourceW
UpdateResourceW.argtypes = [wintypes.HANDLE, wintypes.LPVOID, wintypes.LPVOID,
                            wintypes.WORD, wintypes.LPVOID, wintypes.DWORD]
UpdateResourceW.restype = wintypes.BOOL
EndUpdateResourceW = k32.EndUpdateResourceW
EndUpdateResourceW.argtypes = [wintypes.HANDLE, wintypes.BOOL]
EndUpdateResourceW.restype = wintypes.BOOL


def makeintres(i):
    return ctypes.cast(i, wintypes.LPVOID)


def find_pkg(exe_path):
    """返回 (pkg_start, cookie_start, cookie_tuple) 或 None。"""
    with open(exe_path, 'rb') as f:
        data = f.read()
    idx = data.rfind(COOKIE_MAGIC)
    if idx == -1:
        return None
    cookie = struct.unpack_from(COOKIE_FMT, data, idx)
    magic, pkg_length, toc_offset, toc_length, pyvers, pylib = cookie
    cookie_start = idx
    end_offset = cookie_start + COOKIE_LEN
    start_offset = end_offset - pkg_length
    return start_offset, cookie_start, cookie


def load_ico(path):
    data = open(path, "rb").read()
    idReserved, idType, idCount = struct.unpack_from("<HHH", data, 0)
    if idType != 1:
        raise ValueError("不是有效的 ICO 文件 (type=%d)" % idType)
    frames = []
    for i in range(idCount):
        bWidth, bHeight, bColorCount, bReserved, wPlanes, wBitCount, dwBytesInRes, dwImageOffset = \
            struct.unpack_from("<BBBBHHII", data, 6 + i * 16)
        img = data[dwImageOffset:dwImageOffset + dwBytesInRes]
        frames.append((bWidth, bHeight, bColorCount, wPlanes, wBitCount, dwBytesInRes, img))
    return frames


def inject_icon_via_update_resource(exe_path, ico_path):
    frames = load_ico(ico_path)
    h = BeginUpdateResourceW(exe_path, False)
    if not h:
        raise ctypes.WinError(ctypes.get_last_error())
    ids = []
    for idx, (bw, bh, cc, planes, bitcount, size, img) in enumerate(frames):
        rid = idx + 1
        buf = ctypes.create_string_buffer(img)
        if not UpdateResourceW(h, makeintres(RT_ICON), makeintres(rid), 0, buf, len(img)):
            raise ctypes.WinError(ctypes.get_last_error())
        ids.append((bw, bh, cc, planes, bitcount, size, rid))
        print(f"  wrote RT_ICON#{rid}: {bw or 256}x{bh or 256} bpp={bitcount}")
    grp = struct.pack("<HHH", 0, 1, len(ids))
    for (bw, bh, cc, planes, bitcount, size, rid) in ids:
        grp += struct.pack("<BBBBHHIH", bw, bh, cc, 0, planes, bitcount, size, rid)
    gbuf = ctypes.create_string_buffer(grp)
    if not UpdateResourceW(h, makeintres(RT_GROUP_ICON), makeintres(1), 0, gbuf, len(grp)):
        raise ctypes.WinError(ctypes.get_last_error())
    if not EndUpdateResourceW(h, False):
        raise ctypes.WinError(ctypes.get_last_error())


def main():
    if len(sys.argv) < 3:
        print("Usage: python fix_exe_icon_safe.py <app.exe> <icon.ico>")
        return 2
    exe_path = os.path.abspath(sys.argv[1])
    ico_path = os.path.abspath(sys.argv[2])

    bak = exe_path + ".bak"
    if not os.path.exists(bak):
        shutil.copy2(exe_path, bak)
        print("已备份 ->", bak)

    # 1) 解析并提取原 PKG + cookie
    info = find_pkg(exe_path)
    if info is None:
        print("未找到 PyInstaller PKG，按普通 exe 直接注入图标")
        work = exe_path + ".tmp_icon"
        shutil.copy2(exe_path, work)
        inject_icon_via_update_resource(work, ico_path)
        os.replace(work, exe_path)
        print("完成:", exe_path)
        return 0

    pkg_start, cookie_start, cookie = info
    with open(exe_path, 'rb') as f:
        data = f.read()
    pkg_data = data[pkg_start:cookie_start]
    cookie_blob = data[cookie_start:cookie_start + COOKIE_LEN]
    orig_size = len(data)
    print(f"PKG: start={pkg_start} pkg_bytes={len(pkg_data)} 原文件={orig_size}B")

    # 2) 临时副本注入图标
    work = exe_path + ".tmp_icon"
    shutil.copy2(exe_path, work)
    inject_icon_via_update_resource(work, ico_path)
    with open(work, 'rb') as f:
        new_pe = f.read()
    print(f"注入图标后(纯PE): {len(new_pe)}B")
    os.remove(work)

    # 3) 拼回 PKG + 修正 cookie（若 PE 长度变化，需平移 toc_offset）
    magic, pkg_length, toc_offset, toc_length, pyvers, pylib = cookie
    # toc_offset 是相对文件开头的绝对偏移；PKG 数据在新文件中从 len(new_pe) 开始
    rel_toc = toc_offset - pkg_start          # TOC 在 PKG 内的相对偏移
    new_toc_offset = len(new_pe) + rel_toc    # 新的绝对 TOC 偏移
    new_cookie = struct.pack(COOKIE_FMT, magic, pkg_length, new_toc_offset, toc_length, pyvers, pylib)

    final = new_pe + pkg_data + new_cookie
    with open(exe_path, 'wb') as f:
        f.write(final)
    print(f"拼回: PE {len(new_pe)} + PKG {len(pkg_data)} + cookie {COOKIE_LEN} = {len(final)}B (原 {orig_size}B)")
    print(f"cookie toc_offset: {toc_offset} -> {new_toc_offset}")

    # 4) 验证
    chk = find_pkg(exe_path)
    if chk:
        print("PKG 校验: OK")
    else:
        print("PKG 校验: FAILED — 请恢复 .bak")
        return 1
    print("完成:", exe_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
