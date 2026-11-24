# 后端全量测试（定时）

> 每天凌晨定时对**当前后端**跑一次完整 pytest，再用**子代理模型**
> （默认 `qiniu/conatus-free`，连续 429 会自动切到备用模型）分析测试结果，
> 产出可读的失败归因报告。

只做后端事务：不碰 `dashboard/`、不构建前端（边界见
[deployment-boundary.md](./deployment-boundary.md)）。

## 组成

| 部件 | 位置 | 作用 |
|---|---|---|
| git 同步脚本 | `scripts/git_sync_for_test.sh` | 测试前与 origin 对齐（ff-only，尽力而为，见「测试前的 git 同步」） |
| 编排脚本 | `scripts/run_backend_full_test.py` | 跑测试 → 跑 L4 评测 → 调子代理分析 → 出报告 |
| 评测执行器 | `scripts/run_eval_nightly.py` | 跑 L4 评测任务集（需求条目级判定，见「L4 评测（夜间集合）」） |
| systemd 服务 | `/etc/systemd/system/octop-backend-full-test.service` | 一次性任务，输出追加到 `/opt/octop-test-reports/backend-full-test.log`；drop-in `20-sandbox.conf`（沙箱闸门）+ `30-git-sync.conf`（git 同步） |
| systemd 定时器 | `/etc/systemd/system/octop-backend-full-test.timer` | 决定什么时候拉起（每天 02:00） |

## 当前服务器配置实测（2026-11-24，只读）

现有计划只有一条：`octop-backend-full-test.timer` 每天 **02:10（Asia/Shanghai）**
触发服务；当前服务实测为：

| 项 | 实测值 |
|---|---|
| `WorkingDirectory` | `/opt/Octop` |
| `ExecStart` | `/opt/Octop/scripts/run_backend_full_test.py` |
| `ExecStartPre` | `/usr/local/sbin/octop-full-test-sandbox-guard.sh`、`/usr/local/sbin/octop-git-sync-for-test.sh` |
| systemd `TEST_TARGET_BRANCH` | `fix/full-test-12-failures` |
| 当前 checkout | `fix/full-test-12-failures @ 615e184b` |

因此现有配置仍测生产 checkout 的同名修复分支，不能把旧报告当作 `develop` 验收。
最近的 `git-sync-latest.json` 若只是 `tmp/verify-old-script` 等临时手工记录，也不属于
02:10 任务的运行证据；必须以本轮报告实际记录的 checkout、SHA 和 pytest 根目录为准。

### develop 验收计划（沿用 02:10）

夜间失败归因、最小修复、候选快照与报告交接 MUST 按唯一运行手册
[backend-nightly-repair.md](./backend-nightly-repair.md) 执行；本文件以下内容保留为旧脚本的历史背景和沙箱证据，不得据此推断已完成新流程接入。

服务端后续只调整这条既有 timer 所调用的测试服务：将实际测试根目录/入口改为独立的
`develop` checkout，并保持生产 `/opt/Octop` 与生产数据目录不被测试切换或清理。不能只在
生产目录把 `TEST_TARGET_BRANCH=develop`，因为同步脚本会切生产工作树。验收时检查：

1. 报告记录独立 checkout 的 `develop` 分支、完整 SHA、pytest 根目录和隔离数据目录；
2. 报告中的 SHA 与该独立 checkout 同步后的 `git rev-parse HEAD` 一致，且服务仍使用同一条
   02:10 计划；
3. 运行中/完成后生产服务 checkout、生产数据目录和 `octop.service` 均未被测试任务改动。

#### 可交给执行 LLM 的 develop 检出与测试计划

首轮核对清单固定为以下 3 个提交（`89d6fbe8` 是首轮基线，不代表三项已接入）：

| SHA | 提交 |
|---|---|
| `89d6fbe88d7ad371dd212c668ed7131781bb9297` | `style(dashboard): 提交 pre-commit 格式化的测试文件` |
| `5a3ccce5b6f2f985ff8cb86d6442fba2aca415f4` | `fix(product-library): 停用素材导致项目快照整单失败返回 409` |
| `5f59d246da76789ef88a4ea32ba4707863e90b14` | `docs: 汇总文档规范细化与待办登记的在途改动` |

