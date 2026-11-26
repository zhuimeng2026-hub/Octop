# 桌面视频桥接契约（现行）

> 类型：规范
> 状态：活文档
> 最新核实：2026-11-26
> 代码基线：`/opt/Octop` @ `develop`（`desktop/src/video.go`、`desktop/src/video_bridge.go`、`desktop/src/library_bridge.go`）
> 取代关系：取代 [archive/desktop-auto-video-2026-10/](./../archive/desktop-auto-video-2026-10/) 下的
> `contract.md` / `environment-contract.md` / `manual-components.md`——那三份记录的是**已被代码推翻**的
> 旧分发与桥接形态（随包分发运行时 → 手动安装组件 → 一键自动安装，三轮反转），继续沿用会误导实现。
> 仍有效的安全不变量已迁入本文 §5，并保持原意不变。

本文只回答一件事：**桌面壳与前端之间的视频/素材桥接，现在到底有哪些动作、什么状态、什么错误码、
哪些安全不变量不得破坏。** 产品口径见 [PRD.md](../PRD.md)，步骤模型见
[工作台 PRD](./video-production-workbench/PRD.md)，本机路径的产品落点见
[本机素材库与分步视频制作](./video-production-workbench/local-library-wizard.md)。

---

## 1. 传输层

桌面壳只向**自己配置的 Dashboard origin/base path** 注入桥接对象：

```js
window.octopDesktopVideo = {
  version: 1,
  outputBatchVersion: 1,
  environmentVersion: 1,
  minimalMode: false,
  environmentInstallerURL: "<首个 manifest 镜像 URL>",
  request(action, payload): Promise<result>,
};
```

- 走既有 `_wails.invoke` 事件通道，**不加载远程 Wails 运行时脚本**；壳侧用 nonce 保护传输。
- 回调错误只带受控错误码，**不得携带凭据或任意命令输出**。
- `environmentInstallerURL` 只给前端**第一个**可达镜像；完整镜像列表留在 Go 侧，安装器逐个尝试。
- 能力探测必须检查 `version` / `outputBatchVersion` / `environmentVersion`，不能只看 `_wails` 是否存在。

## 2. 动作清单

### 2.1 视频桥（`desktop/src/video.go`）

| action | payload | result | 说明 |
|---|---|---|---|
| `environment_check` | `{token}` | 环境状态 | 探测本机渲染运行时 |
| `environment_verify` | `{token}` | 环境状态 | 复检已安装的运行时 |
| `environment_status` | `{token}` | 环境状态 | 读取当前状态，不触发安装 |
| `environment_install` | `{token}` | 环境状态 | **一键安装**：从 manifest 镜像列表拉取渲染引擎到 exe 同级 `video-runtime/` |
| `start` | `{token, projectId}` | `VideoJob` | 单目标渲染 |
| `start_variants` | `{token, projectId, targets[]}` | `VideoJob` | 多目标渲染（多平台规格） |
| `list` | `{token}` | `VideoJob[]` | 列出当前用户的任务 |
| `get` | `{token, jobId}` | `VideoJob` | 读取单个任务 |
| `cancel` | `{token, jobId}` | `VideoJob` | 取消（只影响尚未完成的目标） |
| `retry` | `{token, jobId}` | `VideoJob` | 重试失败目标，不覆盖已完成的成片 |
| `save` | `{token, jobId}` | `{saved: boolean}` | 原生保存对话框导出单个 MP4 |
| `save_batch` | `{token, jobId}` | `{saved: boolean}` | 原生保存对话框导出多目标 ZIP |

### 2.2 素材桥（`desktop/src/library_bridge.go`）

| action | 说明 |
|---|---|
| `list` | 本机素材列表 |
| `pickFiles` / `pickDirectory` | 原生文件/目录选择框 |
| `ingest` | 导入本机图片（复制到本机素材库） |
| `recognizeExisting` | 对已导入但未识别的素材重新发起识别 |
| `updateMeta` | 更新素材元数据 |
| `archiveGroups` | 确认分组归档 |
| `listProducts` / `productAssets` | 本机产品与素材查询 |
| `remove` / `read` | 删除与读取本机素材 |
| `renderLocal` | 本机渲染编排（读本机素材目录组装 `assets/`） |
| `saveLocal` / `saveLocalBatch` | 本机成片保存（单个 / 批量） |
| `jobStatus` | 本机渲染任务状态 |

## 3. 数据形状与状态机

`VideoJob`：

```ts
{ id, projectId, ownerId, name, state, progress?, errorCode?, videoUrl?, updatedAt, targets? }
```

