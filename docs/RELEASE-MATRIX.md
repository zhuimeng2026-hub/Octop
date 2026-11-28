# Octop 交付形态与渠道矩阵

> 文档类型：产品交付/发布参考（Release & Delivery Reference）
> 状态：活文档，最新核实 2026-11-28
> 代码基线：分支 `develop`
>
> 本文固化「有哪些客户端形态、各自怎么构建、发到哪里、版本如何对齐」。
> 这些事实此前散落在 CHANGELOG、多个 `docs/desktop-*.md` 与构建脚本中，容易误用。
> 产品定位与需求见 [PRD](./PRD.md)；构建步骤与本机坑见 [桌面 Windows 构建](./desktop-windows-build.md)。

---

## 1. 三种桌面客户端形态

桌面壳的构建由 `desktop/src/build/windows/Taskfile.yml` 的 `BUILD_FLAGS` 决定，
三个变量组合出三种形态：

| 形态 | 判定条件 | Go 构建标签 | 内嵌内容 | 产物体积 |
|---|---|---|---|---|
| **full**（自包含） | 无 `DEFAULT_SERVER_URL`、无 manifest URL | `production` | 内嵌完整 portable 运行时 + 前端 + 后端 | ~177 MB |
| **thin**（远程壳） | 有 `DEFAULT_SERVER_URL` | `production,thin` | 仅启动壳/资源，**前端走远程服务器** | ~13 MB |
| **slim**（瘦壳 + 下载运行时） | 有 `PORTABLE_RUNTIME_MANIFEST_URL` | `production,thin,downloadruntime` | 启动壳 + 登录，运行时首启从 CDN 分片下载 | ~13 MB |

> ⚠️ **最容易踩的认知坑**：`thin` 与 `slim` 的 exe 都**不含聊天 UI**。
> - `thin` 的 UI 完全由远程服务器（如 `ocbot.aixifs.com/videogen`）提供 —— 改前端必须部署服务器，重打 exe 不会带回新 UI。
> - `slim` 的 UI 在下载的 `app` 分片里 —— 要看新 UI 必须更新 CDN 上的分片。

### 1.1 当前已构建的产物

| 文件 | 体积 | 形态 | 构建时间 |
|---|---|---|---|
| `Octop-desktop-full-windows-amd64-1.4.0.exe` | 177 MB | full | 2026-11-19 |
| `Octop-desktop-slim-windows-amd64-1.4.0.exe` | 13 MB | slim | 2026-11-19 |
| `Octop-desktop-windows-amd64-1.4.0.exe` | 13 MB | thin（远程） | 2026-11-19 |
| `Octop-portable-windows-amd64-1.4.0.zip` | 164 MB | portable 运行时包 | 2026-11-19 |

### 1.2 何时用哪种

