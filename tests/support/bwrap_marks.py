"""Shared pytest markers for bubblewrap / scoped-root_dir tests."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from functools import lru_cache

import pytest

# Real bubblewrap jail (subprocess + ro-bind); Linux CI only.
linux_bwrap_only = pytest.mark.skipif(
    sys.platform != "linux" or shutil.which("bwrap") is None,
    reason="bubblewrap jail requires Linux with bwrap on PATH",
)


@lru_cache(maxsize=1)
def bwrap_runnable() -> tuple[bool, str]:
    """探测当前账号能否真的把 bwrap 跑起来（能否建 user namespace / uid map）。

    bwrap 装了 ≠ 能用：非 root 且内核拒绝写 uid map 时，bwrap 会以
    ``setting up uid map: Permission denied`` 失败退出。这类环境性不可用
    必须让用例**跳过**，不能算失败——否则夜间任务每晚都会挂同一批用例，
    真回归会被淹没。

    返回 ``(可用, 原因)``；原因同时用作 skip 提示。
    """
    if sys.platform != "linux":
        return False, "bubblewrap jail requires Linux"
    bwrap = shutil.which("bwrap")
    if bwrap is None:
        return False, "bubblewrap jail requires bwrap on PATH"
    try:
        proc = subprocess.run(
            [bwrap, "--ro-bind", "/", "/", "--dev", "/dev", "true"],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError) as exc:  # pragma: no cover - 环境异常
        return False, f"bwrap 探测异常：{exc}"
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip().splitlines()
        tail = detail[-1] if detail else "无输出"
        return False, f"bwrap 在当前账号无法启动（rc={proc.returncode}）：{tail}"
    return True, ""


_BWRAP_RUNNABLE, _BWRAP_SKIP_REASON = bwrap_runnable()

# 需要**真正执行** bwrap 的用例：bwrap 装着但当前账号跑不起来时跳过
# （环境性不可用，不是代码回归）。
bwrap_runnable_only = pytest.mark.skipif(
    not _BWRAP_RUNNABLE,
    reason=_BWRAP_SKIP_REASON,
)

# Tests that shell out with POSIX ``sh`` syntax (``mkdir -p``, ``cat``, …).
posix_shell_only = pytest.mark.skipif(
    os.name != "posix",
    reason="POSIX shell commands (sh/bash)",
)
