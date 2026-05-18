#!/usr/bin/env python3
"""
使用 Nuitka 构建桌面应用（生成更难反编译的 exe）。
需要先安装 Nuitka:
  pip install nuitka

Windows 上还需要:
  - MSVC (Visual Studio Build Tools) 或 MinGW
  - 推荐: pip install nuitka zstandard (用于 --onefile 压缩)
"""
import os
import sys
import shutil
import subprocess

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(BASE_DIR, "dist_nuitka")


def build():
    print("=" * 50)
    print("  ZUWE-ACM — Nuitka 构建")
    print("=" * 50)
    print()

    # 检查 Nuitka
    try:
        subprocess.run([sys.executable, "-m", "nuitka", "--version"],
                       capture_output=True, check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        print("[!] 请先安装 Nuitka: pip install nuitka")
        sys.exit(1)

    if os.path.exists(OUT_DIR):
        shutil.rmtree(OUT_DIR)

    cmd = [
        sys.executable, "-m", "nuitka",
        "--standalone",
        "--onefile",
        "--enable-plugin=flask",
        "--enable-plugin=multiprocessing",
        "--output-dir", OUT_DIR,
    ]

    if sys.platform == "win32":
        ico = os.path.join(BASE_DIR, "app.ico")
        if os.path.exists(ico):
            cmd += ["--windows-icon-from-ico", ico]
        cmd.append("--windows-console-mode=disable")

    # 包含数据目录
    cmd += [
        "--include-data-dir", f"questions={os.path.join(BASE_DIR, 'questions')}",
        "--include-data-dir", f"templates={os.path.join(BASE_DIR, 'templates')}",
        "--include-data-dir", f"static={os.path.join(BASE_DIR, 'static')}",
        "--include-data-dir", f"sandbox={os.path.join(BASE_DIR, 'sandbox')}",
    ]

    # 入口文件
    cmd.append(os.path.join(BASE_DIR, "desktop_app.py"))

    print("[*] 正在使用 Nuitka 构建...")
    print("[*] 首次编译较慢（约 5-15 分钟），后续增量编译会快很多")
    print()
    subprocess.run(cmd, cwd=BASE_DIR, check=True)
    print()
    print("[✓] 构建完成！")
    print(f"    输出目录: {OUT_DIR}")


if __name__ == "__main__":
    build()
