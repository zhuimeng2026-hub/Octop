#!/usr/bin/env python3
"""夜间 L4 评测任务集执行器（docs/eval/README.md §5「夜间」集合）。

做什么：

1. **收集**任务集 —— 读 ``docs/eval/tasks/*.yaml`` 与 ``docs/eval/examples/*.yaml``
   （规范 §6 的目录约定：可执行任务集放 ``docs/eval/tasks``，样板放 ``examples``）。
2. **挑选**夜间集合 —— ``status`` 非 ``deprecated`` 的任务；``planned`` 的任务
   按 §3 记为「口径已定·实现待做」，不算失败也不算通过。
3. **执行** ``judge.kind: test`` 的任务 —— 在 ``judge.cwd`` 下跑受审命令，逐条留日志。
   跑命令的进程跑在**沙箱数据目录**里（与全量测试同一套沙箱），绝不碰生产 ``OCTOP_HOME``。
4. **判定** —— 退出码非 0 即失败；**零匹配不算通过**（规范 §4 红线 1：
   命令退出码 0 但没收集到目标用例时不得判为通过）。
5. **出报告** —— 逐条任务的结论与日志路径，供调用方并进总报告。

不做什么（按规范 §3 / §4 的诚实要求，明确记为跳过或受阻，而不是假装通过）：

- ``status: planned`` —— 需求口径已定、实现未落地，不进夜间集合。
- ``live: true`` —— 需要真实模型 / 真实账号；配额口径见 backlog B-004，
  未获授权前默认不跑（``EVAL_RUN_LIVE=1`` 才开）。
- ``judge.kind`` 为 ``steps`` / ``visual`` / ``rubric`` —— 没有自动执行器，
  需人工走查并留证据（规范 §4 红线 2）。
- **前端任务**（``dashboard/``、npm/npx/vite）—— 后端环境禁止运行前端工具链
  （docs/deployment-boundary.md §1 NEVER 行、§2 决策表；CLAUDE.md §Commands）。
- **桌面任务**（``desktop/``、go 工具链）—— 桌面客户端是独立交付单元，在 Windows
  出包机上构建（docs/desktop-windows-build.md）；后端生产机不跑桌面侧命令
  （CLAUDE.md §「desktop/」条、AGENTS.md §1 本地验证表）。
- 依赖不存在的文件 / 目录 —— 记 ``blocked``，不静默跳过。

退出码：``0`` = 全部通过（跳过 / 受阻不算失败）；``1`` = 有失败任务；
``2`` = 执行器自身异常（任务集读不了、报告写不出来等）。

用法::

    scripts/run_eval_nightly.py                  # 跑夜间集合
    scripts/run_eval_nightly.py --dry-run        # 只列任务与判定，不执行
    scripts/run_eval_nightly.py --domain PLB     # 只跑某个领域
    scripts/run_eval_nightly.py --task PLB-001   # 只跑某条任务（逗号分隔多个）
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# ── 配置 ─────────────────────────────────────────────────────────────────────


def _env(name: str, default: str) -> str:
    value = os.environ.get(name, "").strip()
    return value or default


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


REPO_DIR = Path(_env("OCTOP_REPO", "/opt/Octop"))
REPORT_DIR = Path(_env("EVAL_REPORT_DIR", "/opt/octop-test-reports"))
# 评测任务跑在自己的数据目录里：与全量测试同一套沙箱，生产数据不受影响。
ISOLATED_HOME = Path(
    _env(
        "EVAL_ISOLATED_HOME",
        _env("TEST_ISOLATED_HOME", str(Path("/opt/octop-data-test-home"))),
    )
)
PYTHON_BIN = _env("EVAL_PYTHON", sys.executable)
TASK_TIMEOUT_S = int(_env("EVAL_TIMEOUT", "900"))
RUN_LIVE = _flag("EVAL_RUN_LIVE")
ALLOW_NPM = _flag("EVAL_ALLOW_NPM")
ALLOW_DESKTOP = _flag("EVAL_ALLOW_DESKTOP")
TASKSET_DIRS = [
    Path(p) for p in _env("EVAL_TASKSETS", "docs/eval/tasks,docs/eval/examples").split(",") if p
]

# 规范 §3：枚举值（写错的任务不算「跑过了」，记 invalid）。
LAYERS = {"L3", "L4"}
SEVERITIES = {"must", "should", "may"}
TYPES = {"automated", "manual", "visual", "perf", "rubric"}
REGRESSIONS = {"smoke", "full", "nightly"}
STATUSES = {"planned", "active", "deprecated"}
REQUIRED_FIELDS = (
    "id",
    "title",
    "requirement",
    "layer",
    "severity",
    "owner",
    "type",
    "judge",
    "evidence",
    "regression",
    "blocking",
)

# 后端环境禁用前端工具链（docs/deployment-boundary.md §1 的 NEVER 行）。
FRONTEND_TOOL_RE = re.compile(r"(^|[\s/])(npm|npx|pnpm|yarn|vite)([\s]|$)")
# 后端环境不跑桌面侧命令（桌面客户端是独立交付单元，见 CLAUDE.md「desktop/」条、
# docs/desktop-windows-build.md「必须在 Windows 上构建」）。
DESKTOP_TOOL_RE = re.compile(r"(^|[\s/])(go|wails3|task)([\s]|$)")
FRONTEND_DIR_RE = re.compile(r"^(dashboard)(/|$)")
DESKTOP_DIR_RE = re.compile(r"^(desktop)(/|$)")

# 规范 §4 红线 1：零匹配不得判为通过。
ZERO_MATCH_MARKERS = (
    "no tests ran",
    "no tests collected",
    "collected 0 items",
    "no test files found",
    "no test found",
    "no test suite found",
    "no tests to run",
    "no test matches",
    "0 passed",
    "0 tests",
)
# 命令带了过滤条件时，必须能看到至少一条真的跑过的用例。
FILTER_TOKENS = (" -k ", " -t ", "--test-name-pattern", "-run ", "--filter", "-m ")
PASSED_RE = re.compile(r"(\d+)\s+passed")
GO_PASS_RE = re.compile(r"^--- PASS", re.MULTILINE)


def log(msg: str) -> None:
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] eval: {msg}", flush=True)


# ── 数据结构 ─────────────────────────────────────────────────────────────────


@dataclass
class TaskResult:
    id: str
    domain: str
    title: str
    requirement: str
    layer: str
    severity: str
    owner: str
    type: str
    regression: str
    blocking: bool
    live: bool
    status: str  # pass / fail / skipped / blocked / invalid
    reason: str = ""
    command: str = ""
    source_command: str = ""
    cwd: str = ""
    exit_code: int | None = None
    duration_s: float = 0.0
    log_path: str = ""
    task_set: str = ""

    def to_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)


@dataclass
class Task:
    raw: dict[str, Any]
    domain: str
    task_set: Path
    problems: list[str] = field(default_factory=list)


@dataclass
class EvalOutcome:
    """一次夜间评测的结论。"""

    results: list[TaskResult] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)
    json_path: str = ""
    md_path: str = ""
    exception: str = ""

    @property
    def summary(self) -> dict[str, int]:
        return {
            "pass": sum(1 for r in self.results if r.status == "pass"),
            "fail": sum(1 for r in self.results if r.status == "fail"),
            "skipped": sum(1 for r in self.results if r.status == "skipped"),
            "blocked": sum(1 for r in self.results if r.status == "blocked"),
            "invalid": sum(1 for r in self.results if r.status == "invalid"),
        }

    @property
    def failed_tasks(self) -> list[TaskResult]:
        return [r for r in self.results if r.status in {"fail", "invalid"}]

    def to_dict(self) -> dict[str, Any]:
        return {
            "summary": self.summary,
            "problems": self.problems,
            "exception": self.exception,
            "json_path": self.json_path,
            "tasks": [r.to_dict() for r in self.results],
        }


# ── 任务集读取 ───────────────────────────────────────────────────────────────


def collect_tasks(repo_dir: Path | None = None) -> tuple[list[Task], list[str]]:
    """读任务集 → 任务列表 + 全局问题（读不了的文件等）。"""
    import yaml  # PyYAML：仓库已有依赖

    repo = repo_dir or REPO_DIR
    tasks: list[Task] = []
    problems: list[str] = []
    seen_ids: set[str] = set()

    for rel_dir in TASKSET_DIRS:
        directory = repo / rel_dir
        if not directory.is_dir():
            continue
        for path in sorted(directory.glob("*.yaml")):
            try:
                doc = yaml.safe_load(path.read_text(encoding="utf-8"))
            except Exception as exc:  # noqa: BLE001 — 任务集坏了要说清楚，不能崩
                problems.append(f"{rel_dir}/{path.name}: YAML 解析失败 —— {exc}")
                continue
            if not isinstance(doc, dict):
                problems.append(f"{rel_dir}/{path.name}: 顶层不是映射")
                continue
            domain = str(doc.get("domain") or path.stem)
            raw_tasks = doc.get("tasks")
            if not isinstance(raw_tasks, list):
                problems.append(f"{rel_dir}/{path.name}: 缺少 tasks 列表")
                continue
            for raw in raw_tasks:
                if not isinstance(raw, dict):
                    problems.append(f"{rel_dir}/{path.name}: tasks 里有一项不是映射")
                    continue
                task = Task(raw=raw, domain=domain, task_set=path)
                task.problems = validate_task(task)
                tid = str(raw.get("id") or "")
                if tid and tid in seen_ids:
                    task.problems.append(f"任务 id 重复：{tid}")
                if tid:
                    seen_ids.add(tid)
                tasks.append(task)
    return tasks, problems


def validate_task(task: Task) -> list[str]:
    """按规范 §3 的字段表做最小校验。"""
    raw = task.raw
    problems: list[str] = []
    for name in REQUIRED_FIELDS:
        if name not in raw:
            problems.append(f"缺少必填字段 {name}")
    if raw.get("layer") not in LAYERS:
        problems.append(f"layer 非法：{raw.get('layer')!r}")
    if raw.get("severity") not in SEVERITIES:
        problems.append(f"severity 非法：{raw.get('severity')!r}")
    if raw.get("type") not in TYPES:
        problems.append(f"type 非法：{raw.get('type')!r}")
    if raw.get("regression") not in REGRESSIONS:
        problems.append(f"regression 非法：{raw.get('regression')!r}")
    status = raw.get("status", "active")
    if status not in STATUSES:
        problems.append(f"status 非法：{status!r}")
    if not isinstance(raw.get("blocking"), bool):
        problems.append("blocking 必须是布尔值")
    judge = raw.get("judge")
    if not isinstance(judge, dict) or not judge.get("kind"):
        problems.append("judge 必须是带 kind 的映射")
    return problems


# ── 执行 ─────────────────────────────────────────────────────────────────────


def sandbox_env(python_bin: str | None = None) -> dict[str, str]:
    """评测命令的环境：沙箱 OCTOP_HOME + PATH 前置解释器。"""
    env = dict(os.environ)
    env["OCTOP_HOME"] = str(ISOLATED_HOME)
    env["HOME"] = str(ISOLATED_HOME / "home")
    env["USERPROFILE"] = env["HOME"]
    for key in (
        "OCTOP_DATABASE_URL",
        "OCTOP_DATABASE_DRIVER",
        "OCTOP_DATABASE_SQLITE_PATH",
        "OCTOP_DATABASE_HOST",
        "OCTOP_DATABASE_PORT",
        "OCTOP_DATABASE_NAME",
        "OCTOP_DATABASE_USER",
        "OCTOP_DATABASE_PASSWORD",
    ):
        env.pop(key, None)
    # 命令里的 `python` 解析成执行器用的解释器（默认就是跑本脚本的那个）。
    python_dir = str(Path(python_bin or PYTHON_BIN).resolve().parent)
    env["PATH"] = python_dir + os.pathsep + env.get("PATH", "")
    return env


def prepare_sandbox() -> None:
    if ISOLATED_HOME.exists():
        shutil.rmtree(ISOLATED_HOME, ignore_errors=True)
    ISOLATED_HOME.mkdir(parents=True, exist_ok=True)
    (ISOLATED_HOME / "home").mkdir(parents=True, exist_ok=True)


def zero_match_reason(command: str, output: str) -> str:
    """命令跑通但没真正执行目标用例 → 不能判为通过（规范 §4 红线 1）。"""
    lowered = output.lower()
    for marker in ZERO_MATCH_MARKERS:
        if marker in lowered:
            return f"零匹配：输出含 {marker!r}，没有真正执行目标用例"
    if any(token in command for token in FILTER_TOKENS):
        passed = PASSED_RE.search(output)
        go_passed = bool(GO_PASS_RE.search(output))
        if not go_passed and (not passed or int(passed.group(1)) == 0):
            return "零匹配：命令带过滤条件，但没有任何用例被执行"
    return ""


def _rewrite_command(command: str) -> str:
    """把 ``uv run pytest ...`` 换成当前解释器。

    任务集里的命令按仓库习惯写成 ``uv run pytest``（可移植），但夜间执行器要跑在
    离线稳定的服务器上：``uv run`` 可能去解析/同步依赖。换成执行器自己的解释器
    （``EVAL_PYTHON``，默认就是跑本脚本的那个）后，命令语义不变且不依赖网络。
    """
    for prefix in ("uv run pytest", "uv run python"):
        if command.startswith(prefix):
            rest = command[len(prefix) :].strip()
            if prefix.endswith("pytest"):
                return f'"{PYTHON_BIN}" -m pytest {rest}'.strip()
            return f'"{PYTHON_BIN}" {rest}'.strip()
    return command


def _boundary_block(command: str, cwd_rel: str) -> str:
    """后端生产机上的边界闸门：前端任务与桌面任务都不在这里跑。"""
    if FRONTEND_DIR_RE.match(cwd_rel) or (not ALLOW_NPM and FRONTEND_TOOL_RE.search(command)):
        return (
            "后端环境禁止运行前端工具链（docs/deployment-boundary.md §1 NEVER 行、"
            "§2 决策表；CLAUDE.md §Commands）；该任务需在前端环境执行"
        )
    if DESKTOP_DIR_RE.match(cwd_rel) or (not ALLOW_DESKTOP and DESKTOP_TOOL_RE.search(command)):
        return (
            "后端生产机不跑桌面侧命令：桌面客户端是独立交付单元，在 Windows 出包机上"
            "构建与验证（docs/desktop-windows-build.md；CLAUDE.md「desktop/」条、"
            "AGENTS.md §1 本地验证表）"
        )
    return ""


def run_task(task: Task, log_dir: Path, repo_dir: Path | None = None) -> TaskResult:
    repo = repo_dir or REPO_DIR
    raw = task.raw
    judge = raw.get("judge") or {}
    result = TaskResult(
        id=str(raw.get("id") or "?"),
        domain=task.domain,
        title=str(raw.get("title") or ""),
        requirement=str(raw.get("requirement") or ""),
        layer=str(raw.get("layer") or ""),
        severity=str(raw.get("severity") or ""),
        owner=str(raw.get("owner") or ""),
        type=str(raw.get("type") or ""),
        regression=str(raw.get("regression") or ""),
        blocking=bool(raw.get("blocking")),
        live=bool(raw.get("live", False)),
        status="skipped",
        task_set=str(task.task_set.relative_to(repo))
        if task.task_set.is_relative_to(repo)
        else str(task.task_set),
    )

    if task.problems:
        result.status = "invalid"
        result.reason = "；".join(task.problems)
        return result

    status = str(raw.get("status", "active"))
    if status == "deprecated":
        result.reason = "已废弃（status: deprecated）"
        return result
    if status == "planned":
        result.reason = "口径已定·实现待做（status: planned），不进夜间集合"
        return result

    kind = str(judge.get("kind") or "")
    if kind != "test":
        result.reason = f"judge.kind={kind} 没有自动执行器，需人工走查并留证据（规范 §4 红线 2）"
        return result

    if result.live and not RUN_LIVE:
        result.reason = "live 任务需要真实模型/账号，配额口径见 backlog B-004，未获授权不跑"
        return result

    command = str(judge.get("command") or "").strip()
    if not command:
        result.status = "invalid"
        result.reason = "judge.kind=test 但没有 command"
        return result

    cwd_rel = str(judge.get("cwd") or "").strip()
    result.source_command = command
    result.command = _rewrite_command(command)
    result.cwd = cwd_rel or "."

    blocked = _boundary_block(command, cwd_rel)
    if blocked:
        result.status = "blocked"
        result.reason = blocked
        return result

    cwd = (repo / cwd_rel).resolve() if cwd_rel else repo
    if not cwd.is_dir():
        result.status = "blocked"
        result.reason = f"judge.cwd 不存在：{cwd_rel or '.'}"
        return result

    log_path = log_dir / f"{result.id}.log"
    started = time.time()
    try:
        proc = subprocess.run(  # noqa: S603 — 命令来自仓库内的任务集，是受审命令
            result.command,
            shell=True,
            cwd=str(cwd),
            env=sandbox_env(),
            capture_output=True,
            text=True,
            timeout=TASK_TIMEOUT_S,
            errors="replace",
        )
        output = (proc.stdout or "") + "\n" + (proc.stderr or "")
        exit_code = proc.returncode
    except subprocess.TimeoutExpired:
        output = f"超时：{TASK_TIMEOUT_S}s 内没有结束"
        exit_code = None
    except Exception as exc:  # noqa: BLE001 — 任何异常都要留痕，不能让整轮崩掉
        output = f"执行异常：{exc}"
        exit_code = None

    result.duration_s = round(time.time() - started, 2)
    result.exit_code = exit_code
    result.log_path = str(log_path)
    log_path.write_text(output, encoding="utf-8")

    if exit_code is None:
        result.status = "fail"
        result.reason = "命令异常或超时（见日志）"
        return result
    if exit_code != 0:
        result.status = "fail"
        result.reason = f"命令退出码 {exit_code}（见日志）"
        return result
    zero = zero_match_reason(result.command, output)
    if zero:
        result.status = "fail"
        result.reason = zero
        return result
    result.status = "pass"
    result.reason = "通过"
    return result


# ── 报告 ─────────────────────────────────────────────────────────────────────


def git_info(repo_dir: Path | None = None) -> dict[str, Any]:
    repo = repo_dir or REPO_DIR

    def _git(*args: str) -> str:
        try:
            out = subprocess.run(
                ["git", "-C", str(repo), *args],
                capture_output=True,
                text=True,
                timeout=30,
            )
            return out.stdout.strip()
        except Exception:  # noqa: BLE001
            return ""

    dirty = _git("status", "--porcelain")
    return {
        "commit": _git("rev-parse", "HEAD"),
        "commit_short": _git("rev-parse", "--short", "HEAD"),
        "branch": _git("branch", "--show-current"),
        "dirty": bool(dirty),
        "dirty_files": [line for line in dirty.splitlines() if line.strip()][:20],
    }


def write_eval_reports(
    outcome: EvalOutcome,
    info: dict[str, Any],
    started: str,
    report_dir: Path | None = None,
) -> tuple[Path, Path]:
    directory = report_dir or REPORT_DIR
    directory.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    summary = outcome.summary
    doc = {
        "started_at": started,
        "finished_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "repo": str(REPO_DIR),
        "git": info,
        "python": PYTHON_BIN,
        "isolated_home": str(ISOLATED_HOME),
        "run_live": RUN_LIVE,
        "allow_npm": ALLOW_NPM,
        "allow_desktop": ALLOW_DESKTOP,
        "collection_problems": outcome.problems,
        "summary": summary,
        "tasks": [r.to_dict() for r in outcome.results],
    }
    json_path = directory / f"eval-{stamp}.json"
    json_path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# 夜间 L4 评测报告",
        "",
        f"- 时间：{doc['started_at']} → {doc['finished_at']}",
        f"- commit：`{info.get('commit_short')}`（分支 `{info.get('branch') or '?'}`，"
        f"工作树{'有未提交改动' if info.get('dirty') else '干净'}）",
        f"- 解释器：`{PYTHON_BIN}`　沙箱：`{ISOLATED_HOME}`",
        f"- 结论：{summary['pass']} 通过 / {summary['fail']} 失败 / "
        f"{summary['skipped']} 跳过 / {summary['blocked']} 受阻 / {summary['invalid']} 非法",
        "",
        "> 依据 docs/eval/README.md §4：跳过与受阻都记原因，不算通过；未运行不写 pass。",
        "",
        "| 任务 | 领域 | 严重度 | 集合 | 结论 | 原因 |",
        "|---|---|---|---|---|---|",
    ]
    for r in outcome.results:
        reason = r.reason.replace("|", "\\|")
        lines.append(
            f"| `{r.id}` | {r.domain} | {r.severity} | {r.regression} | **{r.status}** | {reason} |"
        )
    if outcome.problems:
        lines += ["", "## 任务集问题", ""]
        lines += [f"- {p}" for p in outcome.problems]
    md_path = directory / f"eval-{stamp}.md"
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return json_path, md_path


# ── 阶段入口 ─────────────────────────────────────────────────────────────────


def run_eval_stage(
    *,
    repo_dir: Path | None = None,
    report_dir: Path | None = None,
    domain: str = "",
    task_ids: str = "",
    dry_run: bool = False,
) -> EvalOutcome:
    """跑一轮夜间评测集合。异常不外抛 —— 由调用方决定怎么记。"""
    repo = repo_dir or REPO_DIR
    outcome = EvalOutcome()
    started = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    try:
        tasks, problems = collect_tasks(repo)
    except Exception as exc:  # noqa: BLE001
        outcome.exception = f"任务集读取失败：{exc}"
        return outcome
    outcome.problems = problems

    wanted = {t.strip() for t in task_ids.split(",") if t.strip()}
    selected = [
        t
        for t in tasks
        if (not domain or t.domain == domain) and (not wanted or str(t.raw.get("id")) in wanted)
    ]

    if dry_run:
        for t in selected:
            judge = t.raw.get("judge") or {}
            print(
                f"[dry-run] {t.raw.get('id')} status={t.raw.get('status', 'active')} "
                f"kind={judge.get('kind')} cwd={judge.get('cwd', '.')} "
                f"cmd={judge.get('command', '')}"
            )
        log(f"任务集：{len(tasks)} 条任务，选中 {len(selected)} 条（dry-run，未执行）")
        return outcome

    prepare_sandbox()
    directory = report_dir or REPORT_DIR
    log_dir = directory / f"eval-logs-{time.strftime('%Y%m%d-%H%M%S')}"
    log_dir.mkdir(parents=True, exist_ok=True)

    for task in selected:
        result = run_task(task, log_dir, repo)
        outcome.results.append(result)
        log(f"{result.id} → {result.status}：{result.reason}")

    info = git_info(repo)
    json_path, md_path = write_eval_reports(outcome, info, started, directory)
    outcome.json_path = str(json_path)
    outcome.md_path = str(md_path)
    return outcome


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="夜间 L4 评测任务集执行器")
    parser.add_argument("--dry-run", action="store_true", help="只列任务与判定，不执行")
    parser.add_argument("--domain", default="", help="只跑某个领域（如 PLB）")
    parser.add_argument("--task", default="", help="只跑某条任务 id（逗号分隔）")
    parser.add_argument("--report-dir", default="", help="报告目录（默认 EVAL_REPORT_DIR）")
    args = parser.parse_args(argv)

    outcome = run_eval_stage(
        report_dir=Path(args.report_dir) if args.report_dir else None,
        domain=args.domain,
        task_ids=args.task,
        dry_run=args.dry_run,
    )
    if outcome.exception:
        log(outcome.exception)
        return 2
    summary = outcome.summary
    log(
        f"结论：通过 {summary['pass']} / 失败 {summary['fail']} / 跳过 {summary['skipped']} / 受阻 {summary['blocked']}"
    )
    if outcome.json_path:
        log(f"报告：{outcome.json_path}")
    for r in outcome.failed_tasks:
        log(f"失败任务：{r.id} —— {r.reason}")
    return 1 if outcome.failed_tasks else 0


if __name__ == "__main__":
    sys.exit(main())
