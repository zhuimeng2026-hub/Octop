# 后端夜间全量测试与修复工作流

> 状态：活文档（规范性）
> 最新核实日期：2026-11-24
> 适用范围：Octop 服务端 Python；唯一计划时点为每天 02:10（Asia/Shanghai）。

本文是夜间智能体执行后端全量测试、归因和最小修复的唯一运行手册。旧的脚本说明、工具日志、PR 文本和历史报告都是输入证据，不能替代本文的边界、判定或验收口径。产品验收仍以 [PRD §6](./PRD.md#6-非功能需求) 为准；旧分支上的三项运维/生产验收不与本修复工作流混为一谈。

## 1. 目标、边界与现状

夜间任务 MUST 在独立测试 checkout/worktree 中，以 `cnb/develop` 在该夜间开始时的实际完整 SHA 为基线，执行：

```bash
uv run --locked --no-sync pytest -m 'not live' -q
```

任务 MUST 只覆盖服务端 Python。它 MUST NOT 构建 `dashboard/`、运行 Go/桌面构建、调用真实外部服务或微信、发布生产、部署服务、修改生产 checkout/数据/服务设置。

当前已核实服务器只有 `octop-backend-full-test.timer`，每天 02:10（Asia/Shanghai）触发；旧服务曾使用 `User=root`、`WorkingDirectory=/opt/Octop`、`TEST_TARGET_BRANCH=fix/full-test-12-failures`，并配置了会尝试在生产 checkout 切分支或快进的旧 pre-hook。这里记录的是配置/路径事实，不声称某一轮实际完成了生产 checkout 改动。该现状**不表示本手册已经接入**：首次接入 MUST 由用户在服务器上调整既有任务及运行账号；不得另开调度，也不得假设旧进程已测 `develop`。旧进程的输出不能证明本文工作流已执行。

本手册不要求新服务器。已知机上有 `uv` 与 Claude CLI，但这不表示指定模型已获授权或已配置；worker MAY 使用已有可审计工具，也 MAY 使用其他获授权执行器，不能把 CLI 或模型授权写成前置事实。

## 2. 接入前由用户提供的最小输入

用户 MUST 在首次接入前明确并提供以下信息；缺一项就记录 `blocked`，不猜测：

| 输入 | 最低要求 |
|---|---|
| 独立账号与目录 | 非 root 运行账号；测试 checkout/worktree、报告目录、临时目录、HOME、`OCTOP_HOME`、数据库和 pytest 临时目录均独立于生产 |
| repo 源 | 可只读拉取 `cnb/develop` 的源地址、认证方式和实际可见的 ref |
| 权限 | 账号可读仓库和 lockfile，可写自己的测试/报告目录；不得写生产 checkout、生产数据或生产服务配置 |
| 既有入口 | 现有 `octop-backend-full-test.timer`/service 的管理员入口；只调整这一条既有计划 |
| 接入授权 | 明确允许调整既有任务、允许在候选分支产生本地 diff；未授权提交、推送、建远程 PR、合并、删分支均不得做 |

用户 MUST NOT 为本文新建第二条定时器；同一 `run_id`/同一夜间任务 MUST 互斥，不得并行启动第二个全量。建议最迟在 07:30（Asia/Shanghai，或用户配置的截止窗口）停止启动新的全量验证并保留现场；这是可调整的运行建议，不是无条件中止正在运行的进程。若剩余窗口不足以完成下一轮，worker MUST 停止发起新验证并报告 `blocked` 或未完成，不压缩步骤换取绿色。

## 3. 不变量与证据规则

- 每次运行 MUST 生成唯一 `run_id`（建议 UTC 时间加随机后缀）。目录、日志、报告、JUnit、diff 和快照均带该 id；不得从共享 `latest` 文件推断本轮结果。
- 测试 checkout/worktree MUST 独立于生产 `/opt/Octop`；HOME、`OCTOP_HOME`、SQLite/PostgreSQL 测试库、pytest `tmp_path`、缓存和报告目录 MUST 独立。生产服务、生产数据和生产进程只能读（如确有需要且已授权），不能被测试环境继承或写入。
- 依赖 MUST 由 `uv sync --locked` 准备；实际测试 MUST 使用 `uv run --locked --no-sync`。运行环境、`uv.lock`、Python、权限和路径快照 MUST 写入报告。
- 任何结论 MUST 绑定：基线完整 SHA、候选完整 SHA（如有）、pytest 根目录、隔离目录、精确命令、退出码、收集数/结果摘要、完整受限日志路径和产物 SHA256。
- 工具日志、模型分析、旧报告或 PR 文本只能作为线索；偶发的同一日志不得冒称已修复。失败证据 MUST 先保存，再分析和编辑。
- pytest 会自动从 `tests/` 收集；报告 MUST 记录既有条件跳过及其原因，并与新增的 `skip`/`xfail` 区分。worker MUST NOT 为清绿新增或放宽 `skip`、`xfail`、超时或删测试。

## 4. 工作流（step → verify）

### 4.1 预检与基线计划

1. 生成 `run_id`，建立本轮唯一目录，记录 repo 源、目标 `cnb/develop`、当前时间和 07:30 停止建议。
2. 在只读范围核对 repo/worktree、路径边界、生产目录不可写、账号、磁盘/内存、Python/`uv`、网络和权限；保存 `git status --short`、`git rev-parse`、`git worktree list`、环境白名单快照和依赖锁文件信息。
3. 从 `cnb/develop` 获取**本轮真实完整 SHA**，固定为 `baseline_sha`。历史首次 `89d6fbe8` 只可作为回归说明或例外背景，不能成为每晚固定 SHA。
4. 使用独立 checkout/worktree 检查该 SHA；若 ref、权限、路径隔离、依赖或数据库不满足，停止并写 `blocked`。

**验证：**报告有唯一 `run_id`、完整 `baseline_sha`、路径/权限快照、干净程度、计划目标和 `uv sync --locked` 结果；未把旧生产 checkout 当基线。旧手册中的 `git rev-parse HEAD` 与 `pytest.exit`/完整日志/`printf` 证据命令仍应保留并绑定本轮目录，不能用共享 `latest` 替代。

### 4.2 基线全量

在固定的 baseline checkout 执行完整命令，保存完整但受限的 stdout/stderr、退出码、收集数、通过/失败/跳过/xfail 摘要，JUnit 为可选产物但必须记录路径。不能运行、收集阶段崩溃、被杀、日志丢失或隔离证据缺失是 `blocked`/异常，不是测试失败；有真实失败用例则是 `fail`。

**验证：**基线报告绑定 `baseline_sha` 与 pytest 根目录。基线全绿就保留 `pass`，不创建修复分支；仍需记录条件跳过、未覆盖项和 CI 适用性。

### 4.3 失败归因与受限修复

worker MUST 先按 pytest nodeid 和失败原因归组，再决定是否可动代码。默认可编辑范围是 `src/octop/**` 与对应的现有 `tests/**`，以及必要的新回归测试文件；必须遵守代码归属和运行库边界。配置、数据库迁移、测试阈值、CI、前端和已发布行为契约 MUST 留待人工；其中独立且明确可修的后端代码项仍可照常处理。只有在同一基线、同一隔离条件下能对同一小范围 deterministic defect 定向复现，才可直接修改；修改 MUST 最小化，并添加必要的回归用例。保存失败日志和环境快照后，才允许编辑；每个修改点先做单文件定向复验。

以下情况 MUST 记录为 `blocked` 或“待人研判”，不得盲改：环境/依赖/偶发失败；真实凭据或外部调用；规格不明确；数据库迁移、权限边界、运行库归属（应转对应 runtime library）；需要扩大代码范围；无法稳定复现。一次全量失败应收集多条失败并统一归组；定向复验汇总后只做一次最终全量，默认不得连续整仓重跑。

**验证：**归因表逐项列 nodeid、证据路径、分类、复现命令、修改文件和定向结果；未复现或边界不明的项没有被标成修复成功。

### 4.4 候选快照与最终全量

仅从已记录的 baseline 创建专用候选分支，例如 `codex/nightly-backend-<run_id>`，并使用独立工作树。候选初始状态和 diff MUST 在最终全量前保存。候选必须在同一数据隔离和依赖条件下执行一轮完整全量。

若未获提交授权，worker MUST 留可审 Git diff/二进制 patch，不提交、不推送、不建远程 PR；新增文件 MUST 被纳入 patch（例如在候选树使用 `git add -N -- <new-file>` 后生成 `git diff --binary HEAD`，或生成等价包含新增文件的补丁）。报告 MUST 保存精确 baseline SHA、候选版本、patch SHA256、全量前后快照及其路径。若获明确授权，也只能提交到自己的候选分支，最终合并仍由人完成。

最终全量后任何文件变更都会使结果失效，必须重新验证。若夜间 `cnb/develop` 已前进，报告状态写 `blocked`，原因写明“基线已过时，需 integrate/revalidate”；不得用旧 SHA 的报告宣称新提交通过。剩余窗口允许重取新基线并重新走本流程，但不得盲目合并。

**验证：**最终报告有候选分支/工作树、前后 SHA、完整 diff/patch（含新增文件）及 SHA256；最终全量退出码和收集摘要与该候选快照一致。

### 4.5 报告与晨间交接

服务器约定报告目录下，每个 `run_id` MUST 有 Markdown 结果卡、命令/工具证据、失败/归因、定向复验、候选 diff/分支信息和未完成项。报告 MUST 说明 CI 是否覆盖，晨间审核只确认 SHA、diff、证据和合并授权。终态定义如下；未运行不得写 `pass`：

| 状态 | 终态判定 |
|---|---|
| `pass` | 基线全量无真实失败，退出码为 0；无候选修复。 |
| `修复待审` | 候选 diff/commit 非空；最终全量在同一候选上退出码为 0；证据完整；基线未前进且仍有效。该状态只表示可供人审核，不表示已合并或已部署。 |
| `fail` | 测试已完成但仍有真实失败，包括部分修复后仍剩余真实失败；报告必须列出失败和归因。 |
| `blocked` | 缺少或无效证据、环境/依赖/权限异常、规格或边界未决，或 `cnb/develop` 已前进导致基线过时；必须附具体原因，并写明需 integrate/revalidate，不得用旧报告宣称新提交通过。 |

候选非空但最终全量未在同一候选上退出 0，必须是 `fail` 或 `blocked`（按原因判定），不得写 `修复待审`。

无人时 MUST NOT 写主干、部署、删分支或改生产服务设置；不得默认发消息、创建远程 PR 或推送。若另获集成权限，也只推候选分支供审核，既有 CI 检查仍生效。

## 5. 可直接交给 02:10 智能体的指令模板

```text
你负责 Octop 后端夜间全量测试与最小修复。只执行 docs/backend-nightly-repair.md，不能用旧脚本/PR 文本替代它。

时间：每天 02:10 Asia/Shanghai；同一任务互斥。先生成唯一 run_id，并从 cnb/develop 读取本轮真实完整 SHA 作为 baseline；不要固定使用历史 89d6fbe8。
范围：仅服务端 Python；执行 uv sync --locked，然后在独立 checkout/worktree、独立非 root 账号、HOME/OCTOP_HOME/数据库/pytest tmp 下运行 uv run --locked --no-sync pytest -m 'not live' -q。不要构建 dashboard/Go，不做真实外部调用、微信、发布、部署或生产写入。
先做 preflight 并保存路径、权限、依赖和 git 快照。基线失败先保存完整受限日志，再按 nodeid 归因；仅同一基线可稳定定向复现的小范围 deterministic defect 可最小修改并写回归测试。环境/偶发/凭据/规格不明/迁移/权限/运行库归属/扩大范围一律 blocked 或待人研判。不要 skip、xfail、删测试或盲改超时。
从记录的 baseline 建候选分支 codex/nightly-backend-<run_id> 与独立工作树，保存最终全量前快照；无提交授权就生成包含新增文件的可审 diff/binary patch 和 patch SHA256，不提交/推送/建 PR。候选在同一隔离条件跑一次最终全量；最终全量后任何文件变更都使结果失效。若 develop 前进，状态写 `blocked` 并说明需 integrate/revalidate。
所有日志/报告/patch 进入带 run_id 的唯一目录，不从 latest 推断。报告必须包含 baseline/candidate 完整 SHA、pytest 根目录、隔离路径、命令、退出码、收集数、跳过原因（既有条件跳过与新增跳过分开）、证据路径、SHA256、状态和未完成项。截止窗口后不再启动新的验证并留现场，不无条件中止已经运行的进程。无人时不改主干/生产设置、不删分支、不默认对外发消息。
```

### 5.1 晨间结果卡模板

每次运行 MUST 复制以下模板到带 `run_id` 的报告目录并填写，不得以空字段冒充证据：

```markdown
# 后端夜间结果卡 — <run_id>

- 状态：`pass` / `修复待审` / `fail` / `blocked`
- 运行时间（Asia/Shanghai）：<start> — <end>
- 报告目录：<absolute path>
- 结论：<一句话；若 blocked，写明具体原因与 integrate/revalidate 动作>

## 目标与基线

- 目标：`cnb/develop`
- 读取时间：<timestamp>
- 实际 baseline branch/ref：<ref>
- 实际 baseline SHA（完整）：`<sha>`
- 基线是否仍有效：是 / 否（原因：<...>）
- 测试 checkout/worktree：<absolute path>
- 隔离 HOME / OCTOP_HOME / DB / pytest tmp：<paths>

## 候选

- 候选分支或工作树：<branch/path or none>
- candidate commit（完整 SHA）或 patch：<sha/path>
- patch SHA256：`<sha256>`
- 最终全量前快照：<path>
- 最终全量后快照：<path>
- 全量后是否还有文件变更：是 / 否

## 测试与证据

- 依赖命令及结果：`uv sync --locked` — <result/path>
- 基线命令：`uv run --locked --no-sync pytest -m 'not live' -q`
- 基线退出码：`<rc>`；日志：<path>；收集/通过/失败/跳过/xfail：<summary>
- 定向复验：<commands, rc, logs>
- 最终全量退出码：`<rc or n/a>`；日志：<path>；收集/通过/失败/跳过/xfail：<summary>
- 既有条件跳过及原因：<list or none>
- 新增 skip/xfail：<list or none；不得为清绿新增>
- 证据文件 SHA256：<paths and hashes>

## 失败归因与未完成项

| nodeid/项 | 分类 | 证据 | 定向结果 | 状态/后续 |
|---|---|---|---|---|
| <...> | deterministic / 环境 / 偶发 / 规格 / 边界 | <path> | <result> | <...> |

- 未完成项：<list or none>
- CI 覆盖/缺口：<summary>

## 可审核判据

- [ ] 结论与终态表一致
- [ ] baseline/candidate SHA、pytest 根目录和隔离路径完整
- [ ] 候选（如有）非空且 patch/diff 含新增文件并有 SHA256
- [ ] 基线与最终退出码、完整日志和收集摘要可复核
- [ ] `修复待审`：同一候选最终退出码为 0，证据完整，基线未前进且仍有效
- [ ] 晨间需人确认：diff、证据、合并授权；未自动合并/部署
```

## 6. 既有手册与产品验收的关系

旧手册 [backend-full-test.md](./backend-full-test.md) 保留历史脚本、沙箱和证据背景；其旧的生产 `OCTOP_HOME`、JWT/模型分析及 pre-hook 假设不得作为本文新工作流的实现方案。该文档的 02:10 段只负责链接到本手册；本文是夜间修复的执行口径。

生产三项运维/生产验收、正式 `main` `v*` tag、健康检查、微信链路和发布安全检查仍按 [PRD §6](./PRD.md#6-非功能需求) 判定，不因夜间候选通过而自动通过。
