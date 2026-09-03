# 开发者：发布清单

发给小白用户的压缩包建议包含：

```
ebooks-tts-release/
  ebooks-tts-bridge.exe     # 双击启动桥接
  用户使用说明.txt
  extension/                # 整个扩展目录（manifest.json 在此层）
    manifest.json
    background.js
    ...
```

不要让用户安装 Python / pip。exe 用 PyInstaller onefile 打好再发。

可选增强（未实现，可后续做）：
- 系统托盘图标，关闭窗口最小化到托盘
- 开机自启
- 安装版 Inno Setup 把扩展路径写进说明
