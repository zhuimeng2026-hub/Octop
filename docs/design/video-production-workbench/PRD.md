# Octop 视频生产工作台升级 PRD / Implementation Handoff

> 类型：需求
> 状态：活文档
> 最新核实：2026-11-26
> 目标分支：`feat/video-production-workbench`（从 `develop` 创建，PR 回 `develop`；见 `AGENTS.md` §10 分支与发布）
> 设计依据：`docs/design/product-video-wizard/README.md`、`docs/product-material-library.md`、
> `docs/archive/backend-ai-storyboard-mvp.md`（历史归档）、`docs/remotion-video-pipeline.md`
> 现有落点：`dashboard/src/pages/ProductVideoWizard/index.tsx`、`dashboard/src/pages/LocalVideoWizard/index.tsx`、`brief.ts`，桌面本地渲染桥、后端 product-library storyboard API、Remotion 本地渲染器
> 兄弟文档：桌面端本机素材库与本机向导见 [local-library-wizard.md](./local-library-wizard.md)；
> 桥接动作、状态与错误码见 [桌面视频桥接契约](../desktop-video-bridge-contract.md)
> 平台级产品口径见 [PRD.md](../../PRD.md)

**本文的权威范围**：**四阶段步骤模型的唯一权威**（§2）、双层操作模型的产品不变量（§0.1）、
多平台输出目标规格（§4）、需求级验收判据（§7）。
**不在本文范围**：工程执行切片（在 [backlog.md](../../backlog.md) B-006）、工程流程约束（在 `AGENTS.md` §10）、桥接动作清单（在桥接契约文档）。

---

## 0.1 防回退约束与变更记录（必须先读）

本节是本工作台的产品不变量。后续实现、返工或“简化界面”请求都必须先对照本节；除非产品负责人明确批准并同时更新本 PRD，不得删除、隐藏或替换这些能力。

### 不变量（产品决策）

1. **双层操作不能拆成二选一**：引导模式必须保留一个清晰的默认下一步；专业用户必须能在同一项目、同一草稿中展开“更多参数 / 精细调整 / 多规格输出”。不能用重新创建项目、跳转到旧页面或只保留高级页来代替。
2. **默认值是入口，不是唯一配置**：用途、受众、平台、时长、风格、语言和要求等字段可以有初学者默认值，但高级入口展开后必须仍可编辑，并回显到同一份草稿。
3. **编辑与生成必须可恢复**：精细调整、单目标失败、重新渲染或刷新页面不得清空已选素材和用户手改内容；失败只能影响对应目标，不能覆盖已经完成的成片。
4. **多平台必须是真实规格**：不同画幅必须传递到真实的渲染输入并产出对应像素尺寸；不能只改文件名或在 UI 中假称已生成。

> 不变量 1–4 是产品决策，变更须走本文 §0.1 变更记录；**工程流程约束**（改代码前读哪几节、改完跑什么、什么改动必须由谁批准）已迁至 `AGENTS.md` §10，不在本文重复。

### 变更记录

| 日期 | 变更 | 状态与边界 |
|---|---|---|
| 2026-11-23 | 确立“引导模式 + 同草稿精细工作台 + 多平台输出”的产品决策 | 本 PRD 的规范基线 |
| 2026-11-24 | 本地桌面向导恢复默认下一步、更多参数、精细分镜调整、批量规格状态/重试/ZIP 恢复；增加定向前端与 Go 冒烟测试 | 已实现并验证；桌面壳需重建/重启后加载原生桥 |
| 2026-11-26 | 步骤模型定为**四阶段**并作为唯一权威；修正 §4「多平台逐平台渲染尚未实现」的过时现状陈述；工程切片迁 `backlog.md` B-006；不变量 5 与防误改流程迁 `AGENTS.md` §10 | 已生效 |

若后续出现“又被简化”“高级字段消失”或“失败重试覆盖成片”，应先视为违反本节不变量，而不是重新定义需求；修复时保留用户草稿和已有产物，并新增对应回归测试。

## 1. 决策与非目标

**产品定义**：把视频制作流程升级成「轻量视频生产工作台」。保持普通用户无需懂剪辑仍能一步步出片的默认体验；同时提供可编辑分镜和多平台批量输出。不是 Premiere 式多轨 NLE，不重做授权/产品库/Remotion，也不引入在线高成本视频渲染服务。

**双层操作模型**：默认「引导模式」一步一主按钮；高级「工作台模式」仅在用户主动点击「精细调整」后展开。同一项目、同一草稿数据、同一状态机，切换模式不得复制项目或丢失编辑。

**不退化红线**：继承 `docs/PRD.md` §4.1 S1–S6：桌面登录页/对话框立即出现、微信 SSO、无启动前置向导、视频运行时登录后按需主动检测和安装、绿色版免安装、重依赖不随壳打包。产品视频内部四个业务阶段不属于应用首启 onboarding。

## 2. 步骤模型（唯一权威）

**四阶段是产品视频流程的唯一权威划分**：

