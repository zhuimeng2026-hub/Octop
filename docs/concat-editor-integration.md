# Concat 视频编辑器接入 Octop PC 客户端：可行性结论

> 类型：参考
> 状态：活文档
> 最新核实：2026-11-28
> 分析对象：`git@github.com:jub0t/Concat.git`（上游 `main` 分支，探测时快照见下方「探测方式」）
> 代码基线：`/opt/Octop` @ `develop`

本文回答一个问题：**Concat 的视频相关界面，能不能接进 Octop 的 PC 客户端，让用户在桌面端使用。**

结论由一次只读探测得出（脚本与证据见文末「探测方式」）。本文只给结论与依据，不含实现清单——
决定动手之后，工作项必须登记进 [backlog.md](./backlog.md)，不在本文另立第二份执行表；
本文的接入开发已登记为 [backlog.md B-008](./backlog.md)。

---

## 1. 结论

**不能直接嵌：Concat 界面是原生 GUI。**

- **同一窗口内直接显示 Concat 界面：不行。** Concat 界面由 80 个 `.slint` 文件构成，编译进 Rust 二进制，
  是原生桌面窗口，不是可被 Octop 页面加载的组件。
- **现实形态：Octop 编排 + Concat 在用户机器上执行。** 剪辑能力随 Concat 二进制下发到 PC，不进服务器。

## 2. 依据（探测到的事实）

| 事实 | 探测结果 |
|---|---|
| Concat 界面技术 | Slint 原生 GUI，80 个 `.slint` 文件，编译进 Rust 二进制 |
| Octop PC 客户端形态 | Wails v3（Go + 系统 WebView），页面是 React 前端 |
| Concat 进程外接口 | **有**：MCP server（`concat --mcp`，stdio 上的 JSON-RPC）+ JSON-RPC socket（`CONCAT_API_ADDRESS` / `CONCAT_API_TOKEN`，默认 7420 端口）+ headless 模式 |
| Concat 工作目录放开 | `CONCAT_MCP_ROOTS`（平台 path-list 语法）可限制/放开可写目录 |
| Concat 引擎绑定 | **全本地**：wgpu / Skia 渲染 + 本机编码（ffmpeg）+ 本地模型下载（`ort`） |
| 许可 | Concat = AGPL-3.0-or-later；Octop = MIT |
| Octop 桌面桥接现有 action | 13 个：`cancel`、`environment_check`、`environment_install`、`environment_status`、`environment_verify`、`get`、`ingest`、`list`、`retry`、`save`、`save_batch`、`start`、`start_variants`（见 [桌面视频桥接契约](./design/desktop-video-bridge-contract.md)） |

## 3. 两条接法

| 路径 | 内容 | 代价 |
|---|---|---|
| **A（推荐）** 双窗口 | Octop 客户端新增「用 Concat 剪辑」入口，桌面壳拉起本机 Concat 进程（`concat --mcp` 或 JSON-RPC socket），用户在 Concat 自己的窗口里剪，导出物回到 Octop 素材库 | 快 |
| B 在 Octop 里重做界面 | React 侧做简化时间轴 / 预览 / 导出界面，后端通过 Concat 脚本接口驱动引擎 | 慢，且能力受 Concat API 覆盖度限制 |

建议先走 **A**：拿到一个可用的客户端入口与产物回流闭环，再决定是否做 B。

## 4. 硬阻碍

- Wails v3 是系统 WebView 页面，**无法在同一个窗口内再开一个原生 Slint 窗口**。双窗口必须做成
  「两个进程两个窗口」的协作体验（进程间通信 + 导出物回流），不是简单的窗口内嵌。

## 5. 差距清单

以下为结论性差距；接入开发已于 2026-11-28 启动，执行条目见 [backlog.md B-008](./backlog.md)：

- [ ] 桌面壳新增桥接 action：发现 / 安装 Concat、启动进程、传工程与导出路径、回收导出物。
- [ ] Concat 需以 MCP / JSON-RPC 方式常驻，并放开工作目录（`CONCAT_MCP_ROOTS`）。
- [ ] Concat 二进制需随客户端分发，或提供下载 / 校验流程（各平台包 + 首次模型下载）；绿色（免安装）形态见 §6，分发口径三候选见 §8。
- [ ] 许可边界：Concat 为 AGPL-3.0-or-later，Octop 为 MIT —— **只能以独立进程调用**，
      不得把 Concat 源码并入 Octop，也不得改其代码后随 Octop 分发。
- [ ] 剪辑 / 渲染依赖用户本机 GPU 与素材（Concat 引擎全本地），**能力无法搬到服务器集中算**。

## 6. 绿色（免安装）分发可行性

**可以，且绿色模式是 Concat 上游内置的**——只是上游 Win 版发布的是安装包，没有发便携 zip。

以下依据来自阅读上游源码与 CI 配置（2026-11-28 核对 `main` 分支快照），不来自 §9 的自动探测。

### 6.1 上游内置的 portable 模式

`concat-host/src/dirs.rs` 的目录解析只有两个分支：

