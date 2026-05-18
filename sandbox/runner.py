"""
安全的代码沙箱执行器（Windows 兼容版）。
使用 subprocess 启动隔离进程，设置超时。
"""
import subprocess
import sys
import os
import platform
import tempfile
import time
import json
import shutil
import glob
import re as _re

IS_WINDOWS = platform.system() == "Windows"

# ── Windows Job Object：资源限制与进程清理 ──
if IS_WINDOWS:
    import ctypes
    from ctypes import wintypes

    _JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x00000100
    _JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200
    _JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000

    class _JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", wintypes.LARGE_INTEGER),
            ("PerJobUserTimeLimit", wintypes.LARGE_INTEGER),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class _JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", _JOBOBJECT_BASIC_LIMIT_INFORMATION),
            ("IoInfo", wintypes.ULARGE_INTEGER * 3),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    def _create_job(mem_mb=256):
        """创建 Windows Job Object 限制内存，进程退出时自动 kill 子进程。"""
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        job = kernel32.CreateJobObjectW(None, None)
        if not job:
            return None

        info = _JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
        info.BasicLimitInformation.LimitFlags = (
            _JOB_OBJECT_LIMIT_PROCESS_MEMORY |
            _JOB_OBJECT_LIMIT_JOB_MEMORY |
            _JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        )
        limit_bytes = mem_mb * 1024 * 1024
        info.ProcessMemoryLimit = limit_bytes
        info.JobMemoryLimit = limit_bytes

        result = kernel32.SetInformationJobObject(
            job, 9,  # JobObjectExtendedLimitInformation
            ctypes.byref(info),
            ctypes.sizeof(info)
        )
        if not result:
            kernel32.CloseHandle(job)
            return None
        return job

    def _assign_to_job(job, process_handle):
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        return kernel32.AssignProcessToJobObject(job, process_handle)

else:
    def _create_job(mem_mb=256):
        return None

    def _assign_to_job(job, process_handle):
        return False


def _find_gcc():
    """查找可用的 GCC。"""
    if not IS_WINDOWS:
        candidates = [f"g++-{v}" for v in range(15, 12, -1)] + ["g++"]
        for c in candidates:
            try:
                subprocess.run([c, "--version"], capture_output=True, timeout=2)
                return c
            except (FileNotFoundError, subprocess.TimeoutExpired):
                continue
        return "g++"

    # Windows: shutil.which 遵循 PATH，跳过 WindowsApps
    import shutil
    for name in ["g++", "x86_64-w64-mingw32-g++", "i686-w64-mingw32-g++"]:
        path = shutil.which(name)
        if path and os.path.isfile(path):
            return path

    # 搜索常见 MSYS2 / MinGW 安装路径
    roots = [
        r"C:\msys64\ucrt64\bin",
        r"C:\msys64\mingw64\bin",
        r"C:\msys64\mingw32\bin",
        r"C:\msys2\ucrt64\bin",
        r"C:\msys2\mingw64\bin",
        r"C:\Program Files\mingw-w64\x86_64-*\bin",
        r"C:\Program Files (x86)\mingw-w64\i686-*\bin",
    ]
    for base in roots:
        if "*" in base:
            for match in glob.glob(base):
                gpp = os.path.join(match, "g++.exe")
                if os.path.isfile(gpp):
                    return gpp
        else:
            gpp = os.path.join(base, "g++.exe")
            if os.path.isfile(gpp):
                return gpp

    return "g++"


CPP_COMPILER = _find_gcc()


class SandboxError(Exception):
    pass


