# 工程待办登记（Backlog）

> 状态：**活文档**（最近核实 2026-11-28）
> 文档类型：**规范性文档** —— 规定「工程待办」的登记格式与落点规则。
> 适用范围：**不属于任何单一需求、但需要实施**的工作（规范建设、工具、评测体系、跨模块改造）。
> 不适用范围：需求条目自身的实现 → 见该需求文档的「实现状态」；需要人工/特定环境的 → 见 [todo.md](./todo.md)；未决的决策 → 见 [PRD.md §8 开放问题](./PRD.md)。
> 单一权威：每条待办的**行为语义**写在它引用的权威文档里，本文件只写**执行规格**（范围、步骤、验收、停止条件），不复述口径。
> 落点规则见 [docs/README.md §文档维护规范](./README.md)。

---

## 1. 为什么要单独一份

三类待办的执行方式完全不同，混在一份清单里会互相拖累：

| 待办类型 | 执行者 | 落点 |
|---|---|---|
| 需要人 / 特定环境（扫码、真机、真实账号） | 人 | [todo.md](./todo.md) |
| **口径已定、代码未实施**（属于某条需求） | 智能体 | 该需求文档的「实现状态」+ eval 任务 `status: planned` |
| **工程待办**（不属于任何单一需求） | 智能体 | **本文件** |

本文件存在的意义：让「可以安排在凌晨由智能体自行开发」的活儿有**一份可被无人值守执行的规格**——凌晨的智能体不需要问人，它按条目里的白名单、步骤、验收命令和停止条件做即可。

---

## 2. 优先级语义

| 级别 | 含义 | 执行安排 |
|---|---|---|
| **P0** | 紧急，阻塞其它工作或线上问题 | 立即，白天做 |
| **P1** | **重要不紧急** | **适合夜间无人值守批次**；白天不插队 |
| **P2** | 常规改进 | 有余力再做 |

**P1 条目的硬性要求**（否则不许进本文件）：条目必须写全 §3 的所有字段，使一个**没有上下文、没有追问机会**的智能体也能独立完成；凡是需要人拍板的分歧，必须在条目里已经收口成唯一动作。

---

## 3. 条目格式（必填字段）

```markdown
## B-0NN · <标题>

**状态**：待实施 | 进行中 | 已完成 | 已阻塞        （登记日期：YYYY-MM-DD）
**优先级**：P0 紧急 | P1 重要不紧急 | P2 常规
**语义来源**：<权威文档 + 章节>            ← 行为口径只在这里定义
**可无人值守执行**：是 / 否               ← 「是」时必须写全停止条件

**背景**：为什么现在做（两三句，含不做的后果）
**范围**：允许修改的文件（白名单，逐条列全）
**不在范围**：明确禁止顺手做的事（防跑偏）
**前置条件**：依赖、需要的凭据/环境、必须先读的文件
**步骤**：有序、每步可机械判定
**验收命令**：可直接粘贴执行的命令 + 通过标准
**停止条件**：遇到什么情况必须停下并报告，而不是硬扛或扩大范围
**完成后回写**：哪些文档的状态/记录需要同步更新（逐条列）
```

---

## 4. 登记条目

### B-001 · 停用素材的整单失败口径落地（第 25 条实现）

