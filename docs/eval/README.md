# 评测规范（Evals）

> 状态：**规范已确立（2026-11-24）**，首批任务集待补齐（见 §8 现状与迁移计划）
> 文档类型：**规范性文档** —— 规定评测任务集的格式、判定规则与 CI 接入方式。
> 目标读者：后端 / 前端 / 桌面端 / 测试 / 智能体
> 上位规范：[`AGENTS.md` §12 需求措辞与交付定义](../../AGENTS.md)（DoR / DoD 引用本文档）
> 索引维护：[`docs/README.md`](../README.md)

---

## 1. 为什么需要这份规范

PRD 里的「验收标准」是**给人读的**；评测任务集是**给机器跑的**。两者回答同一个问题——「做到什么程度算完成」——但只有后者能在每次提交时自动复算。

本规范解决三件事：

1. **可判定**：一条验收条目要么被自动断言，要么被人工走查并留证据，不允许「看起来对」。
2. **可复现**：任何一次结论都能绑定到具体 commit、命令与证据产物。
3. **可分层**：本地冒烟、PR 门禁、夜间全量各跑各的，不要求任何人本地跑全量。

适用边界：评测**不替代**单元测试。单元测试断言函数，评测断言**需求**——多步流程、权限边界、文案、跨层回归，以及任何 LLM 在回路里的行为。

本项目的 PR 任务默认使用固定 fixture、模拟 provider 或确定性快照断言工具调用、权限边界和结构化输出；认证与工具权限不得只靠 LLM 评分。随机性的真实模型任务只有在 E4 明示配置后才能启用，并须记录样本、模型与评分量表版本、通过阈值和配额。

---

## 2. 评测分层

| 层 | 名称 | 断言对象 | 典型实现 | 运行时机 | 阻断合并 |
|---|---|---|---|---|---|
| **L0** | 静态门禁 | 代码形态 | ruff / mypy / eslint / tsc / prettier | 每次提交（pre-commit）+ CI | 是 |
| **L1** | 单元与契约 | 函数与接口 | `uv run pytest tests/unit` | CI | 是 |
| **L2** | 定向回归 | 单个行为 | 单测试文件 / 单包 / 单 vitest 文件 | 本地冒烟（`AGENTS.md` §1） | 否（但必须通过） |
| **L3** | 集成与端到端 | 跨模块流程 | `tests/integration`、浏览器冒烟、桌面桥测试 | PR 触发受影响子集；夜间全量 | 按任务集 `blocking` 字段 |
| **L4** | 行为评测 | **需求条目** | 本文定义的任务集（含 LLM 判定） | PR 触发受影响任务；夜间全量 | 按任务集 `blocking` 字段 |

规则：

- L4 任务**必须**指向一条需求条目（`requirement` 字段），不允许「测一下看看」。
- L4 与 L1/L2 允许指向同一条需求的**不同侧面**（例：单测断言函数返回，评测断言用户可见结果）。
- 任何层都**不得**访问生产数据或真实用户数据；需要真实外部调用的任务必须带 `live: true`，默认不随 PR 运行。

---

## 3. 任务集格式

任务集是 YAML 文件，一个文件一个领域（domain）。字段如下，**全部必填**（标注「可选」除外）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 全局唯一，`<DOMAIN>-<三位序号>`，如 `PVQ-001`。**一经发布不得复用** |
| `title` | string | 一句话说明断言的行为 |
| `requirement` | string | 指向需求条目：`docs/<file>.md#<锚点>` 或 `<PRID>-<编号>` |
| `layer` | enum | `L3` / `L4`（L0–L2 不入任务集，见 §2 规则） |
| `severity` | enum | `must` / `should` / `may` —— 对应需求的 MUST / SHOULD / MAY |
| `owner` | string | 该行为的代码归属路径（便于定位回归） |
| `type` | enum | `automated` / `manual` / `visual` / `perf` / `rubric` |
| `judge` | object | 判定器，见 §3.1；可选 `cwd` 指定执行工作目录（默认仓库根目录） |
| `evidence` | array | 证据产物（人工任务必须含截图或日志） |
| `regression` | enum | `smoke` / `full` / `nightly` —— 该任务进哪套集合 |
| `blocking` | bool | 失败是否阻断合并 |
| `status` | enum（可选，默认 `active`） | 唯一状态字段：`planned` / `active` / `deprecated`；`planned` = 口径已定但**尚未实施**，`deprecated` = 已废弃但保留文件 |
| `live` | bool（可选） | 是否需要真实外部调用 / 真实模型 |
| `notes` | string（可选） | 已知限制、跳过理由、后续计划 |