def _set_limits(timeout_sec=10, mem_mb=512):
    """在子进程中设置资源限制（Unix 下 preexec_fn 中调用）。Windows 不做限制。"""
    if IS_WINDOWS:
        return
    import resource
    try:
        cur_soft, cur_hard = resource.getrlimit(resource.RLIMIT_AS)
        if mem_mb * 1024 * 1024 < cur_hard:
            resource.setrlimit(resource.RLIMIT_AS, (mem_mb * 1024 * 1024, cur_hard))
    except (ValueError, resource.error):
        pass
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (timeout_sec, timeout_sec + 1))
    except (ValueError, resource.error):
        pass
    try:
        cur_soft, cur_hard = resource.getrlimit(resource.RLIMIT_FSIZE)
        if 1024 * 1024 < cur_hard:
            resource.setrlimit(resource.RLIMIT_FSIZE, (1024 * 1024, cur_hard))
    except (ValueError, resource.error):
        pass
    try:
        os.setsid()
    except PermissionError:
        pass
    import signal
    signal.signal(signal.SIGINT, signal.SIG_IGN)


def _run_with_limits(cmd_args, stdin_data, timeout, limits_mem_mb=256):
    """通用：启动子进程并设置限制，返回 stdout/stderr/elapsed。"""
    start = time.time()
    kwargs = dict(stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                  stderr=subprocess.PIPE, text=True)
    if IS_WINDOWS:
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
    else:
        kwargs["preexec_fn"] = lambda: _set_limits(timeout, limits_mem_mb)

    try:
        proc = subprocess.Popen(cmd_args, **kwargs)
    except FileNotFoundError:
        name = os.path.basename(cmd_args[0]) if cmd_args else "unknown"
        which_hint = f"未找到 {name}，请确认已安装并添加到系统 PATH"
        return {
            "success": False,
            "error": which_hint,
            "time": round(time.time() - start, 3),
            "stdout": "",
            "stderr": "",
        }

    # Windows：用 Job Object 限制子进程内存，进程退出时自动清理
    _job = None
    if IS_WINDOWS:
        _job = _create_job(limits_mem_mb)
        if _job:
            _assign_to_job(_job, proc._handle)

    try:
        stdout, stderr = proc.communicate(input=stdin_data, timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        stdout, stderr = proc.communicate()
        return {
            "success": False,
            "error": f"运行超时（>{timeout}秒）",
            "time": round(time.time() - start, 3),
            "stdout": "",
            "stderr": stderr.strip(),
        }

    elapsed = round(time.time() - start, 3)
    success = proc.returncode == 0
    return {
        "success": success,
        "error": stderr.strip() if stderr.strip() else None,
        "time": elapsed,
        "stdout": stdout.strip(),
        "stderr": stderr.strip(),
    }


def _get_python_exe():
    """获取系统 Python 解释器路径（处理 PyInstaller 打包后 sys.executable 不可用的情况）。"""
    if not getattr(sys, 'frozen', False):
        return sys.executable

    if not IS_WINDOWS:
        import shutil
        return shutil.which("python3") or shutil.which("python") or "python3"

    # Windows：尝试多种方式找 Python
    import shutil

    # 方法1: shutil.which，但跳过 WindowsApps 目录的 Store 存根
    py_path = shutil.which("python")
    if py_path and "WindowsApps" not in py_path and os.path.isfile(py_path):
        return py_path

    # 方法2: 用 py 启动器获取真实的 Python 路径
    try:
        result = subprocess.run(
            ["py", "-3", "-c", "import sys; print(sys.executable)"],
            capture_output=True, text=True, timeout=5,
            creationflags=subprocess.CREATE_NO_WINDOW
        )
        if result.returncode == 0:
            path = result.stdout.strip()
            if path and os.path.isfile(path):
                return path
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    # 方法3: 搜索常见安装路径
    candidates = [
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Python"),
        os.path.join(os.environ.get("ProgramFiles", ""), "Python"),
        os.path.join(os.environ.get("ProgramFiles(x86)", ""), "Python"),
    ]
    for base in candidates:
        if os.path.isdir(base):
            for entry in os.listdir(base):
                full = os.path.join(base, entry, "python.exe")
                if os.path.isfile(full):
                    return full

    return "python"


def run_code(code: str, stdin: str, timeout: int = 5) -> dict:
    """在沙箱中运行 Python 代码，返回执行结果。"""
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".py", delete=False, encoding="utf-8"
    ) as f:
        f.write(code)
        f.flush()
        code_path = f.name

    python_exe = _get_python_exe()
    try:
        result = _run_with_limits([python_exe, code_path], stdin, timeout)
        return result
    except FileNotFoundError as e:
        return {"success": False, "error": f"无法运行 Python 解释器: {e}", "time": 0, "stdout": "", "stderr": ""}
    except Exception as e:
        return {"success": False, "error": f"评测异常: {e}", "time": 0, "stdout": "", "stderr": ""}
    finally:
        try:
            os.unlink(code_path)
        except OSError:
            pass