| 阶段 | 名称 | 阶段内做什么 | 阶段终点 |
|---|---|---|---|
| 1 | **产品与素材** | 选择已有产品/上传图片；对素材按用途分组（产品正面、细节、场景、品牌、参考），明确哪些只能理解、哪些可出镜；用可见标签呈现已确认卖点 | 素材与卖点确认 |
| 2 | **营销方案** | 选择用途、目标受众、风格、时长、语言、**目标平台多选**；自动推荐画幅/镜头数/开头 Hook；显示「下一步：生成分镜」，可以跳过高级字段 | 需求就绪 |
| 3 | **分镜生产** | 先显示 AI 拟定的镜头顺序与时长、静态素材、文案；默认可以一键「确认并继续」；点击「精细调整」展开三栏工作台（见 §3）。允许在合法范围内调整镜头顺序、素材、字幕文本和时长、镜头技术；逐镜头重新生成必须有显式成本提示与确认 | 草稿保存 → 确认 |
| 4 | **输出交付** | 根据平台选择显示待输出版本，批量渲染任务进度、失败重试与 ZIP/MP4 交付；无可用本机渲染时明确给出 Remotion Studio ZIP，绝不假称 MP4 已生成 | 成片文件交付 |

在引导模式，仅展开当前步骤一个大操作（「下一步」或「生成并继续」），上一步可退回，所有高级编辑放到可选入口。未确认草稿不能下载生产包；编辑已确认稿后清除确认状态。

### 2.1 两套历史步骤名是实现别名，不是另一套流程

代码与旧文档里存在两套五步命名，它们都是四阶段在各自界面上的投影，**不得当作不同的流程来设计或实现**：

| 路径 | 界面步骤名 | 对应四阶段 |
|---|---|---|
| Web 路径（`ProductVideoWizard`，`dashboard/src/pages/ProductVideoWizard/index.tsx`） | 选择产品 → 制作要求 → AI 视频方案 → 确认调整 → 下载制作 | 1 → 2 → 3 → 3 → 4 |
| 桌面本机路径（`LocalVideoWizard`） | 选择素材 → 设置制作参数 → 检查分镜 → 确认渲染 → 查看成片 | 1 → 2 → 3 → 3（含渲染） → 4 |

两条路径的**终点语义不同**：Web 路径的终点是「下载制作包 ZIP → 用户本机 Remotion Studio 出片」；桌面本机路径的终点是「本机直接渲染 → 查看/下载成片」。这一差异只影响交付环节，不改变阶段划分。

> 步骤名的事实定义分别在 [Web 五步向导规范](../product-video-wizard/README.md) 与
> [本机素材库与分步视频制作](./local-library-wizard.md)；阶段划分以本节为准。

## 3. 分镜工作台信息结构

三栏布局（桌面宽度足够时）：
- 左侧：项目素材、筛选、搜索、可用性/来源/授权用途、将素材应用至所选镜头。
- 中间：顶部当前视频预览（可为静态分镜示意，必须明确标记，不得伪装成真实视频）、下方横向镜头列表；顺序、封面、时长、状态标签；选中/添加/删除/复制/上下移动。
- 右侧：镜头属性（素材、文案、字幕、时长、画面比例安全区、运动方式、生成来源），操作「保存当前镜头」「重生成镜头」。
- 底部固定：草稿状态、预计时长、上一步 / 下一步、保存、确认。

窄屏：三栏变为「镜头/素材/属性」标签切换，保持底部主操作可见；支持键盘，焦点样式、错误提示和撤销关键操作。重生成不得覆盖用户手改内容，必须提供新版本预览及采纳/放弃。

素材以 **原始产品/分镜静帧/分镜动态片段/最终成片** 四级资源分类；采用源 ID + 衍生关系（parent_asset_id / scene_id），避免重复上传及引用失效。项目仍只访问所属用户资产；旧项目 snapshot 不应被静默更新，新素材增补需要明确的项目授权/快照版本设计。

## 4. 多平台输出（核心要求）

前端 `dashboard/src/pages/ProductVideoWizard/platforms.ts` 提供 `PLATFORM_KEYS`（douyin、xiaohongshu、channels、kuaishou、bilibili、tiktok、instagram、youtube）与 `PLATFORM_FORMATS`，`OutputStage.tsx` 以 `RenderTarget` 承载输出目标。

> **现状（2026-11-26 核实）**：**逐平台独立渲染已经落地**——
> `remotion/desktop-worker.mjs` 的批量分支对每个 target 以其自身的 `width`/`height`/`fps`
> 调用 `renderProject`（`remotion/src/Root.tsx` 按 script 的尺寸建 Composition），
> 并逐目标发出 `target-start` / `target-complete` / `target-failed`，最后给出 `batch-complete`；
> 桌面桥提供 `start_variants` / `save_batch`（见 [桌面视频桥接契约](../desktop-video-bridge-contract.md)）。
> 因此下文的「输出目标」是**现行规格**，不是待实现项。

定义输出目标：

