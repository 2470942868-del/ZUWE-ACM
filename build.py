#!/usr/bin/env python3
"""
构建桌面应用：使用 PyInstaller 将 OJ 网站打包为独立可执行文件。
"""
import os
import sys
import shutil
import subprocess

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BUILD_DIR = os.path.join(BASE_DIR, "build")
DIST_DIR = os.path.join(BASE_DIR, "dist")

# 需要额外打包的数据文件（非 Python 资源）
DATA_FILES = [
    (os.path.join("questions", "questions.json"), "questions"),
    (os.path.join("templates", "index.html"), "templates"),
]

# 递归收集 static 目录下所有文件
STATIC_DIR = os.path.join(BASE_DIR, "static")
for dirpath, dirnames, filenames in os.walk(STATIC_DIR):
    for fn in filenames:
        full = os.path.join(dirpath, fn)
        rel = os.path.relpath(dirpath, BASE_DIR)
        DATA_FILES.append((full, rel))


def build():
    print("=" * 50)
    print("  ZUWE-ACM — 桌面应用构建")
    print("=" * 50)
    print()

    if os.path.exists(DIST_DIR):
        shutil.rmtree(DIST_DIR)
    if os.path.exists(BUILD_DIR):
        shutil.rmtree(BUILD_DIR)

    sep = ";" if sys.platform == "win32" else ":"

    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--name", "ZUWE-ACM",
        "--icon", os.path.join(BASE_DIR, "app.ico"),
        "--windowed",
        "--onefile",
        "--clean",
        "--noconfirm",
    ]

    for src, dst in DATA_FILES:
        cmd += ["--add-data", f"{os.path.join(BASE_DIR, src)}{sep}{dst}"]

    cmd += [
        "--hidden-import", "docx",
        "--hidden-import", "docx.shared",
        "--hidden-import", "docx.text",
        "--hidden-import", "docx.document",
        "--hidden-import", "requests",
        os.path.join(BASE_DIR, "desktop_app.py"),
    ]

    print("[*] 正在构建，请等待（约 2-5 分钟）...")
    print()
    subprocess.run(cmd, cwd=BASE_DIR, check=True)
    print()
    print("[✓] 构建完成！")
    print(f"    输出目录: {DIST_DIR}")


if __name__ == "__main__":
    build()