> `status: planned` 的任务**不得**进入 CI 门禁，也**不得**被当作已通过；它表示需求口径已经定下、但实现尚未落地。`status: active` 只表示任务可执行，不表示已经接入 CI；是否进入 pre-commit、PR 或 nightly 由 §5 的实际配置决定。废弃任务只使用 `status: deprecated`，不得另加第二个状态字段。

### 3.1 判定器（`judge`）

按 `type` 取其一：

```yaml
# automated：命令 + 期望
judge:
  kind: test
  cwd: dashboard
  command: npx vitest run src/pages/ProductVideoWizard/index.test.tsx -t "loads and submits scene assets from multiple product categories"
  expect: exit_code == 0

# manual：可复现步骤 + 必须留的证据
judge:
  kind: steps
  steps:
    - 用账号 A 打开 /product-library，创建产品「主产品」并上传一张 scene 图
    - 追加产品「副产品」，观察画面列表出现其素材
  evidence_required: [screenshot, log]

# visual：固定素材/快照 + 可复用的视觉检查步骤；不能只写“看起来对”
judge:
  kind: visual
  steps: [打开固定快照, 按检查项逐项比对并截图]
  reference: docs/eval/fixtures/<name>

# perf：阈值断言
judge:
  kind: threshold
  command: <测量命令>
  metric: p95_latency_ms
  max: 300

# rubric：人工评分量表（LLM 输出质量等）
judge:
  kind: rubric
  rubric_ref: docs/eval/rubrics/<name>.md
  pass_score: 3
  scale: "1=不达标, 2=部分达标, 3=达标, 4=优秀"
```

### 3.2 任务集文件示例

见 [`examples/product-video-multi-category.yaml`](examples/product-video-multi-category.yaml)——首批任务集以「跨产品分类选材」需求为样板。

---

## 4. 判定规则（红线）

1. **可判定性**：每条断言必须能被复述为布尔命题。不可判定的措辞（「体验流畅」「基本可用」）**不得**写进任务集，应改写为阈值或拆条。任务执行器必须排除零匹配的命令/测试：命令退出码为 0 但没有收集到目标用例时，不得判为通过。
2. **证据强制**：`type: manual` / `visual` / `rubric` 的任务**必须**留下证据（截图、日志、录屏之一），并在结论里记录**评测人、日期、commit**。无证据的走查结论无效。
3. **绑定 commit**：任何结论必须绑定具体 commit，并说明工作树是否有未提交改动、运行环境、证据路径与实际结果；未绑定或只写预期结果视为未执行。
4. **跳过需说明**：任务被跳过时，必须记录原因（环境不具备、依赖未装、需求未实现）与后续计划，不得静默跳过。
5. **失败分类**：仅当结论为失败时，才归入以下之一，便于分流；状态另记为 `pass` / `fail` / `n/a` / `blocked`（或既有词表中含义等价的词），未运行不得写 `pass`：
   - `defect` 功能缺陷 → 进缺陷流程
   - `wording` 文案 / i18n 问题 → 回 `dashboard/src/locales` 或 `src/octop/i18n`
   - `perf` 性能不达标 → 进性能议题
   - `flaky` 环境不稳定 → 进不稳定用例清单，需限期修复
   - `misread` 需求理解偏差 → 回需求文档澄清（这说明需求条目写坏了）
6. **不得用「看起来对」结案**，也不得以「已修复，未复验」结案（复验后才算闭环）。
7. **不得用评测替代代码审查**：评测只回答「行为是否符合需求」，不回答「实现是否合理」。