```ts
type OutputTarget = {
  id: string;
  platform: 'douyin'|'xiaohongshu'|'channels'|'kuaishou'|'bilibili'|'tiktok'|'instagram'|'youtube'|'custom';
  profile: 'short_vertical'|'landscape'|'square'|'custom';
  width: number;
  height: number;
  fps: number;
  language: string;
  filename: string;
  status: 'queued'|'preparing'|'rendering'|'completed'|'failed';
  error?: string;
}
```

> 代码侧对应的载荷类型是 `desktop/src/video.go` 的 `VideoTargetRequest`（`id`/`platform`/`profile`/`width`/`height`/`fps`/`filename`），
> 结果类型是 `VideoOutput`（多出 `status` 与产出尺寸）。`language` 目前不在桥接载荷中，
> 多语言配音属于后续项（见 §7 与 backlog B-006）。

**默认建议**而非固定平台强制标准：短视频 1080x1920 / 30fps；横屏 1920x1080 / 30fps；方形 1080x1080 / 30fps。所有具体平台规则是可版本化 preset，用户可覆盖；不要把 YouTube/B站一概等同仅横屏（Shorts 也可竖屏），Instagram 同理可选 Reels。多平台通常可以合并相同 render profile 避免重复生成；差异化字幕安全区、片尾 CTA 和平台文案时则各自生成变体。

一个源故事板对应多个 **OutputVariant**，包括 crop/contain/blur padding、safe areas、caption layout、localization、BGM 权益约束。每个平台输出独立文件及 manifest.json，UI 必须呈现「预计产物」与真实完成情况。

保持 `script.json` 向后兼容：旧 schema 不支持的字段放在版本化 `output-manifest.json` 或新增可选字段，由渲染入口消费；老式单平台 ZIP 仍应可渲染。不使用「只改文件名」伪造多比例输出；每个变体真实创建对应尺寸的 Remotion Composition/render input。

多平台输出与「直接发布到平台」区分：本期是**多平台规格文件导出**，不做平台 API 自动上传。

## 5. 状态/API/持久化

保留已有 storyboard / projects / auth API。服务端**没有** `output-targets` / `render-batch` 这两个接口——
多目标序列任务由客户端 composition + 桌面桥（`start_variants` / `save_batch`）承担，服务端只保存草稿与 manifest。
**不得宣称已有服务端批量渲染接口。**

- `GET/PUT /api/product-library/projects/{id}/storyboard`：读写故事板。服务端校验镜头类型、时长、授权素材。
- `GET /api/product-library/projects/{id}/storyboard-package` 兼容旧客户端；增加可选多目标导出时仍保持原行为。
- 幂等 job/target 键；部分失败不得覆盖其它成品；断线恢复和按目标重试；取消只影响尚未完成任务。
- 用户隔离所有新增资源和路径，防止通过 asset ID 或 job ID 越权访问。
- 保存时明确 draft version / dirty / confirmed / render snapshot；修改后失效旧版本确认但不删除旧成片。

## 6. 工程执行切片

本文**不再维护**开发切片清单——那是第二份执行清单，违反
[docs/README.md §文档维护规范](../../README.md) 第 1 条。

执行规格统一在 [backlog.md B-006「视频生产工作台剩余项」](../../backlog.md)：
P0A（容器拆分与回归测试）、P0B（精细分镜工作台）、P0C（多平台批量交付）中已完成的部分、
以及剩余项（本机向导的配音/配乐接入、多语言 TTS 与配乐授权、VPW 评测任务集）。

## 7. 测试与验收

基础验证：前端类型检查、相关 RTL/Vitest、生产构建；后端新增路由的鉴权/Schema/隔离测试；Remotion 用最小 mock 素材输出 9:16 / 16:9 / 1:1 并用 ffprobe 实际确认像素尺寸、帧率与时长。

必须覆盖：
1. 新用户一键下一步，未使用高级功能也能生成已确认的制作包；
2. 旧项目、旧版 ZIP、旧 storyboard 可继续使用；
3. 精细编辑并保存，刷新恢复正确，重新确认后可导出；
4. 同时选择 TikTok 9:16、YouTube 横屏 16:9（可另选 Shorts）、Instagram Reels，得到多个不同分辨率文件且字幕不出安全区；
5. 单目标失败不取消其他目标，可单独重试，不谎报成功；
6. 切换账户看不到他人素材、计划、成片；API 不接收越权资产；
7. 未登录不安装重依赖；已登录用户仅主动在视频功能中触发环境检查/安装；桌面壳启动行为不变；
8. 低成本模型/本地渲染不可用时向用户解释可重试/下载 Studio ZIP，不生成假结果。

**验收完成定义**：产品 UI、服务端契约、本地渲染入口均接通且 CI 基础检查通过；真正多平台至少验证两个不同画幅的输出；本期不保证真实平台上传。

**评测任务**：`VPW` 域已登记于 [docs/eval/README.md](../../eval/README.md) §领域前缀，**任务集尚未建立**
（列入 backlog B-006）。