以下命令只允许在独立测试 checkout 中执行；不要在生产 `/opt/Octop` 中执行 checkout，
也不要继承生产服务的 `OCTOP_HOME`、JWT 或模型分析依赖：

```bash
set -eu
run_dir="$(mktemp -d /var/tmp/octop-backend-test.XXXXXXXX)"
mkdir -p "$run_dir/home" "$run_dir/octop-home"
git clone --branch develop --single-branch \
  https://cnb.cool/mengxa.com/Octop.git "$run_dir/repo"
cd "$run_dir/repo"
expected_sha=89d6fbe88d7ad371dd212c668ed7131781bb9297
git checkout --detach "$expected_sha"
test "$(git rev-parse HEAD)" = "$expected_sha"
env -i PATH="$PATH" HOME="$run_dir/home" OCTOP_HOME="$run_dir/octop-home" \
  uv sync --locked
if env -i PATH="$PATH" HOME="$run_dir/home" OCTOP_HOME="$run_dir/octop-home" \
  uv run --locked --no-sync pytest -m 'not live' -q >"$run_dir/pytest.log" 2>&1; then
  rc=0
else
  rc=$?
fi
printf '%s\n' "$rc" >"$run_dir/pytest.exit"
printf 'pytest_exit_code=%s\npytest_log=%s\n' "$rc" "$run_dir/pytest.log"
exit "$rc"
```

整段应在新的 Bash 进程中运行（例如保存为脚本后由 systemd 调用），避免 SSH 交互 shell
退出或断开时改变测试任务的退出状态。

如果测试入口仍依赖生产 `octop.service`、生产管理 JWT 或生产模型分析，不能声称已完成
独立 checkout 验收；该项记为 **blocked**，应由服务端改为隔离的命令级环境或独立测试服务。
把现有 runner 回退到旧 SHA 也一律记为 **blocked**，不得当作 develop 结果。

执行 LLM 必须把 3 个目标提交逐项列出（SHA、提交标题、涉及路径），并保存上述命令的
完整 stdout/stderr、退出码、pytest 日志及 JSON/Markdown 报告。首轮报告状态只能是：
`pass`（本轮命令和证据完整且 pytest 退出码为 0）、`fail`（测试完成但有失败用例，列出
失败与归因）或 `blocked`（checkout、依赖、沙箱、产物或生产隔离证据缺失/异常）。首轮
`pass` 只表示首轮运行通过，不等于三项已接入；三项接入仍须逐项保留/弃用并回写。
`blocked` 不得改写成 `pass`。

旧 runner 可复用沙箱闸门、重试和报表结构；但其默认 `OCTOP_REPO=/opt/Octop`、父进程
`OCTOP_HOME` 为生产目录且分析阶段依赖生产管理 JWT/服务，因此在完成根目录与运行时隔离
前，不应宣称已“原样复用”验证 `develop`。必要时由服务端安排独立 `uv run pytest` 入口，
再接回现有报告流程。

## 运行流程

0. **git 同步（ExecStartPre，先于一切）** —— `git fetch origin`，工作树干净就
   `merge --ff-only` 快进到 upstream；脏树 / 分头 / fetch 失败一律跳过，
   原树直接进测试。见下节「测试前的 git 同步」。
1. **预检** —— 服务可达、仓库与 venv 就位、pytest 可导入。
2. **跑测试（脚本自己跑，不经 LLM）** —— 在仓库根目录执行
   `python -m pytest -m "not live" -q`，后台运行 + 轮询，落完整日志与退出码。
   - **测试跑在独立的沙箱数据目录里**（`TEST_ISOLATED_HOME`，默认
     `/opt/octop-data-test-home`）—— 见下节「测试沙箱」，这是硬要求；
   - 跑完了但有失败用例 → 这是**结论**，不重试，直接进分析；
   - 跑不起来（解释器缺失、依赖缺失、收集阶段崩溃、进程被杀、**日志被删**）→
     **不可跳过的异常**，重试，累计 3 次仍失败就终止。