> ⚠️ **产品红线优先**（2026-11-20 修正）：默认/唯一主推分发形态是 **thin 内核的绿色版**——
> 固定连 `https://ocbot.aixifs.com/videogen`、走该后端**已实现的微信开放平台 SSO**，界面立即打开、
> 无引导、依赖登录后按需；以「`Octop.exe` +（可选）同级 `video-runtime/`」目录/压缩包交付，
> **双击即跑、免安装、不写系统**；构建时烘焙**多节点** manifest URL（逗号分隔），
> 使登录后的「一键安装」能从 CDN 拉取渲染引擎——**重依赖不进包、不阻断启动**。
> 这是 [PRD §4.1](./PRD.md#41-桌面壳启动登录形态与功能的六条产品硬约束红线) 的 S1–S6 硬约束。
> **不再产出 NSIS 安装器**（违反 S5）；slim/full 仅作离线/内网备选，且同样以绿色版交付。

| 场景 | 推荐形态 | 原因 |
|---|---|---|
| **默认 / 唯一主推分发** | **thin 内核绿色版** | 双击即跑、免安装；界面立即打开、固定后端登录、无引导；渲染引擎剥离出包、登录后按需下载（满足 PRD §4.1 S1–S6） |
| 离线 / 无网络环境 | **full 绿色版** | 自包含，不依赖网络（备选；解压不得阻塞开界面） |
| 内网/离线、需本机运行时且接受首启下载 | **slim 绿色版** | 运行时按需下载（非默认；下载必须后台化，否则违反 S1/S4） |
| 本地复核新 UI（无网络依赖） | **full** | 内嵌新前端，可直接看效果 |

---

## 2. 运行时分片与多节点下载

### 2.1 设计原则

slim 首启下载运行时，采用**分层 + 多分片 + 多节点**策略：

- **下载器无需开发**：`desktop/src/bootstrap/` 已支持多分片、断点续传、SHA256 校验、
  多 URL failover（并在视频组件上生产验证）。
- **真正减体积靠依赖瘦身**（PR-0），单纯切分片不减总下载量 —— 详见
  [分层下载任务书](./desktop-runtime-layered-download-task.md) 与设计权威文档
  [桌面引导安装器](./desktop-bootstrap-installer.md)。

### 2.2 分片结构（当前 manifest）

| part | 体积 | required | 说明 |
|---|---|---|---|
| `runtime` | ~21 MB | ✅ | Python 运行时核心 |
| `deps-core` | ~91 MB | ✅ | 核心依赖 |
| `app` | ~22 MB | ✅ | Octop 应用 + 前端（含 CNB 新 UI） |
| `deps-google` | ~0.5 MB | ❌ | 可选，触发相关功能时按需装 |
| `deps-boto` | ~14 MB | ❌ | 可选 |
| `deps-lark` | ~2.6 MB | ❌ | 可选 |

> 路径：`runtime-shards/1.4.0/windows-amd64/`；manifest 内每 part 有 2 个 URL。

### 2.3 URL 两档兜底（只认域名 dw.mengxa.com）

客户端对多个 URL 逐个尝试，第一个返回 200 且 SHA256 校验通过即采用，失败自动切下一个：

```
https://dw.mengxa.com/...   （主，HTTPS 域名）
http://dw.mengxa.com/...    （兜底）
```

> 2026-11-20 起 manifest 不再写 IP 直连地址（原第三档 `http://175.178.192.87/...` 已删除），
> 全部 URL 统一用 `dw.mengxa.com` 域名。前提是 DNS 里每个节点在 HTTP 上都真的出文件：
> 1.14.182.208 原先 80 端口整站 301，客户端用 IP 直连时 Host 匹配不到站点、落到 default
> server → 404；现已改为 80 端口直接提供 `/video-components/`、`/runtime-shards/` 文件。

**容错能力**：任意一个 scheme 失效时，客户端自动从仍有效的源下载。该行为由
`bootstrap_test.go` 中「坏源自动切好源」的用例保护。

### 2.4 节点现状（dw.mengxa.com）

| 节点 | HTTPS | HTTP | 分片文件 | 角色 |
|---|---|---|---|---|
| 175.178.192.87 | ❌ | ✅ | ✅ | HTTP 兜底源 |
| 1.14.182.208 | ✅ | ✅ 2026-11-20 起直接出文件 | ✅ | HTTPS 主源 + HTTP 兜底 |
| 175.178.33.107 | ✅ | 301→HTTPS | ✅ | HTTPS 主源 |
| 8.134.147.195 | ❌ | ❌ 403 | ❌ | 不服务 dw —— 必须从 DNS A 记录移除 |

> DNS 轮询 4 个 IP，SSH 端口 13122。已给两台 HTTPS 节点加 `/runtime-shards/` location 放行；
> `https://dw.mengxa.com/...manifest.json` 经 DNS 轮询返回 200，Range 续传返回 206。

### 2.5 分发脚本

`scripts/release-video-components.sh` 支持两种产物：

- 默认 `--kind component`：视频组件 `*.zip`
- `--kind runtime`：运行时分片 `*.tar.gz`（本次新增，调 `pack_portable_shards.py`）

两者共用多节点 scp + 逐台 sha256 校验 + HTTP 探活逻辑。
**坑**：脚本无 `--out-dir` 参数（用 `OCTOP_VC_OUT_DIR` 环境变量）；
`--base-url` 不要带平台段（pack 会自动追加 `<plat>/`）。

---

## 3. 分发渠道

| 渠道 | 内容 | 约束 |
|---|---|---|
| **GitHub Release** | 运行时 zip（246 MB）、安装包 | 无 100 MB 限制 |
| **CNB**（cnb.cool） | 镜像 + quality-gate（仅 main:push/tag） | 推任意 tag 触发整条发行流水线 |
| **Gitee**（`https://gitee.com/webheat/octop_client.git`） | **客户端构建产物直接发布到此仓库**（Release 附件） | 单附件 100 MB 上限；slim exe 与 Python 包**不**上 Gitee |
| **dw.mengxa.com** | 运行时分片 + 视频组件（多节点 CDN） | 客户端按需下载 |

> **Gitee 发布仓口径**：客户端构建产物**直接发布到
> `https://gitee.com/webheat/octop_client.git`**（`owner=webheat`，`repo=octop_client`），
> 以该仓库的 Release 附件形式交付。源码仍只在 GitHub / CNB，此仓库只放客户端产物。

> Gitee 分发范围收窄是明确决定：完整安装器 200–340 MB 超 100 MB 上限，故改 slim 首启拉运行时；
> 下载页与 Release 说明都按 tag/owner/repo 动态渲染，防止指向旧版本。

---

## 4. 版本基线（分叉说明）

仓库内版本号存在分叉，发布/引用时须明确指哪一份：

| 来源 | 版本 | 用途 |
|---|---|---|
| `CHANGELOG.md` / README badge | **1.5.1** | 对外发布版本（2026-11-25） |
| 生产部署 ref | `main` | 线上 `/opt/Octop` checkout 到 `main` 分支（tip 即 `v1.5.1` tag 所在提交）；见 [wip-branch-workflow.md §5.1](./wip-branch-workflow.md) |
| `pyproject.toml` | 1.4.0 | Python 包版本 |
| 桌面构建脚本 / exe 文件名 | 1.4.0 | 桌面客户端版本 |
| `desktop/.../info.json` | 0.9.26 | Windows 文件版本资源（历史遗留） |

> 影响：分发时以 CHANGELOG/README 的 1.5.1 为对外口径；制品文件名沿用 1.4.0。
> 两者不一致是历史状态，非笔误。

---

## 5. 发布前检查清单

- [ ] 前端代码改动已构建并部署（远程壳改服务器；slim 改 CDN 分片；full 重新内嵌）
- [ ] 后端改动已同步（服务器 editable 安装 `git pull` + `systemctl restart`，或精准补丁）
- [ ] 下载链路逐节点探活：manifest 200、分片 Range 206、各节点 sha256 一致
- [ ] exe 内嵌 URL / sha256 / 版本资源校验通过（见 [Windows 构建文档](./desktop-windows-build.md)）
- [ ] full exe（>100 MB）不走 Gitee 附件，改本地分发或外链
- [ ] 版本号口径按 §4 对齐；Gitee 下载页 tag 指向本次发布
- [ ] 数据库已备份（部署前）
- [ ] 启动方式：GUI exe 须经 `.bat` → explorer 在用户会话启动（工具会话直拉 WebView2 会崩溃）

---

## 6. 两条产品线的并行安排（2026-11-28 定）

产品线上会同时存在两条：**极简一键生成版**（现行主推，thin 内核绿色版）与
**带编辑界面的新版本**（在建，接 Concat 引擎；可行性结论见
[Concat 接入结论](./concat-editor-integration.md)）。

**安排口径**：两条线是**同一份代码的不同交付形态**，用「同一仓库 + 同一条 `main` + 两个版本号段」表达，
**不得**用两个仓库或两条长期主干来表达。

| 层 | 极简一键生成版 | 带编辑界面的新版本 |
|---|---|---|
| 仓库 / 主干 | 同一仓库、同一 `main` | 同左 |
| 开发 | `main` 保持可发布 | `feature/desktop-editor` → PR → `develop` |
| 发布 | `release/1.x.y` → PR → `main` → tag `v1.x.y` | `release/2.0.0` → PR → `main` → tag `v2.0.0` |
| 分发产物 | thin 内核绿色版（**不含** Concat 引擎） | 同一 thin 壳 + 编辑入口 + Concat 引擎**按需下载并校验**（口径已定为「乙」，见 §6.2） |
| CNB 上的载体 | 同一仓库、同一条 `main`，按 tag 区分下载页 | 同左 |

### 6.1 规则（规范性）

1. **MUST NOT** 为两条产品线开两个仓库或两条长期主干。
2. 版本 MUST 用同一 tag 序列表达（`v1.x.y` / `v2.0.0`）；**MUST NOT** 用仓库名或分支名表达版本。
3. 合并 MUST 在 **GitHub（权威源）** 执行。CNB 侧只开合并请求作协作入口，
   **MUST NOT** 在 CNB 直接合并——镜像是单向的（GitHub → CNB），CNB 上的合并不会回流 GitHub，
   且会让镜像推送被拒绝、镜像工作流变红。详见 [CNB 镜像](./cnb-mirror.md)。
4. 功能分支 MUST 两边都推（`git push origin <branch>` 与 `git push cnb <branch>`）。
   本仓是 fork，**push 事件不触发 workflow**，镜像实际靠 `pull_request` 事件与每日 02:30 的兜底 cron
   同步，单推一侧会让 CNB 落后。
5. `main` MUST 只接受 `release/*` 与 `hotfix/*` 的 PR（`.github/workflows/restrict-pr-authors.yml`）。
   因此编辑版进 `main` 前 MUST 先切 `release/2.0.0`。
6. 生产部署 MUST 只认 `main` 上的 `v*` tag（[wip-branch-workflow.md §5.1](./wip-branch-workflow.md)）。
   编辑版在打出自己的 tag 之前 MUST NOT 上生产；极简版照常发 `1.x`。
7. 协作跟踪 MUST 走 CNB 的 Issue/PR；工程执行规格 MUST 只落 [backlog.md](./backlog.md)
   （一条待办一个落点）。建议用 label 分线：编辑版 `editor-2.0`、极简版 `thin-1.x`。

### 6.2 未决事项（待决）

| 问题 | 落点 |
|---|---|
| **是否启动 Concat 接入（编辑版）开发** | **已决 · 启动**（2026-11-28）；执行条目 [backlog.md B-008](./backlog.md) |
| Concat 引擎分发口径三选一（随包 / 客户端按需下载校验 / 用户自备） | **已决 · 乙（客户端按需下载并校验）**（2026-11-28）；三渠道差异与选型理由见 [concat-editor-integration.md §8.1](./concat-editor-integration.md) |

> 长期双主干（一条 1.x 维护线 + 一条 2.x 迭代线，类似 LTS）**暂不采用**：
> 只有当编辑版确实需要长期与极简版分叉演进时才重新评估。

---

## 7. 相关文档

- [PRD](./PRD.md) — 产品需求
- [桌面 Windows 构建](./desktop-windows-build.md) — 构建流程与本机坑
- [分层下载任务书](./desktop-runtime-layered-download-task.md) — PR-0/PR-1 待办与代码位置
- [桌面引导安装器设计](./desktop-bootstrap-installer.md) — 方案与路线图权威文档
- [CNB 镜像](./cnb-mirror.md)、[Gitee 发布](./gitee-release.md) — 渠道细节
- [Concat 接入结论](./concat-editor-integration.md) — 带编辑界面的新版本（2.x 线）的可行性结论与分发口径候选
- [wip-branch-workflow.md](./wip-branch-workflow.md) — 分支隔离、tag 与生产部署来源的口径
- [CHANGELOG](../CHANGELOG.md) — 版本变更记录