# ──────────────────────────────────────────
#  C++ 编译 + 运行
# ──────────────────────────────────────────

def _compile_cpp(code: str, tmp_dir: str, timeout: int = 5) -> tuple[str | None, str | None, float]:
    """编译 C++ 代码，返回 (bin_path, error, elapsed)。成功时 error=None。"""
    src_path = os.path.join(tmp_dir, "solution.cpp")
    ext = ".exe" if IS_WINDOWS else ""
    bin_path = os.path.join(tmp_dir, f"solution{ext}")
    with open(src_path, "w", encoding="utf-8") as f:
        f.write(code)

    start = time.time()
    kwargs = dict(stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if IS_WINDOWS:
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
    else:
        kwargs["preexec_fn"] = lambda: _set_limits(timeout + 5)

    try:
        comp = subprocess.Popen(
            [CPP_COMPILER, "-std=c++17", "-O2", "-o", bin_path, src_path],
            **kwargs,
        )
    except FileNotFoundError:
        return None, f"未找到 {CPP_COMPILER}，请安装 MinGW 并将 g++ 添加到系统 PATH", round(time.time() - start, 3)
    try:
        _, comp_err = comp.communicate(timeout=timeout + 5)
    except subprocess.TimeoutExpired:
        comp.kill()
        comp.communicate()
        return None, "编译超时", round(time.time() - start, 3)

    elapsed = round(time.time() - start, 3)
    if comp.returncode != 0:
        try:
            os.unlink(src_path)
        except OSError:
            pass
        return None, f"编译错误:\n{_translate_error(comp_err.strip(), 'cpp')}", elapsed

    return bin_path, None, elapsed


def _run_binary(bin_path: str, stdin: str, timeout: int = 5) -> dict:
    """运行已编译的二进制文件。"""
    return _run_with_limits([bin_path], stdin, timeout)


def run_cpp_code(code: str, stdin: str, timeout: int = 5) -> dict:
    """编译并运行 C++ 代码，返回执行结果。"""
    tmp_dir = tempfile.mkdtemp()
    try:
        bin_path, error, elapsed = _compile_cpp(code, tmp_dir, timeout)
        if error:
            return {
                "success": False,
                "error": error,
                "time": elapsed,
                "stdout": "",
                "stderr": error,
            }
        return _run_binary(bin_path, stdin, timeout)
    except FileNotFoundError as e:
        return {"success": False, "error": f"未找到编译器: {e}", "time": 0, "stdout": "", "stderr": ""}
    except Exception as e:
        return {"success": False, "error": f"编译异常: {e}", "time": 0, "stdout": "", "stderr": ""}
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


# ──────────────────────────────────────────
#  批量运行（C++ 编译一次，运行多次）
# ──────────────────────────────────────────

# ── 错误信息中文翻译 ──
_PYTHON_ERROR_MAP = {
    "SyntaxError": "语法错误",
    "IndentationError": "缩进错误",
    "NameError": "变量未定义",
    "TypeError": "类型错误",
    "IndexError": "索引越界",
    "KeyError": "键不存在",
    "ValueError": "值错误",
    "ImportError": "导入模块失败",
    "ModuleNotFoundError": "未找到模块",
    "ZeroDivisionError": "除以零错误",
    "AttributeError": "对象没有该属性",
    "FileNotFoundError": "文件未找到",
    "PermissionError": "权限不足",
    "EOFError": "输入读取错误",
    "RecursionError": "递归超过最大深度",
    "OverflowError": "数值溢出",
    "MemoryError": "内存不足",
    "AssertionError": "断言失败",
    "RuntimeError": "运行时错误",
    "UnboundLocalError": "局部变量未赋值",
    "StopIteration": "迭代已结束",
}

_CXX_ERROR_MAP = {
    "error: " : "编译错误: ",
    "warning: ": "警告: ",
    "undefined reference": "未定义的引用",
    "cannot find": "找不到文件",
    "expected.": "缺少",
    "was not declared": "未声明",
    "no matching function": "找不到匹配的函数",
    "required from": "",
}

def _translate_error(stderr: str, language: str = "python") -> str:
    """将运行时错误信息翻译为中文。"""
    if not stderr:
        return stderr

    if language == "python":
        # 提取最后一行中的异常类型
        lines = stderr.strip().splitlines()
        for line in reversed(lines):
            line = line.strip()
            for eng, cn in _PYTHON_ERROR_MAP.items():
                if line.startswith(eng + ":") or line.startswith(eng + "("):
                    detail = line[len(eng):].lstrip(":() ").strip()
                    return f"{cn}: {detail}" if detail else cn
            # 也处理没有冒号的情况（少数异常）
            if line in _PYTHON_ERROR_MAP:
                return _PYTHON_ERROR_MAP[line]
        # 没匹配到已知异常，取最后一行
        if lines:
            last = lines[-1].strip()
            if last.startswith("Traceback"):
                return "运行时错误"
            return last
    elif language == "cpp":
        # 精简 C++ 编译/运行错误
        for pattern, replacement in _CXX_ERROR_MAP.items():
            if pattern in stderr:
                stderr = stderr.replace(pattern, replacement)
        return stderr.strip()

    return stderr.strip()


def _flatten_result(runner_result: dict, tc: dict, test_id: int, language: str = "python") -> dict:
    """将 runner 返回的原始 dict 转为统一的测试结果格式。"""
    if runner_result["success"]:
        expected = tc["expected"].strip()
        actual = runner_result["stdout"].strip()
        passed = actual == expected
        error = None
    else:
        actual = runner_result["error"] or "Runtime Error"
        passed = False
        error = _translate_error(runner_result.get("stderr", "") or runner_result.get("error", ""), language)

    return {
        "test_id": test_id,
        "input": tc["input"].strip(),
        "expected": tc["expected"].strip(),
        "actual": actual,
        "passed": passed,
        "time": runner_result["time"],
        "error": error or runner_result["error"],
    }


def run_with_test_cases(code: str, test_cases: list, timeout: int = 5, language: str = "python") -> list:
    """对多个测试用例执行代码并返回结果。"""
    results = []

    if language == "cpp":
        tmp_dir = tempfile.mkdtemp()
        try:
            bin_path, compile_error, compile_elapsed = _compile_cpp(code, tmp_dir, timeout)
            if compile_error:
                translated = _translate_error(compile_error, "cpp")
                for i, tc in enumerate(test_cases):
                    results.append({
                        "test_id": i + 1,
                        "input": tc["input"].strip(),
                        "expected": tc["expected"].strip(),
                        "actual": translated,
                        "passed": False,
                        "time": compile_elapsed,
                        "error": translated,
                    })
                return results

            for i, tc in enumerate(test_cases):
                r = _run_binary(bin_path, tc["input"], timeout)
                results.append(_flatten_result(r, tc, i + 1, "cpp"))
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)
    else:
        for i, tc in enumerate(test_cases):
            r = run_code(code, tc["input"], timeout)
            results.append(_flatten_result(r, tc, i + 1, "python"))

    return results


if __name__ == "__main__":
    import sys

    if len(sys.argv) >= 2 and sys.argv[1] == "test":
        req = json.loads(sys.stdin.read())
        code = req["code"]
        test_cases = req["test_cases"]
        timeout = req.get("timeout", 5)
        results = run_with_test_cases(code, test_cases, timeout)
        print(json.dumps(results, ensure_ascii=False))