3. **L4 评测（夜间集合）** —— 按 [eval/README.md](./eval/README.md) §5 跑需求
   条目级的任务集，逐条判定 pass / fail / 跳过 / 受阻，结论并进同一份报告。
   失败让本轮结论为 fail；评测自身异常不推翻 pytest 的结论。见下节。
4. **子代理分析** —— 一个 Octop 子代理（`task_type=agent`，模型
   `newapi/qiniu/conatus-free`）用 shell 读日志，产出 Markdown 分析报告：
   失败用例清单、按根因归类、真回归 vs 偶发、严重度排序与下一步建议。
   分析失败按 3 次重试（退避 60s / 120s）。
5. **模型容灾（429）** —— 主模型连续 3 次仍撞 429 限流时，自动切到备用模型
   （默认 `newapi/MiniMax-M3.1-Flash-Preview`）重跑分析；见下节。
6. **出报告** —— 落到 `/opt/octop-data/test-reports/`：
   - `pytest-<时间戳>.log` —— 完整测试输出
   - `eval-<时间戳>.json` / `eval-<时间戳>.md` —— L4 评测逐条结论与证据
   - `report-<时间戳>.json` / `report-<时间戳>.md` —— 测试结论 + L4 评测 + 子代理分析 + 容灾记录

退出码：`0` = 全过；`1` = 有失败用例或 L4 评测失败（报告里仍有分析）；
`2` = 不可跳过的异常（重试 3 次后终止）。

## L4 评测（夜间集合）

[eval/README.md](./eval/README.md) §5 规定：夜间集合 = 全量任务（含 `live` 与
L4 任务），「没有配置就不能宣称已跑夜间」。本机（后端生产机）的夜间配置是：

| 项 | 值 |
|---|---|
| 执行器 | `scripts/run_eval_nightly.py`（也可单独当 CLI 用：`--dry-run` / `--domain` / `--task`） |
| 任务集来源 | `docs/eval/tasks/*.yaml`（可执行位置）+ `docs/eval/examples/*.yaml`（样板与首批任务集） |
| 沙箱 | 与 pytest 同一套 `TEST_ISOLATED_HOME`，绝不含生产 `OCTOP_HOME` |
| 逐条证据 | `eval-logs-<时间戳>/<任务 id>.log` |
| 明细报告 | `eval-<时间戳>.json` / `.md`；并进 `report-<时间戳>.md` 的「L4 评测（夜间集合）」小节 |

### 判定规则（照抄规范 §4，不另立口径）

- 退出码非 0 → **fail**；
- **零匹配不算通过**：命令退出码 0 但没收集到目标用例（pytest 的 `no tests ran`、
  vitest 的 `No test found`、go 的 `no tests to run` 等）→ **fail**；
- `status: planned`（口径已定·实现待做）、`deprecated` → 跳过，记原因；
- `judge.kind` 不是 `test`（人工 / 视觉 / rubric / 阈值）→ 跳过，记「需人工走查并留证据」；
- `live: true` → 默认不跑（配额口径见 backlog B-004，未获授权不跑）。

跳过与受阻都**记原因**，不算通过；未运行不写 pass。

### 后端机不跑什么（边界闸门）

评测任务若落在下列范围，在本机**不执行**，记 `blocked` + 原因：

| 任务范围 | 依据 |
|---|---|
| 前端命令（`dashboard/`、npm/npx/vite） | [deployment-boundary.md](./deployment-boundary.md) §1 NEVER 行、§2 决策表；`CLAUDE.md` §Commands |
| 桌面命令（`desktop/`、go 工具链） | 桌面客户端是独立交付单元，在 Windows 出包机上构建验证（[desktop-windows-build.md](./desktop-windows-build.md)）；`CLAUDE.md`「desktop/」条、`AGENTS.md` §1 本地验证表 |

即：**夜间集合里能真正产出结论的是后端任务**（PLB、PVQ-005、PVQ-008 等）；
前端与桌面任务在本机永远记受阻，需要在前端 / 桌面环境执行。