- **默认（Windows）**：设置落在 `%APPDATA%\app.concat.editor`，模型与缓存落在
  `%LOCALAPPDATA%\app.concat.editor`（GB 级模型不随漫游配置走）。
- **portable**：只要 `concat.exe` **同级存在一个名为 `portable` 的目录**，配置与数据全部落在该目录内，
  机器上别处不写任何东西。源码注释原话——「a folder named `portable` beside the executable holds
  both, and nothing is written anywhere else on the machine. That is what makes the zip a portable build」。

portable 分支在目录解析的最前面，窗口、MCP、headless 各入口共用同一套 `AppDirs`，因此三种运行方式
都遵守「只写这一个目录」。

### 6.2 上游 Win 发布形态与绿包的做法

上游 Win 发布物只有两个安装包：`Concat-<ver>-windows-x86_64-setup.exe`（Inno Setup，
`PrivilegesRequired=lowest`，可装到用户目录）与 `.msi`（WiX，供管理员批量部署）。
CI 明确不发布那个自带全部 DLL 的目录（注释：the two installers are）。

因此做绿色包只能在 Windows 上二次组装：安装到用户目录 → 整个安装目录搬进自建文件夹 →
同级建空的 `portable` 目录 → 打包 zip。Linux 侧上游有 AppImage，本身就接近绿色形态。

### 6.3 Win10 上的具体注意点

| 事项 | 结论 |
|---|---|
| 依赖 DLL | 自带：ffmpeg、`onnxruntime.dll`（exe 同级）、whisper/ggml 分代 CPU 模块。CI 的 Windows 冒烟测试强制「每个导入的 DLL 要么在包内、要么是 Windows 自带」，PATH 只留 Windows 目录也能 `--version` / `--smoke` 起来 → 干净 Win10 可跑 |
| CPU 基线 | 兼容到 Ivy Bridge（AVX，无 AVX2），CI 用 Intel SDE 专门模拟过；**仅 x86_64**，上游已撤掉 ARM64 Windows 构建（启动即段错误） |
| GPU | wgpu 走 D3D12 / Vulkan；Slint 同时启用 `renderer-software` 与 `renderer-skia`，**有 CPU 合成回退** → 显卡驱动差的机器仍能开界面，但 GPU 合成与导出走不了高速路径 |
| AI 抠像 / 语音克隆 | **Windows 上跑 CPU**：上游选用 Microsoft 的 CPU 版 onnxruntime（DirectML 版停在 API 24，而 ort 2.0.0-rc.13 要求 API 27），上游注释明确 cutouts 与 Chatterbox 在 Windows 上走 CPU |
| 模型 | 首启联网下载（GB 级），绿色包不含模型；离线包须预置模型 |
| 注册表 / 服务 / 自启 | 无。源码中的注册表访问全是只读（读 Windows 版本号） |
| 签名 | 自制 zip 无法以「Concat 发布者」身份签名 → SmartScreen / 杀软报「未知发布者」。Octop 侧同一问题见 [desktop-bootstrap-installer.md](./desktop-bootstrap-installer.md) 的风险表 |
| WebView2 | **不需要**：Concat 是原生 Slint 窗口。而 Octop 客户端在 Win10 上可能缺 WebView2 Runtime，需 bootstrapper 拉取 |

### 6.4 与路径 A 的合流

路径 A 做成全绿是自洽的：Octop 绿色包（thin 内核绿色包形态）+ 同级目录 `concat-portable/`
（内含 `portable/` 数据目录），桌面壳拉起 `concat.exe --mcp` 或连 7420 socket，
导出物落到指定目录回 Octop 素材库 —— 全程免安装、无系统级写入，符合桌面壳产品红线
（见 [PRD.md](./PRD.md) §4.1 S1–S6）。

## 7. 不建议

- 不建议把 Concat 源码或 `.slint` 界面移植进 Octop：AGPL 许可 + Rust ↔ Python/TS 技术栈 + 体量三重阻力。

## 8. 未决事项与已决口径

> 这里的「未决」= **还没决定要不要动手**。本文只给结论与依据；决定动手之后，执行规格才会落到
> [backlog.md](./backlog.md)（一条待办一个落点），不在本文另立第二份执行表。

| 问题 | 状态 | 说明 |
|---|---|---|
| **是否启动 Concat 接入（编辑版）开发**（即路径 A 双窗口） | **已决 · 启动**（2026-11-28） | 执行条目已登记为 [backlog.md B-008](./backlog.md) |
| **Concat 二进制的分发口径**（三选一，见下表） | **已决 · 乙（客户端按需下载并校验）**（2026-11-28） | 打包与发布管线见 [scripts/concat-engine/](../scripts/concat-engine/README.md) |

### 8.1 三种分发渠道差在哪

三条**共同的底座**（先排除混淆）：Concat 始终是**独立进程**调用（AGPL 要求，不改其代码、不并入源码）；
Concat 本身是绿色包（exe 同级建 `portable` 目录 → 设置 / 模型 / 缓存全在里面，不写系统）；
编辑能力都在用户机器上跑，服务器不参与计算。真正的差别在四件事上：**谁背 AGPL 分发义务、包体多大、
首次体验、谁负责版本兼容**。