---

## 5. 集合划分与 CI 接入

| 集合 | 内容 | 本地 | PR | 夜间 | 发版前 |
|---|---|---|---|---|---|
| `smoke` | 关键路径的 `must` 任务，L0 + 少量 L3/L4 | 按需 | 由已启用配置决定 | 由已启用配置决定 | ✅ |
| `full` | 该领域全部任务 | 按需 | 由已启用配置决定 | 由已启用配置决定 | ✅ |
| `nightly` | 全量任务，含 `live: true` 与 L4 rubric 任务 | ❌ | ❌ | 需明示执行器配置 | ✅ |

接入约定：

- PR 门禁（目标态）按变更选择任务：direct owner 变更跑对应任务；公共配置/锁文件变更覆盖共享依赖；任务集改动校验受影响集合；未知代码或无法安全判定共享路径时跑受影响领域全集，无法识别领域时跑全量非 live。只有明确文档-only 才可回退 `smoke`。该规则在执行器接入前是规划，不得写成当前已启用的门禁。
- 夜间由明示配置的执行器按本仓库受审命令运行全量，含需要真实模型的 `live` 任务；没有配置就不能宣称已跑夜间。
- 目标态发版前需按明示配置运行 `full`；`planned` / `deprecated`、人工任务和缺少真实凭据的 live 任务不得被调度器吞掉或虚标通过。当前未接入执行器时，不得宣称 `full` 已绿；失败或 blocked 不得合入为完成，`nightly` 失败不得静默。
- 现有通用 CI 单独运行同仓 live pytest 作业，与新任务集分开；凭据缺失时具体测试可 skip，不能把“未运行/跳过”写成行为评测通过。非阻断与未跑是不同状态，均须如实记录。
- CI 失败日志必须完整落到产物（artifact），不得只留最后一行。

---

## 6. 目录与命名约定

```
docs/eval/
  README.md                      # 本规范
  examples/                      # 模板与首批样板任务集
    product-video-multi-category.yaml
  rubrics/                       # rubric 型判定器的评分量表
tests/evals/                     # 可执行任务集（未来落地位置）
  tasks/<domain>.yaml            # 按领域拆分，domain 见下表
  evidence/                      # 人工评测证据（仅小体积截图入库，大文件走 CI artifact）
```

YAML 顶层必须是 `domain`、`requirement_doc`、`tasks`；`tasks` 为列表。任务执行器默认在仓库根目录工作；前端命令必须在 `judge.cwd: dashboard` 下执行，后端命令默认在仓库根目录。执行记录至少包含 `commit`、工作树未提交说明、环境、证据和实际结果。

领域前缀（`id` 的 `DOMAIN`）：

| 前缀 | 领域 | 归属文档 |
|---|---|---|
| `PLB` | 产品素材库（导入 / 归档 / 批量） | `docs/product-image-batch-import.md` |
| `PVQ` | 产品视频向导与素材选择 | `docs/product-video-multi-category-materials.md` |
| `VPW` | 视频生产工作台（多平台 / 精细调整） | `docs/design/video-production-workbench/PRD.md` |
| `LLW` | 桌面本机素材库与本机向导 | `docs/design/video-production-workbench/local-library-wizard.md` |
| `DSK` | 桌面壳（启动 / 登录 / 绿色版） | `docs/PRD.md` §4.1 |
| `API` | HTTP 接口契约与鉴权 | `docs/api.md` |
| `GW` | 网关与 IM 通道 | `docs/architecture.md` |

命名规则：

- 目录与文件名 kebab-case；`id` 大写前缀 + 三位序号。
- 任务**新增即注册**：同步在 `docs/README.md` 之外的领域需求文档里留引用（需求条目 → 任务 id）。
- 任务 id **不复用**：删除的任务保留文件并改为 `status: deprecated`，不物理删除。

---

## 7. 与需求、DoR / DoD 的关系