### 相关环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `EVAL_TASKSETS` | `docs/eval/tasks,docs/eval/examples` | 任务集目录（相对仓库根） |
| `EVAL_TIMEOUT` | `900` | 单条任务超时（秒） |
| `EVAL_PYTHON` | 执行器自己的解释器 | 命令里 `python` / `uv run pytest` 解析成的解释器 |
| `EVAL_RUN_LIVE` | `0` | 设 `1` 才跑 `live: true` 任务（需先有配额口径） |
| `EVAL_ALLOW_NPM` | `0` | 设 `1` 才允许在本机跑前端命令（仅前端环境用） |
| `EVAL_ALLOW_DESKTOP` | `0` | 设 `1` 才允许在本机跑桌面命令（仅桌面环境用） |

## 测试前的 git 同步

02:00 的全量测试测的应该是**外部最新代码**，不是 ocdev 工作区里昨天留下的
状态。测试服务在跑 pytest 之前先过一道 git 同步
（`ExecStartPre=/opt/Octop/scripts/git_sync_for_test.sh`，drop-in
`30-git-sync.conf`，排在沙箱闸门之后）：

1. `git fetch origin --prune`（只读，超时 300s）；
2. 工作树干净 → `merge --ff-only` 快进到 upstream（只快进：不造合并提交、
   不 rebase、不 checkout）；
3. 工作树脏 / 本地与 origin 分头 / 无 upstream / fetch 失败 / 等锁超时 →
   **跳过同步，原树直接进测试**——测到本地状态也比不测强。

政策是「同步尽力而为，绝不弄丢本地工作」：脚本永远 exit 0（ExecStartPre
非零会取消整个测试），任何情况下不 discard、不 stash、不 checkout、不 push。
结论写两处：stdout（进 `backend-full-test.log`）和
`/opt/octop-test-reports/git-sync-latest.json`（另有按时间戳的存档）。status
取值：`updated` / `up-to-date` / `local-ahead` / `dirty` / `diverged` /
`no-upstream` / `fetch-failed` / `detached` / `locked` / `no-repo`。

与 01:15 `octop-git-sync` / 01:40 `cnb-git-sync-all` 的分工：那两个做
origin → cnb 的**推送镜像**，不动工作树；本脚本做 origin → 工作树的**快进
更新**，并用 flock 串行化（等锁最多 10 分钟）。

两点边界：

- **只更新工作树，不重启服务。** 线上 `octop.service` 仍运行拉取前加载的
  代码；驱动 `127.0.0.1:8088` 的 API 集成测试测的是运行中的实例。要让 API
  测试也覆盖新代码需在同步后重启服务——目前刻意不做（凌晨自动重启生产服务
  风险大于收益），如要加，单独评审。
- **分支策略：测当前 check out 的分支**，不自动切分支。分支不是 develop/main
  时如实记录在状态 JSON 的 `branch` 字段里，人工判断。

## 测试沙箱（硬要求）

全量测试**绝对不能**跑在生产 `OCTOP_HOME`（`/opt/octop-data`）上。

原因：测试里有 `octop clean --all`（`tests/unit/cli/test_clean_cmd.py`）和
`octop init --force` 这类**会删数据**的用例。`PathLayout.from_env()` 优先读环境变量
`OCTOP_HOME`，所以只要环境里带着生产的 `OCTOP_HOME`，这些用例就会把线上
DB、config、agent 工作区连同**正在写的 pytest 日志**一起删掉。

2026-11-22 凌晨 02:30 那次就是这么炸的：`test_clean_all_requires_confirmation`
在 03:17 把 `/opt/octop-data` 整个清空 → 线上 DB 只剩测试造的 `alice` 账号、
pytest 日志消失 → 脚本拿到「退出码 1、无汇总行」，子代理打开日志发现文件不存在，
交了一份「无法分析」的报告。结论和证据全是假的。

现在有四道防线：

