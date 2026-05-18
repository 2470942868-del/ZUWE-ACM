#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ZUWE-ACM — 桌面应用入口。
启动 Flask 服务并打开默认浏览器。
"""
import os
import sys
import threading
import webbrowser
import time
import socket

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(BASE_DIR)
sys.path.insert(0, BASE_DIR)

from app import app as flask_app


def _log(msg):
    """写入启动日志到用户数据目录。"""
    try:
        if sys.platform == "win32":
            base = os.environ.get("APPDATA", os.path.expanduser("~"))
            log_dir = os.path.join(base, "ZUWE-ACM", "log")
        elif sys.platform == "darwin":
            log_dir = os.path.join(os.path.expanduser("~"), "Library", "Application Support", "ZUWE-ACM", "log")
        else:
            log_dir = os.path.join(os.path.expanduser("~"), ".config", "ZUWE-ACM", "log")
        os.makedirs(log_dir, exist_ok=True)
        with open(os.path.join(log_dir, "oj.log"), "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] [STARTUP] {msg}\n")
    except OSError:
        pass


def _find_free_port(start=5001, max_tries=10):
    """从 start 开始寻找可用端口。"""
    for port in range(start, start + max_tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    return None


def start_flask(port):
    flask_app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False)


def open_browser(url):
    time.sleep(1.5)
    opened = webbrowser.open(url)
    if not opened:
        _log(f"无法自动打开浏览器，请手动访问: {url}")


if __name__ == "__main__":
    port = _find_free_port()
    if port is None:
        _log("错误：未找到可用端口（5001-5010 均被占用）")
        sys.exit(1)

    url = f"http://127.0.0.1:{port}"
    _log(f"启动服务: {url}")

    t = threading.Thread(target=start_flask, args=(port,), daemon=True)
    t.start()
    threading.Thread(target=open_browser, args=(url,), daemon=True).start()

    # 主线程等待，心跳检测会自动退出进程
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
