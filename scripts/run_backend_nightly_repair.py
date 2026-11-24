#!/usr/bin/env python3
"""夜间后端全量测试的**基线轮**执行器（docs/backend-nightly-repair.md §4.1–§4.2）。

这个脚本只做手册里可机械判定的那一段，剩下的（失败归因、最小修复、候选快照、
结果卡）交给夜间智能体按手册执行：

1. 生成唯一 ``run_id``，建本轮唯一目录（报告 / checkout / HOME / OCTOP_HOME /
   tmp / pytest tmp 全部独立于生产）；
2. 从 ``cnb/develop`` 只读克隆出**独立 checkout**，取**本轮真实完整 SHA** 作为
   ``baseline_sha``（不写死任何历史 SHA）；
3. ``uv sync --locked`` 准备依赖；
4. ``uv run --locked --no-sync pytest -m 'not live' -q`` 跑基线全量；
5. 按手册 §3 绑定证据：基线 SHA、pytest 根目录、隔离目录、精确命令、退出码、
   收集数/结果摘要、完整日志路径与产物 SHA256、环境快照。

**不碰生产**：不改生产 checkout、不读生产 ``OCTOP_HOME``、不写生产数据、不重启
或改动生产服务、不调用真实外部服务/微信、不构建前端或桌面端。

退出码：``0`` = 基线全量通过；``1`` = 跑完但有真实失败用例；``2`` = blocked
（环境/依赖/权限异常、证据缺失、基线不可取得等 —— 不得改写成 pass）。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

REPO_URL_DEFAULT = "https://cnb.cool/mengxa.com/Octop.git"
BRANCH_DEFAULT = "develop"
PYTEST_ARGS = "-m 'not live' -q"
# 生产环境变量即使在环境里也不许继承进测试进程。
INHERIT_BLOCKLIST = (
    "OCTOP_DATABASE_URL",
    "OCTOP_DATABASE_DRIVER",
    "OCTOP_DATABASE_SQLITE_PATH",
    "OCTOP_DATABASE_HOST",
    "OCTOP_DATABASE_PORT",
    "OCTOP_DATABASE_NAME",
    "OCTOP_DATABASE_USER",
    "OCTOP_DATABASE_PASSWORD",
    "OCTOP_BASE_URL",
    "OCTOP_ADMIN_TOKEN",
    "OCTOP_JWT_SECRET",
)


def log(msg: str) -> None:
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] nightly-repair: {msg}", flush=True)


def run(
    cmd: list[str],
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    timeout: int = 3600,
) -> tuple[int, str]:
    """跑一条命令，返回 (退出码, 合并输出)。"""
    try:
        proc = subprocess.run(  # noqa: S603 — 命令由本脚本固定
            cmd,
            cwd=str(cwd) if cwd else None,
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout,
            errors="replace",
        )
    except FileNotFoundError:
        return 127, f"命令不存在：{cmd[0]}"
    except subprocess.TimeoutExpired:
        return 124, f"命令超时（{timeout}s）：{' '.join(cmd)}"
    return proc.returncode, (proc.stdout or "") + "\n" + (proc.stderr or "")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_pytest_summary(text: str) -> dict[str, Any]:
    """从 pytest 输出尾部解析收集数与结果摘要。"""
    summary: dict[str, Any] = {"summary_line": "", "collected": None, "passed": 0, "failed": 0}
    for line in reversed(text.splitlines()):
        line = line.strip()
        if not line:
            continue
        if "passed" in line or "failed" in line or "error" in line:
            summary["summary_line"] = line.lstrip("= ").strip()[:400]
            m = re.search(r"(\d+)\s+passed", line)
            if m:
                summary["passed"] = int(m.group(1))
            m = re.search(r"(\d+)\s+failed", line)
            if m:
                summary["failed"] = int(m.group(1))
            break
    m = re.search(r"collected\s+(\d+)\s+items?", text)
    if m:
        summary["collected"] = int(m.group(1))
    return summary


def parse_rootdir(text: str) -> str:
    for line in text.splitlines():
        if line.startswith("rootdir:"):
            return line.split(":", 1)[1].strip()
    return ""


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="夜间后端全量测试基线轮执行器")
    parser.add_argument("--report-dir", default=os.environ.get("NIGHTLY_REPORT_DIR", ""))
    parser.add_argument("--repo-url", default=os.environ.get("NIGHTLY_REPO_URL", REPO_URL_DEFAULT))
    parser.add_argument("--branch", default=os.environ.get("NIGHTLY_BRANCH", BRANCH_DEFAULT))
    parser.add_argument(
        "--timeout", type=int, default=int(os.environ.get("NIGHTLY_PYTEST_TIMEOUT", "7200"))
    )
    parser.add_argument("--keep", action="store_true", help="保留本轮目录（默认保留，证据必须留）")
    args = parser.parse_args(argv)

    report_root = (
        Path(args.report_dir) if args.report_dir else Path("/opt/octop-test-reports/nightly-repair")
    )
    run_id = f"{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}-{secrets.token_hex(3)}"
    run_dir = report_root / run_id
    checkout = run_dir / "checkout"
    home = run_dir / "home"
    octop_home = run_dir / "octop-home"
    tmp = run_dir / "tmp"
    for d in (run_dir, home, octop_home, tmp):
        d.mkdir(parents=True, exist_ok=True)
    log(f"run_id={run_id}")
    log(f"目录={run_dir}")

    env = {k: v for k, v in os.environ.items() if k not in INHERIT_BLOCKLIST}
    env["HOME"] = str(home)
    env["OCTOP_HOME"] = str(octop_home)
    env["TMPDIR"] = str(tmp)
    env["TMP"] = str(tmp)
    env["TEMP"] = str(tmp)
    env["UV_CACHE_DIR"] = str(tmp / "uv-cache")
    env["PYTEST_ADDOPTS"] = ""
    env["GIT_TERMINAL_PROMPT"] = "0"

    evidence: dict[str, Any] = {
        "run_id": run_id,
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "repo_url": args.repo_url,
        "branch": args.branch,
        "run_dir": str(run_dir),
        "isolated": {
            "home": str(home),
            "octop_home": str(octop_home),
            "tmp": str(tmp),
            "checkout": str(checkout),
        },
        "commands": [],
        "artifacts": {},
    }
    blocked_reason = ""

    # ── 预检：工具与身份 ───────────────────────────────────────────────────
    who = run(["id", "-u", "-n"])[1].strip()
    evidence["uid"] = who
    evidence["is_root"] = who == "root"
    for tool in ("git", "uv", "python3"):
        rc, out = run([tool, "--version"])
        evidence.setdefault("tools", {})[tool] = (
            out.strip().splitlines()[0] if out.strip() else "缺失"
        )
        if rc != 0:
            blocked_reason = f"{tool} 不可用（退出码 {rc}）"
    if blocked_reason:
        log(f"BLOCKED：{blocked_reason}")
        evidence["status"] = "blocked"
        evidence["blocked_reason"] = blocked_reason
        _write_reports(run_dir, evidence, None)
        return 2

    # ── 基线：只读克隆 cnb/develop，取本轮真实 SHA ─────────────────────────
    # --depth 1：只取分支尖端（手册要的「本轮真实完整 SHA」就是尖端 SHA），
    # 浅克隆够用且快得多；候选分支与补丁都在这份 checkout 上做，不需要历史。
    clone_cmd = [
        "git",
        "clone",
        "--branch",
        args.branch,
        "--single-branch",
        "--depth",
        "1",
        args.repo_url,
        str(checkout),
    ]
    evidence["commands"].append(" ".join(clone_cmd))
    rc, out = run(clone_cmd, env=env, timeout=900)
    (run_dir / "clone.log").write_text(out, encoding="utf-8")
    if rc != 0:
        blocked_reason = f"克隆 {args.repo_url}#{args.branch} 失败（退出码 {rc}）"
        log(f"BLOCKED：{blocked_reason}")
        evidence["status"] = "blocked"
        evidence["blocked_reason"] = blocked_reason
        _write_reports(run_dir, evidence, None)
        return 2

    rc, out = run(["git", "rev-parse", "HEAD"], cwd=checkout, env=env)
    baseline_sha = out.strip()
    evidence["baseline_sha"] = baseline_sha
    evidence["baseline_branch"] = args.branch
    rc2, out2 = run(["git", "status", "--short"], cwd=checkout, env=env)
    evidence["baseline_status_short"] = out2.strip()
    log(f"baseline_sha={baseline_sha}")
    if not re.fullmatch(r"[0-9a-f]{40}", baseline_sha):
        blocked_reason = "取不到合法的基线完整 SHA"
        evidence["status"] = "blocked"
        evidence["blocked_reason"] = blocked_reason
        _write_reports(run_dir, evidence, None)
        return 2

    # ── 依赖：uv sync --locked ────────────────────────────────────────────
    sync_cmd = ["uv", "sync", "--locked"]
    evidence["commands"].append(" ".join(sync_cmd))
    rc, out = run(sync_cmd, cwd=checkout, env=env, timeout=1800)
    (run_dir / "uv-sync.log").write_text(out, encoding="utf-8")
    evidence["uv_sync_exit_code"] = rc
    if rc != 0:
        blocked_reason = f"uv sync --locked 失败（退出码 {rc}）"
        log(f"BLOCKED：{blocked_reason}")
        evidence["status"] = "blocked"
        evidence["blocked_reason"] = blocked_reason
        _write_reports(run_dir, evidence, None)
        return 2

    lock_path = checkout / "uv.lock"
    if lock_path.exists():
        evidence["artifacts"]["uv.lock"] = {
            "path": str(lock_path),
            "sha256": sha256_file(lock_path),
        }

    # ── 基线全量：uv run --locked --no-sync pytest ─────────────────────────
    pytest_cmd = ["uv", "run", "--locked", "--no-sync", "pytest", "-m", "not live", "-q"]
    evidence["commands"].append(" ".join(pytest_cmd))
    log(f"基线全量：{' '.join(pytest_cmd)}")
    started = time.time()
    rc, out = run(pytest_cmd, cwd=checkout, env=env, timeout=args.timeout)
    duration = round(time.time() - started, 1)
    pytest_log = run_dir / "pytest.log"
    pytest_log.write_text(out, encoding="utf-8")
    evidence["pytest"] = {
        "command": " ".join(pytest_cmd),
        "exit_code": rc,
        "duration_s": duration,
        "log_path": str(pytest_log),
        "rootdir": parse_rootdir(out),
        **parse_pytest_summary(out),
    }
    evidence["artifacts"]["pytest.log"] = {
        "path": str(pytest_log),
        "sha256": sha256_file(pytest_log),
    }
    log(f"基线全量结束：退出码={rc} 用时={duration}s")

    evidence["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    evidence["status"] = "pass" if rc == 0 else ("fail" if rc == 1 else "blocked")
    if rc not in (0, 1):
        evidence["blocked_reason"] = f"pytest 异常退出（退出码 {rc}）：可能是收集阶段崩溃或被终止"
    _write_reports(run_dir, evidence, evidence.get("pytest"))

    if rc == 0:
        log("基线：pass")
        return 0
    if rc == 1:
        log("基线：fail（有真实失败用例，按手册 §4.3 归因）")
        return 1
    log(f"基线：blocked —— {evidence.get('blocked_reason')}")
    return 2


def _write_reports(
    run_dir: Path, evidence: dict[str, Any], pytest_info: dict[str, Any] | None
) -> None:
    (run_dir / "baseline.json").write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    lines = [
        f"# 夜间基线轮 — {evidence['run_id']}",
        "",
        f"- 状态：`{evidence.get('status')}`",
        f"- 基线分支 / SHA：`{evidence.get('baseline_branch')}` / `{evidence.get('baseline_sha', '未取得')}`",
        f"- 本轮目录：`{run_dir}`",
        f"- 隔离目录：HOME=`{evidence['isolated']['home']}` OCTOP_HOME=`{evidence['isolated']['octop_home']}` "
        f"tmp=`{evidence['isolated']['tmp']}`",
        f"- 账号：{evidence.get('uid')}（root={evidence.get('is_root')}）",
        "",
        "## 命令",
        "",
    ]
    lines += [f"- `{c}`" for c in evidence.get("commands", [])]
    if pytest_info:
        lines += [
            "",
            "## 基线全量",
            "",
            f"- 命令：`{pytest_info['command']}`",
            f"- 退出码：{pytest_info['exit_code']}；用时：{pytest_info['duration_s']}s",
            f"- pytest 根目录：`{pytest_info['rootdir']}`",
            f"- 摘要：{pytest_info['summary_line'] or '（无）'}",
            f"- 日志：`{pytest_info['log_path']}`",
        ]
    if evidence.get("blocked_reason"):
        lines += ["", f"- blocked 原因：{evidence['blocked_reason']}"]
    if evidence.get("artifacts"):
        lines += ["", "## 产物 SHA256", ""]
        for name, art in evidence["artifacts"].items():
            lines.append(f"- `{name}`：`{art['sha256']}`（{art['path']}）")
    lines += [
        "",
        "> 归因、最小修复、候选快照与结果卡按 docs/backend-nightly-repair.md §4.3–§4.5 由夜间智能体完成。",
        "",
    ]
    (run_dir / "baseline.md").write_text("\n".join(lines), encoding="utf-8")
    log(f"证据已写入 {run_dir / 'baseline.json'}")


if __name__ == "__main__":
    sys.exit(main())