**状态**：进行中（登记日期：2026-11-24；后端已实现 2026-11-24，commit `5a3ccce5`）
**优先级**：P1 重要不紧急（适合夜间无人值守）
**跟踪**：CNB issue [#24](https://cnb.cool/mengxa.com/-/repos/Octop/-/issues/24)
**语义来源**：[product-video-multi-category-materials.md A8.1](./product-video-multi-category-materials.md) —— **行为契约只以 A8.1 为准，本条目不得另立口径**
**可无人值守执行**：是

**剩余工作**：后端部分（错误码、409、`details.assets`、不写库、文案、OpenAPI 描述、
后端用例）已随 `5a3ccce5` 落地；**前端「显示具体提示而非通用失败」的回归用例尚未补**
（`dashboard/src/pages/ProductVideoWizard/index.test.tsx` 目前只断言通用的
`videoWizard.generateFailed`），步骤 7 的前端半条仍未完成。

**背景**：验收条目 A7.3 第 25 条已定口径「整单失败并提示」，但 `snapshot_project()` 仍静默跳过 `active = 0` 的素材，该条目前不通过。不做的后果是：用户以为素材已入选，快照里却没有，规格与实现长期背离。

**范围**（白名单，越界即停）：
- `src/octop/infra/errors.py`
- `src/octop/infra/product_library/service.py`
- `src/octop/api/routers/product_library.py`
- `src/octop/i18n/en.json`、`src/octop/i18n/zh.json`
- `dashboard/src/locales/en.json`、`dashboard/src/locales/zh.json`
- `dashboard/src/pages/ProductVideoWizard/index.tsx`
- `tests/unit/db/test_product_library_repo.py`、`tests/unit/api/test_product_library.py`
- `dashboard/src/pages/ProductVideoWizard/index.test.tsx`
- 回写：`docs/product-video-multi-category-materials.md`（需求复核记录）、`docs/eval/examples/product-video-multi-category.yaml`（PVQ-008）、本条目（状态/commit）

**不在范围**：不改 `ProductResponse` / 快照结构（不做「部分成功」）；不改归属校验语义（他人素材仍 404）；不新增 API；不碰迁移、插件、桌面端其它模块；不顺手重构 `service.py`。

**前置条件**：先读 A8.1 全文；读 `AGENTS.md` §7（i18n / 时区 / 迁移）与 §12（DoR / DoD）；确认工作区干净（`git status`）。

**步骤**：
1. 在 `ErrorCode` 增加 `PRODUCT_LIBRARY_ASSET_INACTIVE`，默认 HTTP 状态 **409**。
2. `snapshot_project()`：归属校验通过后，若所选素材存在 `active = 0`，抛该错误并**不写入项目**；归属校验失败仍返回 `None` → `NOT_FOUND`。
3. 后端文案：两个 i18n bundle 的 `errors.PRODUCT_LIBRARY_ASSET_INACTIVE`，占位符 `{assets}`。
4. 前端文案：两个 dashboard locale 的 `apiErrors.PRODUCT_LIBRARY_ASSET_INACTIVE`，占位符 `{{assets}}`（**双花括号**，与后端不同）。
5. 路由 `POST /product-library/projects` 的 OpenAPI `description` 写明 409 触发条件。
6. 向导在创建项目被拒时显示该错误（含被停用文件名），不得只显示通用失败文案；**其它错误的现有表现不得改变**。
7. 补后端用例（停用素材 → 抛错、状态码 409、`details.assets`、无半成品项目残留）与前端用例（显示具体提示而非通用失败）。
8. 跑完验收命令后再更新文档状态（见「完成后回写」）。

**验收命令**：
```
uv run pytest tests/unit/db/test_product_library_repo.py tests/unit/api/test_product_library.py -q
uv run pytest tests/unit/i18n -q
cd dashboard && npx vitest run src/pages/ProductVideoWizard/index.test.tsx
cd dashboard && npx tsc -b --pretty false
```
通过标准：上述全部通过，且新增用例确实断言了「整单失败 + 点名文件 + 无残留项目」。

**停止条件**（遇到即停并报告，不要自行扩大范围）：
- 需要改 `ProjectResponse` 或快照结构才能实现 → 停，说明需要产品确认。
- 需要新增数据库迁移 → 停（当前口径不需要迁移）。
- 现有用例（如 `test_asset_paths_and_snapshot_remain_stable_after_product_edit_or_delete`）因新行为失败 → 先判断该用例是否与新口径冲突；冲突则**停下报告**，不要自行改写历史用例的断言含义。
- 前端既有断言（`videoWizard.generateFailed`）受影响 → 停下报告。

**完成后回写**：
- `docs/product-video-multi-category-materials.md`：A8 复核表 A7.3 行改为「第 25 条已实现并验证」；A9 验证记录追加本次命令与结果。
- `docs/eval/examples/product-video-multi-category.yaml`：`PVQ-008` 的 `status` 改为 `active`、`blocking` 改为 `true`，并在 `notes` 写明实施日期。
- 本条目状态改为「已完成」，并记录完成日期与 commit。

---

### B-002 · 评测首批任务集补齐（E2：PLB 与 LLW 两个领域）

**状态**：已完成（登记日期：2026-11-24；完成日期：2026-11-24）
**优先级**：P1 重要不紧急
**跟踪**：CNB issue [#29](https://cnb.cool/mengxa.com/-/repos/Octop/-/issues/29)
**语义来源**：[eval/README.md §8.2 迁移计划](./eval/README.md) —— 步骤 E2；格式与判定规则见同文档 §2–§6
**可无人值守执行**：是

**实际产出**：`docs/eval/examples/product-image-batch-import.yaml`（PLB 14 条）与
`docs/eval/examples/local-library-wizard.yaml`（LLW 8 条）；两条任务集已接入夜间
执行器 `scripts/run_eval_nightly.py`（见 [archive/backend-full-test.md](./archive/backend-full-test.md)
「L4 评测（夜间集合）」）。PLB 是后端任务，夜间可直接产出结论；LLW 是桌面/前端
命令，在后端生产机上按边界闸门记为 blocked + 原因（规范 §5 的诚实要求），
需在桌面 / 前端环境执行。回链已写入两份需求文档。

**背景**：评测体系目前只有 `PVQ` 一个领域的样板（[examples/product-video-multi-category.yaml](./eval/examples/product-video-multi-category.yaml)）。规范已立但覆盖面不足，`PLB`（批量导入）与 `LLW`（桌面本机素材库）两个领域的 `must` 需求条目还没有对应的可执行任务，不做的后果是这两块需求永远只能靠人读文档验收。

**范围**：仅新增/修改 `docs/eval/examples/` 下的 YAML 任务集文件与 `docs/eval/README.md` 的 §8.2 状态行；必要时在对应需求文档补入任务 ID 反向链接；**不写代码、不改 CI**。

**不在范围**：不改任何 `src/`、`dashboard/`、`tests/` 文件；不改变需求语义；不实现校验脚本（那是 B-003）。若反向链接缺失，完成 B-002 时可按需补入需求文档的任务 ID 引用。

**前置条件**：读 `docs/eval/README.md` 全文（尤其是 §3 字段表、§4 判定红线、§6 领域前缀表）；读两份需求文档（`docs/product-image-batch-import.md`、`docs/design/video-production-workbench/local-library-wizard.md`）。

**步骤**：
1. 为 `PLB` 领域写 `docs/eval/examples/product-image-batch-import.yaml`：覆盖 `docs/product-image-batch-import.md` 的 FR-1…FR-8 与 §11 的验收条目 1–9，每个 `must` 条目至少一条任务。
2. 为 `LLW` 领域写 `docs/eval/examples/local-library-wizard.yaml`：覆盖该文档 §5 的验收条目 1–6。
3. 判定器只用已在样板中出现过的五种（`test` / `steps` / `threshold` / `rubric` / `visual`）；命令必须**真实存在于仓库**，引用测试文件时写准确的用例名。
4. 需要真实模型或真实账号的任务标 `live: true` 且 `regression: nightly`、`blocking: false`。
5. 暂时无法判定的任务标 `status: planned` 并在 `notes` 写明缺什么（照抄样板 PVQ-007 的写法）。

**验收命令**：
```
uv run python -c "import yaml,pathlib; [yaml.safe_load(p.read_text(encoding='utf-8')) for p in pathlib.Path('docs/eval/examples').glob('*.yaml')]"
```
外加人工检查：每个 `must` 需求条目都能在任务集里找到至少一条对应任务；任务里的命令路径确实存在。

**停止条件**：某个需求条目本身还没收口（存在二选一或未定义行为）→ 不要为它编任务，改为在 `docs/product-video-multi-category-materials.md` / 对应需求文档的开放问题处登记，或在本文件新增一条 P2 待办。

**完成后回写**：`docs/eval/README.md` §8.2 的 E2 行状态；本条目状态。

---

### B-003 · 评测任务集校验与 PR 门禁接入（E3）

**状态**：待实施（登记日期：2026-11-24）
**优先级**：P2 常规
**跟踪**：CNB issue [#30](https://cnb.cool/mengxa.com/-/repos/Octop/-/issues/30)
**语义来源**：[eval/README.md §5 集合划分与 CI 接入](./eval/README.md) —— 步骤 E3
**可无人值守执行**：否（涉及 CI 策略改动，需要人确认门禁范围）

**背景**：任务集目前靠人工维护，字段写错不会被拦下；PR 也不会按 `owner` 自动挑选受影响任务。

**范围（白名单）**：`tests/evals/` 下的校验脚本与任务集目录、pre-commit 对 `docs/eval/**` 变更的增量校验、CI workflow 的增量校验/选择步骤。

**不在范围**：不改 `.github/workflows/ci.yml` 既有门禁的通过标准；不引入新的第三方依赖（脚本用标准库 + 已有的 `pyyaml`）；不改评测判定语义；不落地 E2/E3 之外的行为评测。

**前置条件**：B-002 已完成；读 `docs/eval/README.md` §3 与 §5。

**步骤**：
1. 建 `tests/evals/validate_tasks.py`：校验必填字段、枚举值、id 唯一且不复用、`requirement` 指向的文档存在、`status: planned` 的任务不得出现在门禁集合。
2. 明确白名单后分别接入：pre-commit 只做 `docs/eval/**` 变更时的格式/字段校验；CI 做任务选择并按明示配置执行受审命令，不把校验误写成已启用的行为门禁。
3. 按 `docs/eval/README.md` §5 实现任务选择：覆盖 direct owner、共享配置/锁文件、任务集改动、未知代码四类变更；共享路径无法安全判定时跑受影响领域全集，无法识别领域时跑全量非 live；明确文档-only 时才可回退 `smoke`。

**验收命令**（只验证本条范围）：
```
uv run python tests/evals/validate_tasks.py
```
通过标准：故意写错的字段能被拦下（附一条自测用例）；自测还必须证明零匹配命令不会因退出码 0 被判通过，并覆盖 direct owner、共享锁/配置、任务集改动、未知代码四类选择；实际接入 pre-commit/CI 的选择与路径须以仓库配置为准，不以“脚本可运行”冒充门禁已启用。

**停止条件**：需要改动既有 CI 门禁的通过标准，或需要新增依赖 → 停，报告。

**完成后回写**：`docs/eval/README.md` §8.2 的 E3 行；本条目状态。

---

### B-004 · 首个 rubric 量表与 live 任务配额口径（E4）

**状态**：待实施（登记日期：2026-11-24）
**优先级**：P2 常规
**跟踪**：CNB issue [#31](https://cnb.cool/mengxa.com/-/repos/Octop/-/issues/31)
**语义来源**：[eval/README.md §8.1 已知缺口](./eval/README.md)
**可无人值守执行**：否（涉及模型调用成本，需人定配额）

**背景**：`rubric` 型判定（LLM 输出质量）缺量表模板；`live` 任务跑一次真实模型要花钱，没有口径就无法决定能否进 PR 门禁。

**范围**：`docs/eval/rubrics/` 下的量表文件、`docs/eval/README.md` 中关于 `live` 的说明。

**不在范围**：不改任何产品代码；不发起真实模型调用来「试跑」（除非拿到明确额度授权）。

**前置条件**：B-002 完成且至少存在一条 `rubric` 型任务。

**步骤**：
1. 写第一份 rubric 量表（建议以「分镜文案质量」为对象），格式与判定规则见 `docs/eval/README.md` §3.1。
2. 在 `docs/eval/README.md` 写清 `live` 任务的配额口径建议：默认只在 `nightly` 跑、单次成本上限、失败不阻断合并。
3. 给出一份 `live` 任务的登记模板。

**验收命令**：`docs/eval/README.md` §3.1 的字段表与新量表字段一致；两份文档中的占位符写法各自正确。

**停止条件**：需要真实调用模型才能定稿 → 停下并请求一次明确授权。

**完成后回写**：`docs/eval/README.md` §8.2 的 E4 行；本条目状态。

---

### B-005 · 桌面端会话续期：blob / stream / probe 三条路径接上续期

**状态**：待实施（登记日期：2026-11-25）
**优先级**：P1 重要不紧急
**跟踪**：未建 issue（本条由 backlog 自身承载；若需要协作跟踪，建 issue 后回填链接）
**语义来源**：[PRD.md §4 R6](./PRD.md) —— 桌面 local 账号的会话续期必须覆盖全部请求路径；判定口径见 [eval/examples/desktop-shell-session.yaml DSK-001](./eval/examples/desktop-shell-session.yaml)
**可无人值守执行**：是 —— 但**必须在有前端环境的机器上执行**（Node + 依赖已装，能跑 `npx vitest`）。后端生产机按 [deployment-boundary.md §1 NEVER 行](./deployment-boundary.md) 禁止 npm/npx/vite，在后端环境的夜间集合里本条记 blocked + 原因，不得静默跳过、不得算作通过。

**背景**：`dashboard/src/api/request.ts` 的 `request()` 遇到 401 会走 `retryWithDesktopSession()` —— 只有桌面 local 账号才续期（口令账号落登录页），续期后原地重试一次。`requestBlob` / `requestStream` / `probeAuthResource` 各自复制了一遍认证前置，唯独漏了这段续期，直接 `throwIfUnauthorized`。后果：桌面 local 账号的 token 过期后，走这三条路径（语音 TTS 的 blob/stream、素材库资产下载与工程包打包、工作区打包与文件下载、agent 工作区归档、认证资源探测）会被丢到登录页 —— 桌面端**没有密码可填**，用户只能重启应用。现状已由 `8c44f88f` 用 `it.fails` 钉在仓库里（CI 保持绿），但实现没修：缺口会一直存在，且随时间被人遗忘。

**范围（白名单）**：
- `dashboard/src/api/request.ts`
- `dashboard/src/api/request.blobRetry.test.ts`
- `docs/eval/examples/desktop-shell-session.yaml`（DSK-001 的 `status`）
- `docs/PRD.md` §4 的 R6 状态行

**不在范围**：不改后端（`src/octop/**`）；不改 `desktop/`（桌面壳与 bridge 契约）；不改 `renewDesktopSession` / `isLocalDesktopUser` 的既有语义（谁有资格续期是产品口径，不在本次范围）；不改另外两条护栏用例的断言；不动认证策略（口令账号仍落登录页）；不构建或部署前端产物（由前端环境的构建流程负责）。

**前置条件**：读 `dashboard/src/api/request.ts` 的 `retryWithDesktopSession`（`:412`）与调用点（`:473`）；读 `dashboard/src/api/request.blobRetry.test.ts` 的 5 条用例（3 条 `it.fails` + 2 条护栏）；读 [eval/README.md §3、§4](./eval/README.md)（任务字段与判定红线）。

**步骤**：
1. 把 `request()` 里的续期逻辑抽成可复用的公共函数（如 `renewAndRetry`），由 `request()` / `requestBlob` / `requestStream` / `probeAuthResource` 各自调用 —— **不要复制第二份「谁有资格续期」的判断**。
2. 三条路径补上与 `request()` 现状一致的判定：仅桌面 local 账号续期；口令账号与无 bridge 场景直接落登录页。
3. 把 `request.blobRetry.test.ts` 里 3 条 `it.fails` 改回普通断言（`it`），2 条护栏用例**保持原样**。
4. 跑验收命令；全绿后再改状态（本步骤 5）。
5. `docs/eval/examples/desktop-shell-session.yaml` 的 DSK-001 `status` 改为 `active`；`docs/PRD.md` §4 的 R6 状态改为 `✅ 已实现·已验证` 并附任务 id 与 commit。

**验收命令**：
```bash
cd dashboard && npx tsc -b && npx vitest run src/api/request.blobRetry.test.ts && npm run lint
```
通过标准：5 条用例全绿，文件中**不再有** `it.fails`；`npx vitest` 输出里必须收集到 5 条目标用例 —— 退出码 0 但零匹配不得判为通过（[eval/README.md §4 第 1 条](./eval/README.md)）。

**停止条件**：
- 需要改后端或 `desktop/` 的契约才能实现 → 停，报告；
- 需要改「谁有资格续期」的判定（`isLocalDesktopUser` / `renewDesktopSession` 语义）→ 停，报告 —— 那是产品口径，须走 PRD §8 开放问题；
- 当前机器没有前端环境 / 目标用例收集不到 → 记 blocked + 原因，**不得**静默跳过，也不得判为通过；
- 需要动 `src/octop/**` 或改认证策略 → 停，报告（超出白名单）。

**完成后回写**：`docs/eval/examples/desktop-shell-session.yaml` 的 DSK-001 状态；`docs/PRD.md` §4 的 R6 状态行；`docs/eval/README.md` 的任务集计数行；本条目状态。

---

### B-006 · 夜间候选分支自动合并到 develop（阶段 2）与主干口径（阶段 3）

**状态**：待实施（登记日期：2026-11-25；阶段 1 已于同日落地，见下「已完成的部分」）
**优先级**：P1 重要不紧急
**跟踪**：未建 issue（需要协作跟踪时建 issue 并回填链接）
**语义来源**：[backend-nightly-repair.md §7 接入授权](./backend-nightly-repair.md) 与 [AGENTS.md §10 分支与发布规则](../AGENTS.md)；本条目只写执行规格，行为口径仍以上述两处为准
**可无人值守执行**：否 —— 阶段 2 需要人提供**能建 PR 的凭据**并拍板门禁范围；阶段 3 是产品/运维口径决策，不可由智能体自行决定

**已完成的部分（阶段 1，2026-11-25）**：夜间任务已获授权在候选分支命名空间
（`codex/nightly-backend-<run_id>` / `nightly/<run_id>`）内提交并推送，推送经受限脚本
`/usr/local/sbin/octop-nightly-push.sh`（三道硬约束：候选命名空间白名单、拒绝
`main`/`develop`/`release/*`/`hotfix/*`、必须在夜间隔离 workspace 内；默认
`~/.gitconfig` 仍保留 `pushInsteadOf` 封禁）。推送目标为 GitHub 与 CNB 两个仓库。
**合并仍然由人完成** —— 本条目处理的是「把人工合并这一步也自动化」。

**背景**：要把「夜间自动修复」真正闭环到主干，还差四段链路：
1. **建不了 PR** —— GitHub 的 fine-grained PAT 有 admin 无 PR 写权限，开 PR 返回 403；
   CNB 的合并请求不会回流 GitHub，而 GitHub 才是权威源；
2. **没有 PR 就没有门禁** —— `.github/workflows/ci.yml` 的触发条件是 `on: pull_request`
   （无 push 分支），且本仓是 fork，push 事件不触发 workflow。当前团队实际是
   「本地提交 → 双推 → 直接快进推 develop」，这条路**没有任何 CI 门禁**；
3. **PR 作者白名单 + 分支保护** —— `restrict-pr-authors.yml` 会关闭不在
   `PR_AUTHOR_ALLOWLIST` 里的作者开的 PR；同一 workflow 规定「main 只接受
   `release/*` 与 `hotfix/*` 的 PR」；
4. **eval 门禁未接** —— B-003（任务集校验脚本 + PR 按 `owner` 选任务）仍未实施。

阶段 3 还叠一个未决口径：`docs/todo.md` T-003「生产部署来源切到 `develop`」与
`docs/wip-branch-workflow.md` §5.1「生产该跑 `v*` tag」冲突未拍板 —— 「主干是哪个
ref」本身还没定论，此时谈「自动合并到主干」是空谈。

**范围（白名单）**：
- `.github/workflows/` 下的门禁工作流（仅在阶段 2 明确选定改动范围后）
- `docs/eval/` 下的任务集校验脚本与 PR 任务选择（与 B-003 同一范围，二者择一推进，避免重复）
- 服务账号的凭据配置（`/var/lib/octop-nightly/` 下的 git 配置与凭据）
- 本条目与 `docs/backend-nightly-repair.md` §7 的状态回写

**不在范围**：不改 `src/octop/**` 与 `dashboard/**` 的产品逻辑；不改 AGENTS.md §10 的分支模型（`develop` → `release/*` → `main` → `v*` tag）；不打 `v*` tag；不部署；不改生产 checkout、生产数据与生产服务配置；不动 nightly 之外的定时任务。

**前置条件**：
- 阶段 1 已落地（候选分支推送能力可用）；
- 人提供**能建 PR 的凭据**（GitHub fine-grained PAT 增补 PR 写权限，或等价的机器账号），并把服务账号加入 PR 作者白名单；
- 人拍板阶段 3 的「主干」口径（T-003）；
- 读 `AGENTS.md` §10、[docs/backend-nightly-repair.md](./backend-nightly-repair.md) §7 与本文件 §2/§3。

**步骤**（分阶段，每阶段单独可交付、可验收）：
1. **阶段 2a · 恢复门禁链路**：确认候选分支能在 GitHub 上开出 PR 且 `ci.yml` 的
   `dashboard` / `quality` / `helm` / `test-windows` 四个 job 能在该 PR 上跑起来；
   门禁未绿时禁止任何自动合并。
2. **阶段 2b · 自动合并到 develop**：在 develop 上配置「PR + 必需检查全绿 → 自动合并」，
   目标分支**只限 develop**，且 MUST NOT 合并到 `main`。
3. **阶段 2c · 评测门禁接入**：按 B-003 实施任务集校验与按 `owner` 选任务，使夜间候选
   也受同一门禁约束（B-003 若已完成则本步只补夜间任务集的注册）。
4. **阶段 3 · 主干口径与合并策略**：先由人拍板 T-003（生产跟 `develop` 还是跟 `v*` tag），
   再把自动合并的边界写进本条目 —— 建议**自动到 develop 为止**，`release/*`、tag 与
   部署保留人工；若确要全自动到 `main`，必须先补齐该口径与保护规则。

**验收命令**：
```bash
# 阶段 2a/2b：候选分支的 PR 上，四个必需检查都必须真实跑起来（不是 skipped）
gh pr checks <PR 号> --required
# 阶段 2b：合并目标分支必须是 develop，且合并后 main 与 release/* 未被触碰
git ls-remote origin refs/heads/main refs/heads/develop refs/heads/release/
```
通过标准：PR 的四个 job 全部 `pass`（不得是 `skipped` 或「零匹配」）；自动合并只落在
`develop`；`main` 与 `release/*` 的 SHA 在合并前后不变。

**停止条件**：
- 需要改动 `main` 的分支保护规则，或需要新开一条定时任务 → 停，报告；
- PR 门禁在 fork 上无法按预期触发（push 不触发 workflow）→ 停，报告，不要用「本地跑过了」冒充门禁已启用；
- 需要动产品逻辑或部署 → 停，报告；
- 阶段 3 的「主干」口径未拍板 → 停，报告，**不得**默认按 `develop` 处理。

**完成后回写**：`docs/backend-nightly-repair.md` §7 的接入授权行与 §7.2 的推送目标行；本条目状态；`docs/todo.md` T-003（若阶段 3 已拍板）。

---

### B-007 · 视频生产工作台剩余项（本机向导配音配乐 / 多语言与授权 / VPW 评测任务集）

**状态**：待实施（登记日期：2026-11-26）
**优先级**：P1 重要不紧急
**跟踪**：未建 issue（本条由 backlog 自身承载；若需要协作跟踪，建 issue 后回填链接）
**语义来源**：[design/video-production-workbench/PRD.md §6](./design/video-production-workbench/PRD.md) 与该文 §2（四阶段步骤模型）、§4（多平台输出规格）、§7（验收判据）；能力口径见 [PRD.md §3.2](./PRD.md)
**可无人值守执行**：部分——「VPW 评测任务集」可无人值守；「本机向导配音配乐接入」需要前端环境；「多语言 TTS 与配乐授权」涉及授权口径，**未收口前不得开工**。

**背景**：视频生产工作台的 P0A/P0B/P0C 已随 `3edfe70d` / `02a64452` 落地，多平台逐 target 真实尺寸渲染也已实现（`remotion/desktop-worker.mjs` 批量分支）。但三件事没做完，导致文档与实现长期带缺口：(1) 桌面本机向导（`LocalVideoWizard`）没接配音配乐，与 Web 路径能力不一致（PRD §8 Q5 已关闭，口径写在 PRD §3.2）；(2) 多语言 TTS 与配乐授权未覆盖，`OutputTarget.language` 也不在桥接载荷里；(3) `VPW` 评测域在 [eval/README.md](./eval/README.md) 已登记但**没有任务集**，该域的需求条目缺少可自动判定的证据。缺口不补，文档会再次漂移。

**范围（白名单）**：
- `dashboard/src/pages/LocalVideoWizard/**`
- `dashboard/src/api/localLibrary.ts`（仅新增配音/配乐选项的请求封装）
- `desktop/src/video.go`（仅在桥接载荷需要 `language` 时扩展 `VideoTargetRequest`）
- `docs/eval/examples/video-production-workbench.yaml`（新建 VPW 任务集）
- `docs/eval/README.md`（VPW 任务集登记与计数行）
- `docs/design/video-production-workbench/PRD.md`（状态回写）

**不在范围**：不改 `src/octop/**`（服务端配音/配乐接口已实现，不在本次范围）；不新增曲库、不改曲库授权结论（属 [PRD.md §8 Q4](./PRD.md) 待决）；不改四阶段步骤模型与不变量；不引入在线渲染服务；不构建或部署前端产物（由前端环境的构建流程负责）。

**前置条件**：读 [design/video-production-workbench/PRD.md](./design/video-production-workbench/PRD.md) 全文（尤其 §2 步骤模型与 §0.1 不变量）；读 [PRD.md §3.2](./PRD.md) 的配音配乐路径口径；读 [eval/README.md §3、§4、§6](./eval/README.md)（任务字段、判定红线、领域前缀表）；读 `dashboard/src/pages/ProductVideoWizard/PlanStage.tsx`（Web 路径已有的配音/配乐选项实现，作为本机路径的实现参照）。

**步骤**：
1. **VPW 评测任务集（可先行，无阻塞）**：新建 `docs/eval/examples/video-production-workbench.yaml`，覆盖工作台 PRD §7 的 8 条验收条目，每条至少一条任务；按 [eval/README.md §6](./eval/README.md) 的 `VPW` 前缀命名；字段与判定红线照 `docs/eval/examples/local-library-wizard.yaml` 的既有格式。
2. 在 [eval/README.md](./eval/README.md) 的领域前缀表与任务集计数行登记 VPW，并把「任务集尚未建立」的说明改成实际条数。
3. **本机向导配音配乐接入**（需前端环境）：把 Web 路径 `PlanStage.tsx` 的配音/配乐选项按同一语义接到 `LocalVideoWizard`——免费档走本机 SAPI，付费档走服务端 MiniMax，失败按免费档降级；**不得**在客户端引入新的模型调用或新的授权结论。
4. **多语言与授权**：**在 [PRD.md §8 Q4](./PRD.md) 收口前不得开工**。收口后再决定 `language` 是否进入 `VideoTargetRequest`；若进入，桥接变更必须同步 [design/desktop-video-bridge-contract.md](./design/desktop-video-bridge-contract.md) 的动作表与 `VideoTargetRequest` 定义。

**验收命令**：
```bash
cd dashboard && npx tsc -b && npx vitest run src/pages/LocalVideoWizard
uv run pytest tests/unit/i18n -q
```
评测任务的判定命令按 [eval/README.md §3](./eval/README.md) 的格式写在任务 yaml 内，由夜间执行器 `scripts/run_eval_nightly.py` 运行。
通过标准：类型检查与定向用例全绿；VPW 任务集可被校验脚本识别（**退出码 0 但零匹配不得判为通过**，见 [eval/README.md §4 第 1 条](./eval/README.md)）。

**停止条件**：
- 需要改 `src/octop/**` 或新增服务端接口才能实现 → 停，报告；
- 触及配乐授权结论或曲库分发 → 停，报告（须走 PRD §8 Q4）；
- 需要改动四阶段步骤模型或 §0.1 不变量 → 停，报告（须产品负责人批准并更新工作台 PRD §0.1 变更记录）；
- 当前机器没有前端环境 → 该子项记 blocked + 原因，**不得**静默跳过，也不得判为通过（VPW 任务集子项不受此限）；
- 需要动 `desktop/` 的桥接动作集合（新增 action）而非扩展既有载荷 → 停，报告（契约变更须同步桥接契约文档）。

**完成后回写**：`docs/design/video-production-workbench/PRD.md` §6 与 §7 的状态；`docs/eval/README.md` 的 VPW 登记与计数行；`docs/PRD.md` §3.2 的配音配乐路径限制（若本机向导已接入）；本条目状态。

**后续项（未排期，进度不计入本条目）**：单镜头重生成与版本对比、模板库、智能素材推荐、批量产品出片、多个分镜方案 A/B 对比。
（来源：2026-11-25 前的 `docs/design/video-production-workbench/PRD.md`「P1 — 成本优化与易用性增强（后续）」；随本次合并保留，避免想法随文档收敛丢失。）


---

### B-008 · Concat 接入编辑界面（双窗口，路径 A）

**状态**：待实施（登记日期：2026-11-28）
**优先级**：P1 重要不紧急
**语义来源**：[concat-editor-integration.md §1–§7](./concat-editor-integration.md)（结论与依据）、
[desktop-video-bridge-contract.md](./design/desktop-video-bridge-contract.md)（桥接动作现行契约）、
[RELEASE-MATRIX.md §6](./RELEASE-MATRIX.md)（两条产品线安排）、
[PRD.md §4.1](./PRD.md)（桌面壳六条红线）
**可无人值守执行**：**否** —— 三项前置未收口（见下），且涉及前端构建环境

**背景**：极简一键生成版覆盖不了的成片场景，缺的是「在 PC 上再剪一刀」的能力。Concat 侧已有
MCP / JSON-RPC 两种进程外接口与绿色（portable）模式，接入路径清晰（见结论文档）；不做的后果是
这类需求继续落在用户自己找外部编辑器，产物回不到 Octop 素材库，链路断在最后一段。

**范围（白名单）**：
- `desktop/src/concat_bridge.go`（**新建**：安装检测、启动进程、握手、导出路径交接、产物回收）
- `desktop/src/video.go`（**仅**在需要扩展 `VideoTargetRequest` 载荷时）
- `dashboard/src/pages/**`（编辑入口与状态 UI）
- `desktop/src/*_test.go`（Go 侧定向用例）
- `docs/design/desktop-video-bridge-contract.md`（动作表、状态机、错误码同步）
- `docs/concat-editor-integration.md` / `docs/backlog.md` / `docs/RELEASE-MATRIX.md`（状态回写）
- `docs/eval/README.md`（若新增 eval 任务，登记任务集与计数行）

**不在范围**：
- 不把 Concat 源码或 `.slint` 界面并入 Octop（AGPL + Rust ↔ Python/TS + 体量）
- 不修改 Concat 二进制，也不改其代码后随 Octop 分发（AGPL 下只能独立进程调用）
- 不自研时间轴 / 预览 / 导出界面（那是路径 B，不在本条目）
- 不改四阶段步骤模型与工作台 PRD §0.1 不变量
- 不构建或部署前端产物（前端环境负责，见 [deployment-boundary.md](./deployment-boundary.md)）
- 不改 `src/octop/**`（服务端不感知 Concat）

**前置条件**：
1. 「是否启动 Concat 接入（编辑版）开发」拍板为「启动」；
2. Concat 引擎分发口径三选一收口（甲 / 乙 / 丙，见 [concat-editor-integration.md §8](./concat-editor-integration.md)）；
3. 上游版本锁定：记录 Concat 版本号 / commit、下载地址与 sha256，并复核许可边界
   （AGPL-3.0-or-later，独立进程调用，不改其代码随包分发）；
4. 编辑入口的产品位置拍板（工作台第三阶段内 / 独立一级入口）；
5. 前端环境可用（`dashboard/` 构建）；后端环境只做 Go 侧与契约。

**步骤**：
1. **先做不依赖前端的部分**：Go 侧桥接 action + 契约文档同步 + 定向用例；
2. **进程拉起与握手**：优先 `concat --mcp`（stdio JSON-RPC），备选 7420 socket
   （`CONCAT_API_ADDRESS` / `CONCAT_API_TOKEN`）；超时或失败必须能降级为「直接打开 Concat 窗口让用户自己剪」；
3. **工作目录放开**：按已定口径设置 `CONCAT_MCP_ROOTS`，并把工程与导出目录约束在约定路径内；
4. **导出物回流**：约定导出目录 → 登记进本机素材库（复用 library bridge 的 `ingest` 语义）；
5. **前端入口与状态**：安装检测 / 启动中 / 失败降级 / 导出中 / 完成；
6. **分发侧**：按已定口径实现（随包 = 打包脚本带目录；按需下载 = 复用 `environment_install` 校验链；
   用户自备 = 文档 + 路径探测）。

**验收命令**：
```bash
cd desktop && go build ./... && go vet ./... && go test ./src/...   # Go 侧定向
cd dashboard && npx tsc -b && npx vitest run <触达页面>              # 前端环境
uv run pytest tests/unit -k bridge -q                                # 契约相关单测
```
手动复验：Win10 上从「用 Concat 剪辑」入口拉起 Concat，剪一条素材并导出，成片回到素材库。

**停止条件**：
- 需要改 `src/octop/**` 或新增服务端接口 → 停，报告；
- 需要新增桥接 action 之外的契约变更（ZIP 安全不变量、错误码语义）→ 停，报告，先改契约文档；
- 上游许可或分发条款与 AGPL 边界冲突 → 停，报告；
- Concat 二进制在本机起不来（依赖缺失 / GPU 不满足）→ 记 blocked + 证据，**不得**判为通过；
- 无前端环境 → 前端子项记 blocked，**不得**静默跳过；
- 需要触及四阶段步骤模型或 §0.1 不变量 → 停，报告（须产品负责人批准并更新工作台 PRD §0.1 变更记录）。

**完成后回写**：
- `docs/design/desktop-video-bridge-contract.md`：新增 action、状态机、错误码；
- 本文 §8：两条待决 → 已决，并写明结论与日期；
- `docs/RELEASE-MATRIX.md` §6：分发口径一行落定；
- `docs/backlog.md`：本条目状态 → 已完成；
- `docs/eval/README.md`：若新增 eval 任务，登记任务集与计数行。
---

## 5. 与其它文档的关系

- 需求条目自身待实施 → 该需求文档的「实现状态」+ eval 任务 `status: planned`（见 [eval/README.md §3](./eval/README.md)）
- 需要人 / 特定环境 → [todo.md](./todo.md)
- 未决决策 → [PRD.md §8 开放问题](./PRD.md)，决策后转 [ADR](./adr/)
- 已写好但未发布 → `CHANGELOG.md` 的 `## [Unreleased]`
- 落点规则与状态词表 → [docs/README.md §文档维护规范](./README.md)
- 执行规范 → [AGENTS.md §12](../AGENTS.md)（DoR / DoD）
