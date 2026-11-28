# Octop 文档索引

> 本目录是 Octop 的**工程与产品文档中心**。本文是唯一入口，按主题分组列出全部文档并标注状态。
> 代码与配置的事实以源码为准；本索引只负责「去哪找」。
>
> 维护规范见文末 [§文档维护规范](#文档维护规范)。

---

## 快速入口（活文档）

这几篇是随代码持续更新的权威文档，多数问题从这里开始：

| 文档 | 回答什么 |
|---|---|
| [PRD.md](./PRD.md) | 产品是什么、为谁服务、要做什么、做到什么程度算完成 |
| [RELEASE-MATRIX.md](./RELEASE-MATRIX.md) | 客户端形态（full/slim/thin）、构建方式、分发渠道、版本口径 |
| [architecture.md](./architecture.md) | 技术分层、进程模型、存储、i18n |
| [api.md](./api.md) | HTTP/WebSocket 接口契约 |
| [configuration.md](./configuration.md) | 环境变量、`config.json`、SSO、存储配置 |
| [user-guide.md](./user-guide.md) | 终端用户操作指南（另有 [HTML 版](./user-guide.html)） |

---

## 1. 产品与需求

| 文档 | 说明 |
|---|---|
| [PRD.md](./PRD.md) | 产品需求文档（活文档，含桌面壳六条产品硬约束 §4.1） |
| [RELEASE-MATRIX.md](./RELEASE-MATRIX.md) | 交付形态与渠道矩阵（活文档） |
| [personas.md](./personas.md) | 用户画像与人格模板 |
| [expert-teams.md](./expert-teams.md) | 专家团队模式（AgentTeams）的设计与决策 |
| [projects.md](./projects.md) | 项目模式设计（设计态，尚未实现） |
| [desktop-direct-chat-panel.md](./desktop-direct-chat-panel.md) | 当前迭代需求：桌面端「直接对话框」R1–R6 |

## 2. 架构与决策记录（ADR）

| 文档 | 说明 |
|---|---|
| [architecture.md](./architecture.md) | 系统架构总览 |
| [adr/001-single-process-model.md](./adr/001-single-process-model.md) | ADR 001：单进程、无外部队列 |
| [adr/002-database-backends.md](./adr/002-database-backends.md) | ADR 002：SQLite / PostgreSQL 双后端 |
| [adr/003-skill-package-kb-pg-storage.md](./adr/003-skill-package-kb-pg-storage.md) | ADR 003：技能包与知识库的存储选型 |
| [agent-interop-mailbox.md](./agent-interop-mailbox.md) | Agent Teams 的 Inbox + Callback 底层架构 |
| [agent-call-agent.md](./agent-call-agent.md) | Agent 同步互调（`@` / `ask_agent sync`） |
| [agent-delegation.md](./agent-delegation.md) | Agent 后台异步协作 |
| [agent-backend-file-io.md](./agent-backend-file-io.md) | Agent 内容文件 Backend 严格化改造 |
| [bridge.md](./bridge.md) | Octop ↔ Octop 跨实例桥（实现中） |
| [browser-cdp-lan-reuse.md](./browser-cdp-lan-reuse.md) | 复用桌面 Chrome 登录态（CDP 局域网共享） |
| [octop-ui-payload-offload.md](./octop-ui-payload-offload.md) | 大 payload 旁路设计 |
| [acp.md](./acp.md) | ACP（Agent Client Protocol）双向能力 |

## 3. API、配置与认证

| 文档 | 说明 |
|---|---|
| [api.md](./api.md) | API 参考（活文档） |
| [cli.md](./cli.md) | CLI 参考 |
| [configuration.md](./configuration.md) | 配置参考（活文档） |
| [wechat-open-login.md](./wechat-open-login.md) | 微信开放平台扫码登录 |
| [ldap.md](./ldap.md) | LDAP 目录登录 |
| [magpie.md](./magpie.md) | Magpie（OpenAI 兼容 provider）接入 |

## 4. 连接器与通道

| 文档 | 说明 |
|---|---|
| [connectors.md](./connectors.md) | 内置连接器总览（元数据 source of truth 为 `catalog.json`） |
| [connectors-agently-mail.md](./connectors-agently-mail.md) | Agent Mail CLI 连接器 |
| [connectors-qcc.md](./connectors-qcc.md) | 企查查 MCP 连接器 |
| [connectors-ragflow.md](./connectors-ragflow.md) | RAGFlow 知识库连接器 |
| [discord-channel.md](./discord-channel.md) | Discord 通道配置与本地验收 |
| [telegram.md](./telegram.md) | Telegram 通道行为（draft，依赖 octop-gateway） |
| [plugin-channels.md](./plugin-channels.md) | 第三方通道插件 |

## 5. 市场与包格式

| 文档 | 说明 |
|---|---|
| [skill-market.md](./skill-market.md) | 自建 SkillHub 兼容技能市场 |
| [private-market.md](./private-market.md) | 内网自建插件/专家市场 |
| [expert-package.md](./expert-package.md) | 专家压缩包格式（`manifest.json`） |
| [plugin-package.md](./plugin-package.md) | 插件压缩包格式（`plugin.yaml`） |

## 6. 素材与视频

| 文档 | 说明 |
|---|---|
| [product-material-library.md](./product-material-library.md) | 产品素材库（**Web 路径**）功能总览：实体、存储位置、快照语义；桌面本机路径见 [PRD.md §3.7](./PRD.md) 与 [本机素材库](./design/video-production-workbench/local-library-wizard.md) |
| [product-library-import-architecture.md](./product-library-import-architecture.md) | 素材导入与 AI 识别架构：**推理职责边界的唯一权威**（服务端调远程多模态模型，客户端不跑模型）；素材字节落点见 [PRD.md §3.7](./PRD.md) |
| [product-image-batch-import.md](./product-image-batch-import.md) | 目录图片批量识别与归档（M1 已实现、M3 桌面端目录对话框已实现，M2 任务持久化未实现）+ 大图体积处理（§11 已实现） |
| [product-video-multi-category-materials.md](./product-video-multi-category-materials.md) | 跨产品分类选素材：使用说明（第一部分，面向创作者）+ 工程侧需求与验收（第二部分，**该主题需求与验收的唯一权威**） |
| [design/product-video-wizard/README.md](./design/product-video-wizard/README.md) | Web 五步视频向导的界面与交互规范（**Web 路径步骤名的唯一落点**） |
| [design/video-production-workbench/PRD.md](./design/video-production-workbench/PRD.md) | 视频生产工作台升级规格：**四阶段步骤模型的唯一权威**、引导模式 + 精细工作台 + 多平台输出（含防回退不变量） |
| [design/video-production-workbench/local-library-wizard.md](./design/video-production-workbench/local-library-wizard.md) | 桌面端本机素材库与本机视频向导（已实现；桌面本机路径的步骤与实现落点） |
| [design/desktop-video-bridge-contract.md](./design/desktop-video-bridge-contract.md) | 桌面视频桥接现行契约：全部桥接动作、状态机、错误码与 ZIP 安全不变量 |
| [design/beginner-ui-audit/README.md](./design/beginner-ui-audit/README.md) | 新手界面审计（桌面首启、视频向导、本机素材库的空态与引导问题；A/B/C 已实施，D/E 未实施） |
| [remotion-video-pipeline.md](./remotion-video-pipeline.md) | 服务端产出脚本 → 本机 Remotion 渲染流水线（**agent 对话式**路径；产品向导式路径见上表两篇向导文档） |
| [local-studio-package.md](./local-studio-package.md) | 本机 Remotion 制作包结构合同 |
| [backend-mvp-v01-deployment.md](./backend-mvp-v01-deployment.md) | 后端 MVP v0.1 部署记录（历史实现记录，保留测试证据） |

## 7. 桌面客户端

| 文档 | 说明 |
|---|---|
| [desktop-windows-build.md](./desktop-windows-build.md) | Windows 构建流程与本机坑（活文档） |
| [desktop-bootstrap-installer.md](./desktop-bootstrap-installer.md) | Windows 瘦安装器与分层下载（**方案与路线图权威文档**） |
| [desktop-runtime-layered-download-task.md](./desktop-runtime-layered-download-task.md) | 分层下载任务书（PR-0/PR-1 已实施） |
| [desktop-runtime-layered-download-pr3-pr5.md](./desktop-runtime-layered-download-pr3-pr5.md) | PR-3/PR-5 下载进度面板与可选组件设计 |
| [desktop-runtime-layered-download-report-pr0.md](./desktop-runtime-layered-download-report-pr0.md) | PR-0 交付报告（依赖瘦身） |
| [desktop-runtime-layered-download-report-pr1.md](./desktop-runtime-layered-download-report-pr1.md) | PR-1 报告（源码层制品） |
| [desktop-runtime-layered-download-report-pr35.md](./desktop-runtime-layered-download-report-pr35.md) | PR-3/PR-5 设计与最小实现报告 |
| [desktop-single-instance.md](./desktop-single-instance.md) | 桌面端进程互斥（单实例）复核（权威） |

## 8. 部署与运维

| 文档 | 说明 |
|---|---|
| [deployment-pitfalls.md](./deployment-pitfalls.md) | 部署踩坑清单（路径前缀、代理、agent-running 等） |
| [deployment-boundary.md](./deployment-boundary.md) | 前后端部署边界契约（**唯一权威**：后端环境永不构建前端，`src/octop/dashboard/` 是唯一交接物） |
| [base-path-deployment.md](./base-path-deployment.md) | 子路径部署（`base_path` / `base_url`） |
| [windows-deploy-script.md](./windows-deploy-script.md) | Windows 一键部署前端产物（PowerShell） |
| [cluster_CN.md](./cluster_CN.md) | 多副本 / Helm 部署（中文） |
| [cnb-mirror.md](./cnb-mirror.md) | CNB 镜像链路（GitHub → CNB） |
| [cnb-openapi.md](./cnb-openapi.md) | CNB Open API 调用方法与踩坑 |
| [cnb-branch-analysis.md](./cnb-branch-analysis.md) | CNB 分支情况每日分析机制（每日 01:30 自动出带日期的快照，活文档） |
| [gitee-release.md](./gitee-release.md) | Gitee 发布通道 |
| [git-credentials.md](./git-credentials.md) | 多远端与共享 credential store 的凭据管理 |
| [upstream-sync.md](./upstream-sync.md) | 与上游 TencentCloud/Octop 同步的基线、冲突面与固定流程 |
| [memory-slim.md](./memory-slim.md) | 手动在线整理 `memory.sqlite` |
| [superagent-remote.md](./superagent-remote.md) | superagent（dsh-superagent）远程 systemd 部署 |
| [backend-nightly-repair.md](./backend-nightly-repair.md) | 后端 02:10 全量测试的隔离、失败归因、候选修复与报告交接（规范性；唯一运行手册） |

## 9. 研发规范与评测

| 文档 | 说明 |
|---|---|
| [eval/README.md](./eval/README.md) | 评测规范（**规范性**）：L0–L4 分层、任务集格式、判定规则、集合划分与 CI 接入；样板见 [eval/examples/](./eval/examples/product-video-multi-category.yaml) |
| [backlog.md](./backlog.md) | 工程待办登记（**规范性**）：条目格式、优先级语义、可无人值守执行的规格要求；当前条目 B-001…B-007 |
| [todo.md](./todo.md) | 需要人 / 特定环境的待办（扫码、真机、真实账号）；与 backlog 的分流见 §文档维护规范第 7 条 |
| [wip-branch-workflow.md](./wip-branch-workflow.md) | WIP 分支工作流（**规范性**）：未提交工作树的快照、重放规则、保留与清理判据、与镜像链路的关系 |
| [feishu-rewrite-rules.md](./feishu-rewrite-rules.md) | 飞书通俗版改写规则（**发布口径，非产品需求**）：把 PRD.md 改写成人话版的范围、术语与事实边界 |
| [../AGENTS.md §12](../AGENTS.md) | 需求措辞（RFC 2119 关键词）、Definition of Ready / Done、评测义务与规范文档地图 |

## 10. 历史归档

> 以下文档保留作背景参考，**结论以上文对应主题的活文档为准**，勿据此实现。

| 文档 | 说明 |
|---|---|
| [archive/product-library-mvp.md](./archive/product-library-mvp.md) | 素材库第一批 MVP 的历史设计与实施约定（已被 [导入架构](./product-library-import-architecture.md) 与 [批量导入](./product-image-batch-import.md) 取代） |
| [archive/backend-full-test.md](./archive/backend-full-test.md) | 旧后端全量测试脚本的历史背景与证据口径（执行口径以 [backend-nightly-repair.md](./backend-nightly-repair.md) 为准） |
| [archive/backend-ai-storyboard-mvp.md](./archive/backend-ai-storyboard-mvp.md) | 服务端 LLM 分镜 MVP 快照（已被 [api.md](./api.md) 与 [工作台 PRD](./design/video-production-workbench/PRD.md) 取代） |
| [archive/product-library-unified-import-entry.md](./archive/product-library-unified-import-entry.md) | 素材库统一导入入口的早期设计与实施约定（已实现，被 [导入架构](./product-library-import-architecture.md) 取代） |
| [archive/product-library-agent-scope-fix.md](./archive/product-library-agent-scope-fix.md) | 产品库页 agent 下拉 403 的一次性修复说明（已修复） |
| [archive/design-qa-2026-10.md](./archive/design-qa-2026-10.md) | Web 五步向导 2026-10 的一次性设计验收记录（该主题验收见 [跨产品分类选材](./product-video-multi-category-materials.md)） |
| [archive/desktop-auto-video-2026-10/](./archive/desktop-auto-video-2026-10/) | 2026-10 桌面端自动制作视频方案（分发方式与桥接动作均已被代码推翻；现行契约见 [桌面视频桥接契约](./design/desktop-video-bridge-contract.md)） |

---

## 文档维护规范

1. **单一权威来源**：同一结论只在一篇文档中维护；其它文档用相对链接指向它，不复述、不另造判定逻辑。若发现两篇文档结论冲突，先确认哪篇随代码更新，再合并另一篇。
   需求文档维护产品行为与状态；`backlog.md` 承载跨层工程执行规格（例如 B-001）；`eval/` 负责证据与需求映射；Issue/PR 负责协作跟踪。它们互相链接，不能各自维护第二份执行清单。
2. **活文档标注**：随代码演进的文档在页首声明「状态：活文档」与「最新核实日期」；被取代的文档移入 [archive/](./archive/) 并标注取代它的文档。
3. **状态诚实**：设计态、未实现、draft、历史记录必须在页首显式声明（参考 `projects.md`、`telegram.md`、`archive/product-library-mvp.md` 的写法），避免读者误当作现行能力。
4. **链接规范**：目录内一律使用相对 Markdown 链接（如 `./api.md`、`./adr/002-database-backends.md`），保证仓库可整体搬迁；新增/删除/移动文档后必须全局检查断链。
5. **命名规范**：小写 kebab-case；专题前缀按子系统统一（`desktop-*`、`product-*`、`connectors-*`、`design/*`）；ADR 按序号放 `adr/`。
6. **正文与索引同步**：新增文档必须在本索引登记（分组 + 一句话说明）；删除文档必须同步清理全部引用（含 README.md / AGENTS.md / 源码注释）。
7. **待办与未决事项的落点**：一条待办**只能有一个落点**，其它地方只链接不复述。按性质分流：

   | 性质 | 唯一落点 | 状态词表 |
   |---|---|---|
   | 需要人 / 特定环境（扫码、真机、真实账号） | [todo.md](./todo.md) | ⏳ 待安排 / 🚧 进行中 / ⛔ 已阻塞 / ✅ 已完成 |
   | 口径已定、代码未实施（属于某条需求） | 该需求文档的「实现状态」表 + eval 任务 `status: planned` | 口径待定 / 口径已定·实现待做 / 已实现·已验证 |
   | 跨层工程执行规格（可关联一条或多条需求） | [backlog.md](./backlog.md) | 待实施 / 进行中 / 已完成 / 已阻塞 |
   | 未决的提案 / 开放问题 | 需求文档的「开放问题」表；决策后转 [adr/](./adr/) | 待决 / 已决·转 ADR-00X / 已关闭 |
   | 已写好但未发布 | `CHANGELOG.md` 的 `## [Unreleased]` 段 | — |
   | 路线图层面 | `README.md` 的 Roadmap 段 | 规划中 / 进行中 / 已完成 |
   | 协作型任务（人机协同） | Issue / PR（CNB 仓库 `mengxa.com/Octop`） | — |

   配套规则：

   - **口径已定·实现待做**必须挂一个验收锚点（eval 任务 id 或回归命令），否则不算登记完成——见 `AGENTS.md` §12.2 DoR 第 10 条与 §12.3 DoD 第 1 条。
   - `backlog.md` 里标 **P1 重要不紧急** 的条目，必须写全白名单、步骤、验收命令与**停止条件**，使其可被智能体**无人值守**执行（夜间批次）——凡需人拍板的分歧，必须在条目里已经收口成唯一动作。
   - **ADR**：编号连续（`adr/00N-*.md`），页首写 `**Status:**`（`Proposed` / `Accepted` / `Rejected` / `Superseded by ADR-00X` / `Deprecated`）与 `**Date:**`；ADR 不可变，只追加「被谁取代」，被取代的原件移入 `adr/` 保留并在索引标注。
   - **`CHANGELOG.md`** 遵循 Keep a Changelog：发版前必须把 `[Unreleased]` 段灌满（新增/变更/修复），发版时清空并落版本号。
   - **协作跟踪**：需要靠 issue 跟踪的条目，**必须**把 issue 链接回填到对应的文档条目（需求文档的开放问题表 / `backlog.md` 条目 / `todo.md` 条目），保持文档 ↔ issue 双向可追溯。issue 正文写决策与执行上下文，**行为口径仍以文档为准**，不得在 issue 里另立结论。
   - `todo.md` 只收「需要人 / 特定环境」的事项。智能体侧能完成的活儿要么**直接做掉**，要么登记进 `backlog.md`（P1 条目可夜间无人值守执行），要么作为某条需求的实现登记在该需求文档的「实现状态」表——一条待办**只能有一个落点**，**不得**同时出现在两处。
8. **文档元数据模板**：`docs/` 下的文档页首必须声明下列字段，缺一项即视为未登记完成：

   ```markdown
   > 类型：需求 | 规范 | 参考 | 设计 | 历史
   > 状态：活文档 | 设计态 | 口径已定·实现待做 | 已实现 | 已归档
   > 最新核实：YYYY-MM-DD
   > 取代关系：（可选；被取代时写明取代它的那篇）
   ```

   样板：活文档见 [architecture.md](./architecture.md)；需求文档见 [PRD.md](./PRD.md)；设计稿见 [design/video-production-workbench/PRD.md](./design/video-production-workbench/PRD.md)；归档件见 [archive/product-library-mvp.md](./archive/product-library-mvp.md)。允许 YAML front-matter 或引用块两种写法，但**字段名与语义必须一致**。
9. **目录语义**：

   | 目录 | 语义 | 硬要求 |
   |---|---|---|
   | `docs/` 根 | 活文档与规范性文档 | 声明状态与核实日期；随代码演进 |
   | `docs/design/` | 专题设计稿与规格 | **必须自声明状态**；内容被后续文档继承时，页首写明「继承者」；被继承后原文档转入 `archive/` |
   | `docs/archive/` | 历史件，**不得作为实现依据** | 迁入时首行标注取代它的那篇（见第 2、10 条） |

10. **归档判据**：满足下列任一条即应归档——（a）内容已被另一篇文档明确取代；（b）文档自述「已被取代 / 以 X 为准」；（c）一次性验收或交付记录，且其验收对象已被后续方案推翻；（d）对应能力已实现，设计价值已被代码与现行文档吸收。

    归档动作：`git mv` 到 `docs/archive/`（整目录归档时目录名带日期，如 `desktop-auto-video-2026-10/`）→ 页首加状态横幅并写明取代者 → 本索引 §10 加一行 → 全局检查断链。**自认已被取代却仍留在 `docs/` 根目录的文档，必须限期迁走。**
