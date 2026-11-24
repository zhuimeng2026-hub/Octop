# 工程待办登记（Backlog）

> 状态：**活文档**（最近核实 2026-11-24）
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

**状态**：待实施（登记日期：2026-11-24）
**优先级**：P1 重要不紧急（适合夜间无人值守）
**跟踪**：CNB issue [#24](https://cnb.cool/mengxa.com/-/repos/Octop/-/issues/24)
**语义来源**：[product-video-multi-category-materials.md A8.1](./product-video-multi-category-materials.md) —— **行为契约只以 A8.1 为准，本条目不得另立口径**
**可无人值守执行**：是

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

**状态**：待实施（登记日期：2026-11-24）
**优先级**：P1 重要不紧急
**跟踪**：CNB issue [#29](https://cnb.cool/mengxa.com/-/repos/Octop/-/issues/29)
**语义来源**：[eval/README.md §8.2 迁移计划](./eval/README.md) —— 步骤 E2；格式与判定规则见同文档 §2–§6
**可无人值守执行**：是

**背景**：评测体系目前只有 `PVQ` 一个领域的样板（[examples/product-video-multi-category.yaml](./eval/examples/product-video-multi-category.yaml)）。规范已立但覆盖面不足，`PLB`（批量导入）与 `LLW`（桌面本机素材库）两个领域的 `must` 需求条目还没有对应的可执行任务，不做的后果是这两块需求永远只能靠人读文档验收。

**范围**：仅新增/修改 `docs/eval/examples/` 下的 YAML 任务集文件与 `docs/eval/README.md` 的 §8.2 状态行；**不写代码、不改 CI**。

**不在范围**：不改任何 `src/`、`dashboard/`、`tests/` 文件；不改需求文档；不实现校验脚本（那是 B-003）。

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

**范围**：`tests/evals/` 下的校验脚本与任务集目录、CI workflow 的增量步骤。

**不在范围**：不改 `.github/workflows/ci.yml` 既有门禁的通过标准；不引入新的第三方依赖（脚本用标准库 + 已有的 `pyyaml`）；不改评测判定语义。

**前置条件**：B-002 已完成；读 `docs/eval/README.md` §3 与 §5。

**步骤**：
1. 建 `tests/evals/validate_tasks.py`：校验必填字段、枚举值、id 唯一且不复用、`requirement` 指向的文档存在、`status: planned` 的任务不得出现在门禁集合。
2. 把校验接进 pre-commit（仅在 `docs/eval/**` 变更时触发）与 CI。
3. 实现按变更路径匹配 `owner` 前缀挑选任务的最小实现；匹配不到时跑 `smoke`。

**验收命令**：
```
uv run python tests/evals/validate_tasks.py
```
通过标准：故意写错的字段能被拦下（附一条自测用例）。

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

## 5. 与其它文档的关系

- 需求条目自身待实施 → 该需求文档的「实现状态」+ eval 任务 `status: planned`（见 [eval/README.md §3](./eval/README.md)）
- 需要人 / 特定环境 → [todo.md](./todo.md)
- 未决决策 → [PRD.md §8 开放问题](./PRD.md)，决策后转 [ADR](./adr/)
- 已写好但未发布 → `CHANGELOG.md` 的 `## [Unreleased]`
- 落点规则与状态词表 → [docs/README.md §文档维护规范](./README.md)
- 执行规范 → [AGENTS.md §12](../AGENTS.md)（DoR / DoD）