- `state`：`preparing | downloading | rendering | saving | completed | failed | cancelled | interrupted`。
- `progress`：仅对可度量的当前阶段给出 0–1；**不得编造整体百分比**，不可测时为 `null`。
- `updatedAt`：Unix 秒。`name` 来自校验过的项目/脚本元数据。
- `videoUrl`：**仅**对已完成且通过属主鉴权的任务提供；本地回环流支持 Range，使用不可猜测的能力串，
  **不做任意文件访问**。
- `targets[]`（多目标）：`{ id, platform?, filename, width, height, fps, status }`；旧任务 `targets` 为空，
  继续只暴露 `videoUrl`。

`VideoTargetRequest`（`start_variants` 的入参）：`{ id, platform?, profile?, width, height, fps, filename }`。

- 属主从已认证的服务端 `/api/auth/me` 解析，**不信任客户端上报的 owner ID 或任意下载 URL**。
- 服务端 base 由壳固定；项目 ID 会被校验。凭据只留在内存，不进任务文件与日志。
- 重复 `start` 复用同一 project/script 的活动或已完成任务；新的已确认脚本版本是独立结果。
- 同一时间只跑一个渲染；冲突的 `start` 返回 `BUSY`，**不引入队列**。
- 任务状态持久化在壳自有、按属主隔离的目录；真正退出导致运行中任务变 `interrupted`（可重试）。
  登出或换账号时隐藏任务，**鉴权在壳侧再执行一次**。

### 3.1 多目标渲染事件流

`desktop-worker.mjs` 以 JSONL 输出，前端按 `targetId` 归位：

```
{ type: "stage",      stage: "preparing" | "rendering" | "saving" }
{ type: "progress",   progress: 0.5 }
{ type: "target-start",    targetId }
{ type: "target-complete", targetId, output, bytes, duration, width, height, fps }
{ type: "target-failed",   targetId, errorCode, message }
{ type: "batch-complete",  succeeded, failed, outputs[] }
{ type: "complete",   output, bytes, duration }
{ type: "error",      code: "RENDER_FAILED" }
```

**每个 target 以自己的 `width`/`height`/`fps` 真实渲染**（`remotion/desktop-worker.mjs` 逐 target 调用
`renderProject`），不得用改文件名的方式伪造多规格产物。单个 target 失败**不影响**其它 target，
`batch-complete.failed` 报告失败数；取消只影响尚未完成的目标。

## 4. 错误码

视频桥：`AUTH_REQUIRED`、`NOT_FOUND`、`PLAN_NOT_CONFIRMED`、`PLAN_CHANGED`、`BUSY`、`DOWNLOAD_FAILED`、
`PACKAGE_INVALID`、`RUNTIME_UNAVAILABLE`、`RENDER_FAILED`、`SAVE_FAILED`、`CANCELLED`、`INTERNAL`。

素材桥：`AUTH_REQUIRED`、`LIBRARY_NOT_FOUND`、`LIBRARY_INVALID`、`LIBRARY_IO`、`INTERNAL`、`CANCELLED`、
`RUNTIME_MISSING`、`SAVE_FAILED`、`BUSY`、`INVALID_TARGETS`、`BATCH_UNAVAILABLE`。

前端负责把这些码映射到 zh/en 文案，**不得直接透出裸码**。

## 5. 安全不变量（不得破坏）

1. **ZIP 只读、不执行**：从服务端取得的制作包 ZIP 中**只读取** `script.json`、`manifest.json`
   与被引用的 `assets/`；校验 manifest 的 project ID / SHA256 / 大小，拒绝路径穿越与符号链接；
   **绝不执行 ZIP 内的脚本、启动器或渲染器目录**。
2. **完成判定**：任务只有在**渲染进程成功退出**且**校验出非空 MP4** 之后才算完成，
   不是「帧数到 100%」就算完成。
3. **可信运行时**：渲染只在 `video-runtime/`（exe 同级，开发可用 `OCTOP_DESKTOP_VIDEO_RUNTIME` 覆盖）
   内运行固定模板；不拼用户提供的 shell 命令；worker 只用自带模板。
4. **凭据不落盘**：token 不进任务文件、不进日志。
5. **属主鉴权两处都做**：服务端判一次，壳侧再判一次。
6. **组件安装按需**：运行环境探测与安装发生在**登录之后、用户主动触发**；未装运行时不影响其余功能。

## 6. 与其它文档的关系

| 关心什么 | 去哪看 |
|---|---|
| 产品口径、桌面六条红线、素材与数据所有权 | [PRD.md](../PRD.md) |
| 四阶段步骤模型、多平台输出规格、防回退不变量 | [工作台 PRD](./video-production-workbench/PRD.md) |
| 本机素材库与本机五步的产品落点 | [本机素材库与分步视频制作](./video-production-workbench/local-library-wizard.md) |
| 服务端接口契约 | [api.md](../api.md) |
| 旧方案（已归档，勿据此实现） | [archive/desktop-auto-video-2026-10/](../archive/desktop-auto-video-2026-10/) |
