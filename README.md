# ZUWE-ACM — 桌面在线评测系统

ZUWE-ACM 是一款本地运行的编程练习平台，内置 43 道算法题目，支持 Python 和 C++ 代码编辑、沙箱评测、AI 出题等功能。无需网络（除 AI 功能外），开箱即用。

## 环境要求

| 依赖 | 说明 |
|------|------|
| **Python** | 3.8+（推荐 3.11+） |
| **Flask** | Web 框架 |
| **python-docx** | Word 文档解析（上传题目功能） |
| **requests** | AI 功能 HTTP 请求 |
| **CodeMirror 5** | 已打包在 `static/codemirror/`，无需安装 |
| **g++**（可选） | 仅 C++ 评测需要。Windows 需要 MinGW / MSYS2 |

## 快速开始

### 从源码运行

```bash
# 1. 安装依赖
pip install flask python-docx requests

# 2. 启动
python desktop_app.py
```

启动后会自动在默认浏览器打开 `http://127.0.0.1:5001`。如果 5001 被占用，会自动递增端口尝试（最多到 5010）。

### 开发模式（直接启动 Flask）

```bash
python app.py
```

这种方式使用 Flask 内置调试模式（debug=True），代码修改后自动重载。

## 打包构建

### PyInstaller（推荐，构建快）

```bash
pip install pyinstaller
python build.py
```

输出：`dist/ZUWE-ACM.exe`（约 60-80MB），单文件可执行。

### Nuitka（更难反编译，首次构建较慢）

```bash
pip install nuitka zstandard
python build_nuitka.py
```

输出：`dist_nuitka/`。首次构建约 5-15 分钟，后续增量编译较快。

## 功能详解

### 1. 编程练习

- **43 道内置算法题**，覆盖简单/中等/困难三种难度
- 题目分类：基础算法、动态规划、搜索、图论、数学、字符串等
- 支持 **Python** 和 **C++** 两种语言
- 代码编辑器基于 CodeMirror 5，支持语法高亮、括号匹配、自动缩进、代码折叠、行号显示
- 可拖动调整左右面板宽度

### 2. 代码评测

- **运行测试**（▶）：运行可见测试用例，逐条显示输入、期望输出和实际输出
- **提交**（📤）：运行隐藏测试用例，仅显示通过/失败结果，模拟真实 OJ 提交体验
- **流式输出**（SSE）：测试结果逐条推送，实时显示进度
- 每测试用例 5 秒超时，256MB 内存限制
- 错误信息自动翻译为中文（如 `NameError` → `变量未定义`）

### 3. 代码持久化

- **保存代码**（💾）：代码保存到服务端，关闭浏览器或重启应用后自动恢复
- **重置代码**：恢复为题目默认模板

### 4. AI 出题

- 基于 DeepSeek API，输入描述或关键词即可自动生成完整题目
- 自动生成 3+ 个测试用例（含正常、边界和特殊情况）
- 自动生成 Python 和 C++ 模板代码
- 生成的题目可直接跳转练习

### 5. AI 助手（浮动聊天）

- 可拖动的聊天窗口，位置和大小自由调整
- 支持上下文的连续对话
- 可用于解答算法疑问、提供解题思路

### 6. 题目管理

- **搜索**（🔍）：按题目名称、分类、难度搜索
- **新增**：上传 Word（.docx）文档自动解析创建题目
- **删除**：单题删除或批量删除
- **下载模板**：一键下载 Word 模板，按格式填写后上传

### 7. 编辑器设置

- **字体大小**：滑条实时调节（10px - 24px）
- **明暗主题**：切换编辑器深色/浅色背景
- **快捷键**：`Ctrl+Enter` 运行，`Ctrl+/` 注释，`Tab` 插入 4 空格

### 8. 设置

| 设置项 | 说明 |
|--------|------|
| **API Key** | DeepSeek API Key，用于 AI 出题和聊天。验证通过后保存 |
| **编辑器字体** | 滑条调节代码编辑器字体大小 |
| **C++ 编译器路径** | 手动指定 g++ 路径，自动检测编译器状态 |

### 9. 自动退出

浏览器关闭后约 5 秒自动退出程序（心跳检测机制），无需手动关闭。

## 数据存储

用户数据（题目增删改、代码保存、设置）存储在操作系统用户数据目录：

| 平台 | 路径 |
|------|------|
| **Windows** | `%APPDATA%/ZUWE-ACM/` |
| **macOS** | `~/Library/Application Support/ZUWE-ACM/` |
| **Linux** | `~/.config/ZUWE-ACM/` |

删除 `.exe` 文件不会清除这些数据，数据与可执行文件分离。

文件结构：
```
ZUWE-ACM/
├── questions.json    # 题目数据（含增删改）
├── saved_codes.json  # 保存的代码
├── settings.json     # 设置（API Key、编译器路径等）
└── log/
    └── oj.log        # 运行日志
```

## 技术架构

```
desktop_app.py          — 入口：端口扫描 + 浏览器启动 + Flask 守护线程
app.py                  — Flask 后端 API + SSE 流式评测 + AI 集成 + 代码持久化
sandbox/runner.py       — 代码沙箱：subprocess 隔离、超时控制、内存限制
questions/questions.json— 43 道内置题目（含测试用例）
templates/index.html    — 单页前端（CodeMirror 编辑器 + 所有 UI）
static/app.js           — 前端逻辑（API 调用、CodeMirror 配置、SSE 处理、UI 状态）
static/style.css        — 全部样式
static/codemirror/      — 离线 CodeMirror 5（无 CDN 依赖）
build.py                — PyInstaller 构建脚本
build_nuitka.py         — Nuitka 构建脚本
```

### 关键设计

- **单页面应用**：全部 UI 在 `index.html` + `app.js`，无前端框架
- **SSE 流式推送**：评测结果逐条推送，实时更新
- **沙箱隔离**：用户代码在子进程运行，5 秒超时，Windows 用 Job Object 限制内存 256MB 并自动清理子进程，Unix 用 `resource.setrlimit`
- **C++ 编译一次运行多次**：编译一次后对所有测试用例逐条运行，避免重复编译
- **CSRF 保护**：API POST 请求仅接受来自 127.0.0.1 / localhost / [::1] 的请求
- **代码服务端持久化**：不依赖浏览器 localStorage，使用服务端 JSON 文件存储，跨平台兼容

## 常见问题

**Q: 启动后浏览器没自动打开？**
可以手动访问 `http://127.0.0.1:5001`（端口可能递增）。

**Q: C++ 评测失败 / 找不到编译器？**
在设置中手动指定 g++ 路径，或在系统 PATH 中添加 MinGW 的 bin 目录（如 `C:\msys64\ucrt64\bin`）。

**Q: AI 功能无法使用？**
在设置中输入 DeepSeek API Key（以 `sk-` 开头），保存后会自动验证。

**Q: 数据存在哪里？**
见上方「数据存储」表格。删除 `.exe` 不会删除数据。
# ZUWE-ACM
# ZUWE-ACM