| 防线 | 位置 | 作用 |
|---|---|---|
| 沙箱目录 | `scripts/run_backend_full_test.py`（`pytest_env()`） | pytest 子进程的 `OCTOP_HOME` / `HOME` 指向 `TEST_ISOLATED_HOME`，与生产目录无关 |
| 环境隔离 | `tests/conftest.py`（`_isolated_octop_home`） | 每个测试都把环境里的 `OCTOP_HOME` 清掉，根目录只能解析到隔离过的 `HOME`；手跑 pytest 也不会误伤线上 |
| 证据校验 | `scripts/run_backend_full_test.py`（`classify_run()` / `analysis_saw_no_log()`） | 日志消失或为空 → 判为**异常**重试；子代理说「日志不存在」→ 判为**分析无效**重试 |
| systemd 闸门 | `…/octop-backend-full-test.service.d/20-sandbox.conf` + `ExecStartPre=/usr/local/sbin/octop-full-test-sandbox-guard.sh` | 脚本里的沙箱化一旦被回退，直接拒绝启动（响亮失败），而不是让 `octop clean --all` 去删生产数据 |

> 沙箱目录默认放在生产目录**外面**（`/opt/octop-data-test-home`），避免清理测试
> 波及 `/opt/octop-data`。每次跑之前脚本会把这个沙箱清空重来。

### 父进程的 `OCTOP_HOME` 必须是生产目录

沙箱**只作用在 pytest 子进程**上。父进程的 `OCTOP_HOME` 必须是 `/opt/octop-data`
（生产），原因有二：

- `mint_admin_token()` 从 `OCTOP_HOME` 的库里读 `secrets.jwt` 与 `admin` 用户来签
  token，线上服务只认这个 secret；
- 分析阶段的 agent 工作区是 `Path(OCTOP_HOME)/"agents"/<agent_id>`，而线上服务
  写在 `/opt/octop-data/agents`。

把父进程也指到沙箱，脚本会死在第一步——「不可跳过的异常：本地 DB 里没有 jwt
secret，无法签发 token」——因为沙箱每次跑测试前都会被清空重建，永远不会有 secret。

## 模型容灾（429 切换）

分析步骤的模型链：**主模型 → 备用模型**。

| 情况 | 行为 |
|---|---|
| 主模型分析失败，但不是 429 | 重试 3 次（退避 60s / 120s），仍失败即终止，**不换模型**（换模型也救不了） |
| 主模型连续 3 次都是 429 | 切到备用模型，备用模型上再重试 3 次 |
| 备用模型也失败 | 终止，出 error 报告 |

切换的实现方式是改写分析 cron job 的 `model` 字段
（`PATCH /api/agents/{agent_id}/cron/{cron_id}`），跑完后再恢复成主模型，
避免污染下一次手动执行。

**429 判定**看错误文本里有没有 `RateLimitError` / `rate_limit` / `too many requests` /
`error code: 429` / `free_campaign_global_limit` 这些标记。

**"是哪个模型 429"** 有两处来源，都写进脚本日志与报告：

1. 脚本自己知道这一轮用的是哪个模型（主模型还是备用）；
2. 服务端日志（`TEST_SERVER_LOG`）里该模型最近的 429 证据行 —— 脚本只读本次
   尝试**之后**新增的日志（按字节偏移），不会把上次运行的旧 429 算进来。

日志里长这样：

```
[2026-11-22 02:41:03] 分析第 1/3 次失败（模型 newapi/qiniu/conatus-free）：子代理执行失败：... RateLimitError: Error code: 429 ...
[2026-11-22 02:41:03] 分析第 1/3 次失败（模型 newapi/qiniu/conatus-free）：... —— 命中 429 限流，证据：... chat model 'newapi/qiniu/conatus-free' failed ... Error code: 429
[2026-11-22 02:44:05] ⚠ 命中 429 的模型：newapi/qiniu/conatus-free（连续 3 次） → 切换到备用模型 newapi/MiniMax-M3.1-Flash-Preview
[2026-11-22 02:44:06] cron job 的分析模型已切换为 newapi/MiniMax-M3.1-Flash-Preview
```

报告（`report-<时间戳>.md`）里的「模型容灾」小节会列出每一次尝试的模型、结果、
是否 429，以及 429 证据行。

## 模型引用写法

Octop 的模型引用是 `<provider>/<model_id>`，按**第一个**斜杠切分。网关上的模型 id
本身带斜杠（`qiniu/conatus-free`），所以正确写法是：

```
newapi/qiniu/conatus-free      # provider=newapi, model_id=qiniu/conatus-free
```

写成 `qiniu/conatus-free` 会被解析成 provider `qiniu`，报
`Unknown provider 'qiniu' in model ref`。