| 环节 | 要求 | 出处 |
|---|---|---|
| DoR | 需求条目必须至少有一条**可判定**验收条目 | `AGENTS.md` §12.2 |
| DoR | 需求条目涉及行为变更时，必须能映射到至少一个 L4 任务（或说明为何由 L1/L2 已覆盖） | `AGENTS.md` §12.4 |
| 实施 | 任务集与需求同步更新；需求变了，任务必须跟着变 | 本文档 |
| DoD | 每条验收条目有结论（pass / fail / n/a + 理由） | `AGENTS.md` §12.3 |
| DoD | 结论可追溯到 L4 任务结果或自动化用例 | 本文档 |

**结论闭环链**：`需求条目 → 验收条目 → 评测任务 id → 执行记录 + 证据 → 结论`。

---

## 8. 现状与迁移计划

### 8.1 现状基线（2026-11-24）

| 层 | 现状 | 位置 |
|---|---|---|
| L0 | ✅ 完整 | `Makefile`、`.githooks/pre-commit`、`.github/workflows/ci.yml` |
| L1 | ✅ 完整 | `tests/unit/**` |
| L2 | ✅ 流程已规定 | `AGENTS.md` §1「本地验证是冒烟」 |
| L3 | ⚠️ 部分 | `tests/integration/**`、浏览器冒烟脚本、桌面桥 Go 测试 |
| L4 | ⚠️ 规范与四个领域的任务集已存在；**夜间执行器已接入**后端定时任务，CI 门禁仍未启用 | 格式见本文档 §3；任务集 [examples/](./examples/)（PVQ 8 条 / PLB 14 条 / LLW 8 条 / DSK 2 条）；夜间执行器 `scripts/run_eval_nightly.py`（见 [backend-full-test.md](./backend-full-test.md)「L4 评测（夜间集合）」）；校验脚本、PR 门禁与证据归档仍待 B-003 |

**已知缺口**：

- L4 的 `rubric` 型判定（LLM 输出质量）缺少现成量表模板——首个 rubric 需要在首批任务里试写。
- `live` 任务的成本与配额没有口径（跑一次真实模型要多少钱、能不能进 PR 门禁）尚未确定。
- 任务集与需求的映射目前靠人工维护，暂无校验脚本。

### 8.2 迁移计划

> 执行规格（范围、步骤、验收命令、停止条件）登记在 [backlog.md](../backlog.md)，本表只写**进度口径**；
> 每步的唯一权威在 backlog 条目，两处不重复维护同一份执行细节。

| 步骤 | 交付物 | 完成判据 | 待办条目 | 状态 |
|---|---|---|---|---|
| **E1 骨架**（本次） | 本规范 + 目录约定 + 样板任务集 | 规范登记进 `docs/README.md`；样板任务集能被人工照着写新任务 | — | ✅ 已完成（2026-11-24） |
| **E2 首批任务集** | 2–3 个领域的 L4 任务（建议 `PVQ` / `PLB` / `LLW`） | 每个领域的 `must` 需求条目至少映射一条任务 | B-002 | ✅ 已完成（2026-11-24：PVQ 8 条 + PLB 14 条 + LLW 8 条） |
| **E3 校验与 CI** | 任务集格式校验脚本 + PR 门禁按 `owner` 选任务 | 故意写错的字段能被拦下；PR 上能看到受影响任务集 | B-003 | ⏳ 待实施 |
| **E4 rubric 与 live** | 首个 rubric 量表 + `live` 任务的配额口径 | rubric 判定在两次评测间稳定；live 任务不进 PR 门禁 | B-004 | ⏳ 待实施 |

---

## 9. 与其它文档的关系

- 上位规范：[`AGENTS.md`](../../AGENTS.md) §12（需求措辞、DoR、DoD）
- 文档维护规范：[`docs/README.md`](../README.md) §文档维护规范
- 执行规格与待办登记：[`backlog.md`](../backlog.md)
- 本地验证口径：`AGENTS.md` §1
- 测试布局与共享夹具：`AGENTS.md` §9 → `tests/support/`
- 需求文档：`docs/PRD.md` 及 `docs/README.md` §6 登记的各领域需求文档