| 维度 | 甲 随 Octop 绿色包一起分发 | **乙 客户端按需下载并校验（已选）** | 丙 用户自备 |
|---|---|---|---|
| 做法 | 绿包内放 `concat-portable/`，桌面壳直接拉起 | 复用 `environment_install` / `environment_verify` 那套下载 + 校验链，首次点「用 Concat 剪辑」时拉取 | 文档写清「自己装 Concat 或解压便携目录」，Octop 只做路径探测与拉起 |
| AGPL 分发义务 | **我们承担**（分发二进制 → 提供对应源码获取方式） | **我们承担**（同甲，不比甲多背） | **上游承担**（用户自己从上游获取） |
| 主包体 | **大**（引擎 + ffmpeg + onnxruntime + whisper，量级上百 MB，冲掉 thin 内核的定位） | **不变**（thin 仍 ~13 MB，引擎按需） | 0 |
| 首次使用 | 即开即用、离线也行（**但模型 GB 级，仍要联网下**） | 一次下载（可后台化、不阻断界面，符合 S1/S4），下载后离线可用 | 用户自己下载、解压、建 `portable` 目录、可能还要下模型 |
| 版本兼容 / 更新 | Concat 升级 = 重发整个 Octop 包；回滚也要重发 | 引擎版本独立成线，可灰度、可回滚，不用重发整包 | 靠用户；版本可能不匹配，兼容矩阵由我们兜底 |
| 工程量 | 中（打包脚本 + 包体管理） | 中（复用既有下载校验链 + 引擎 manifest） | 小（探测 + 文档） |
| 实际可用率 | 高 | 高 | **低**（多数用户装不懂便携目录） |
| 签名 | 自制 zip 无法以 Concat 发布者身份签名 → SmartScreen 报「未知发布者」 | 同甲（整包签名可覆盖下载下来的引擎另说，但引擎本身未改上游签名仍有效） | 无此问题 |

**为什么选乙**

1. **不动包体与产品红线**：thin 内核绿色版是主推形态（PRD §4.1 S1–S6），往里塞百 MB 级引擎会让整个交付口径变形；
2. **工程量最小**：`environment_install` 的下载 + 校验链已在生产上跑着（manifest / 分片 / sha256 / 多节点 failover），复用即可；
3. **AGPL 成本与甲相同**：甲乙都要提供源码获取方式，乙只省包体、**不多背法律负担**；
4. **版本可控**：引擎可独立灰度与回滚，不牵动主包发布节奏。

甲只在「完全离线、必须零等待」的极端场景才值得。丙**不建议作为唯一路径**，但可作为兜底：
下载失败时让用户手动指一个 Concat 目录仍可用（已写进 B-008 的「失败降级」）。

**乙 的一个更干净变体**：让**上游自己发布便携 zip**。Concat 代码已内置 portable 模式、CI 里也已构建出那个
自带全部 DLL 的目录，只是 release 没发它；请上游把 portable zip 放进 release，客户端从上游 release 直拉，
我们连分发义务都不承担（只是下载），版本天然跟随上游。**当前实现仍按「我们自己打包并托管」**，
但客户端的下载源应做成可配置的，上游一旦发布便携 zip 即可切换。

> 无论甲乙丙，只要**分发 Concat 二进制**，AGPL 的源码提供义务就在我们身上。引擎 manifest 的 `source`
> 字段因此固定带上 `repo` + `tag` + `installerSha256`，客户端展示时必须把它呈现给用户。
> 若将来要改 Concat 的代码再分发，就必须在包里附带修改说明与源码。

### 8.2 落点

口径落到本文 §5 与 §6，工程执行项登记进 [backlog.md](./backlog.md)；若产生跨层取舍，再考虑写 ADR（见 [adr/](./adr/)）。

## 9. 探测方式（可复现）

- 探测脚本：`/opt/octop-work/concat-analysis/analyze_concat.sh`（阶段化 + 幂等重入）
- 判定脚本：`/opt/octop-work/concat-analysis/analyze.py`
- 证据目录：`/opt/octop-work/concat-analysis/out/facts/`（原始探测输出，逐条可查）
- 报告产物：`/opt/octop-work/concat-analysis/out/REPORT.md`、`out/summary.json`
- 重跑：`env -i PATH=/usr/bin:/bin HOME=/root /bin/bash /opt/octop-work/concat-analysis/analyze_concat.sh`
  （`--restart` 重新采集全部阶段）

探测为**只读**：只读 `/opt/Octop`（`desktop/`、`docs/`、`src/octop/`、`dashboard/`），不改动任何代码。

## 10. 相关文档

- [桌面视频桥接契约](./design/desktop-video-bridge-contract.md) —— 现有桥接 action、状态机、错误码、ZIP 安全不变量
- [视频生产工作台 PRD](./design/video-production-workbench/PRD.md) —— 四阶段步骤模型的唯一权威
- [本机素材库与本机视频向导](./design/video-production-workbench/local-library-wizard.md) —— 桌面本机路径的落点
- [PRD.md](./PRD.md) —— 产品需求总纲