模型还必须登记进该 provider 的 `models_json`（harness 只暴露登记过的模型），
脚本每次运行都会检查并自动补登记。

## 常用操作

```bash
# 立刻手动跑一次（默认全量）
scripts/run_backend_full_test.py

# 只做预检与准备（不跑测试）
scripts/run_backend_full_test.py --setup-only

# 用小子集试跑整条链路
TEST_PYTEST_ARGS='-q tests/unit/i18n' scripts/run_backend_full_test.py

# 改次数 / 超时
scripts/run_backend_full_test.py --attempts 5 --timeout 7200

# 定时器
systemctl list-timers octop-backend-full-test.timer
systemctl start octop-backend-full-test.service      # 立刻手动触发一次
journalctl -u octop-backend-full-test.service -n 100  # 或看日志文件
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `OCTOP_HOME` | `/opt/octop-data` | Octop 数据目录（DB、agent 工作区） |
| `OCTOP_BASE_URL` | `http://127.0.0.1:8088/videogen` | 后端 API 根 |
| `OCTOP_REPO` | `/opt/Octop` | 被测仓库 |
| `TEST_MODEL` | `qiniu/conatus-free` | 网关侧模型 id（主） |
| `TEST_MODEL_REF` | `newapi/qiniu/conatus-free` | Octop 侧模型引用（主） |
| `TEST_FALLBACK_MODEL` | `MiniMax-M3.1-Flash-Preview` | 备用模型 id；留空即关闭容灾 |
| `TEST_FALLBACK_MODEL_REF` | `newapi/MiniMax-M3.1-Flash-Preview` | 备用模型引用 |
| `TEST_SERVER_LOG` | `/opt/octop-data/logs/octop.log` | 服务端日志（找 429 证据行） |
| `TEST_ISOLATED_HOME` | `/opt/octop-data-test-home` | **测试沙箱数据目录**（pytest 的 `OCTOP_HOME` / `HOME`），必须与生产目录无关 |
| `TEST_MAX_ATTEMPTS` | `3` | 不可跳过异常时的最大尝试次数（也用于分析重试与每个模型的尝试次数） |
| `TEST_TIMEOUT` | `5400` | 单次测试超时（秒） |
| `TEST_ANALYSIS_TIMEOUT` | `1800` | 子代理分析超时（秒） |
| `TEST_TOKEN_TTL` | `86400` | 脚本自签的 admin token 有效期（秒）；要覆盖 pytest + 分析重试的总时长 |
| `TEST_PYTEST_ARGS` | `-m "not live" -q` | pytest 参数 |
| `TEST_PYTHON` | `/opt/Octop/.venv/bin/python` | 解释器 |

## 注意事项

- **脚本直接用 venv 解释器**（`/opt/Octop/.venv/bin/python`），不依赖运行时联网同步依赖。
  内网 PyPI 源 `192.168.20.173:4874` 已下线，包源已切到腾讯云公网镜像
  （`pyproject.toml` 的 `[tool.uv] index-url` + `uv.lock`），`uv run` 现在也能用，
  但定时任务不碰网络更稳。
- **免费模型会限流** —— `qiniu/conatus-free` 有全局请求上限，429 时分析步骤会退避
  重试（60s / 120s）；连续 3 次仍是 429 就切到备用模型
  （`MiniMax-M3.1-Flash-Preview`，与 `~/.claude/settings.json` 里 Claude Code 用的
  是同一个网关 `aikey4k.mengxa.com`，但这里走的是 Octop 的 provider 通道）。
  备用模型也必须登记进 provider 的 `models_json`，脚本每次运行都会自动补登记。
- **测试跑在生产机上**，与线上服务并行。pytest 是串行执行（没用 `-n auto`），
  内存压力可控；但会短时吃 CPU。**数据目录是隔离的**（`TEST_ISOLATED_HOME`），
  线上 `/opt/octop-data` 不受测试影响。
- **agent 产物在 `/opt/octop-data/agents/<agent_id>/`** —— 分析报告、pytest pid
  文件都在那里。
- cron job 只是子代理的**执行载体**（`enabled=false`），时间控制归 systemd 定时器，
  两边不会重复触发。
