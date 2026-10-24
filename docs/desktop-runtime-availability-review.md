# 桌面端运行时可用性复核（缺环境时会怎样）

> 复核对象：分支 `fix/backend-mvp-v01-integration`，提交 `d4ea5e0f`
> 复核时间：2026-10-25
> 复核范围：桌面壳依赖的两层运行环境
> 1. **层一** 便携 Python 运行环境（`portable` / `Octop-portable-<plat>-<ver>.zip`）
> 2. **层二** 本机视频渲染环境（`video-runtime`，Node + Remotion worker）
>
> 本文只做事实复核与缺陷登记，不改动实现。请开发按 [§五 核对清单](#五核对清单给开发逐条回执) 逐条回执。

---

## 一、结论摘要

| 层级 | 缺失时的行为 | 是否联网下载 | 错误可读性 |
|---|---|---|---|
| 层一 便携 Python 环境 | 明确报错并中止启动 | **否** | 好（给出缺失的 zip 文件名） |
| 层二 本机渲染环境 | 任务先跑完"下载 + 解压 + 校验"再失败 | **否** | 差（文案无指导性，且无日志） |

两层的共同点：**都不做网络下载，也都没有启动前预检**。层一失败得快、说人话；层二失败得晚、说废话。

需要额外说明的是：本仓库里存在一份"首启分片下载运行时"的设计稿
（[`desktop-bootstrap-installer.md`](./desktop-bootstrap-installer.md)，第 6 行自述 **"状态：设计稿，未实现"**），
但该能力**在当前分支并不存在**：没有 `desktop/src/bootstrap/` 目录，没有 `manifest.json` 的生成或解析代码。

---

## 二、层一：便携 Python 运行环境

### 2.1 来源（三条，全部本地）

| 优先级 | 来源 | 代码位置 | 适用场景 |
|---|---|---|---|
| 1 | 环境变量 `OCTOP_DESKTOP_PORTABLE_ZIP` 指向的本地 zip | `desktop/src/download.go:236` `bundledPortableZip()` | 调试、手工指定 |
| 2 | 编进可执行文件的 `//go:embed bundled/portable.zip` | `desktop/src/embed_portable_embedded.go:10`（build tag `production && !darwin`） | Windows / Linux 正式发布 |
| 3 | exe 同级目录或 `../Resources` 下的 `Octop-<plat>.zip`、`Octop-portable-<plat>-*.zip` | `desktop/src/download.go:242-265` | 开发构建；macOS 生产（打进 `Contents/Resources`） |

`desktop/src/download.go` 全文唯一的 HTTP 调用是 `waitHealth()` 探测 `/api/health`（`:357`），
**没有任何下载逻辑**。壳 UI 的文案本身也是这个意思：「首次启动，正在解压内置运行环境…」
（`desktop/src/desktop_copy.go:40`，`copyStatusFirstExtract`）。

### 2.2 缺失时的实际表现

三条来源都找不到时，`extractPortable()` 返回错误，`boot()` 直接把错误文案打到状态栏并 return
（`desktop/src/main.go:211-214`），不重试、不联网：

```
bundled portable package Octop-windows-amd64.zip not found beside application
```

### 2.3 两条启动路径要区分

`boot()`（`desktop/src/main.go:191`）先看有没有远端地址，有就压根不碰本地环境：

| 路径 | 判定 | 行为 |
|---|---|---|
| 远程模式 | `OCTOP_DESKTOP_URL` 或编译期 `-X main.defaultServerURL`（Taskfile 默认 `https://ocbot.aixifs.com/videogen`） | 直接等 `/api/health` 通，然后导航；不解压、不需要本地环境 |
| 本地模式 | 两者都为空 | 走 §2.1 三条来源解压到 `~/.octop/portable`，再拉起 `runtime/python.exe launch.py run` |

`defaultServerURL` 的烘焙只在 `-tags production` 分支进 ldflags
（`desktop/src/build/windows/Taskfile.yml:24`），所以**开发构建的 exe 默认是本地模式**。

---

## 三、层二：本机视频渲染环境（video-runtime）

### 3.1 目录与校验条件

目录解析：`OCTOP_DESKTOP_VIDEO_RUNTIME` 优先，否则 `<exe 目录>/video-runtime`
（`desktop/src/video.go:497` `videoRuntimeDir()`）。

真正的校验在 `startVideoWorker()`（`desktop/src/video.go:637`），三个条件任一不满足即
`videoErr("RUNTIME_UNAVAILABLE")`：

| # | 检查项 | 行号 |
|---|---|---|
| 1 | `runtime.json` 存在，且 `schema == "octop-desktop-video-runtime/1"`、`templateVersion == 1` | `:640` |
| 2 | `node.exe`（Windows）/ `node`（其它）是常规文件 | `:649` |
| 3 | `desktop-worker.mjs` 存在 | `:652` |

只判断"文件在不在"，不校验版本匹配、不试跑、不校验 node 是否真能执行。

### 3.2 关键时序：检查排在全流程最后

`videoManager.run()`（`desktop/src/video.go:407`）的实际顺序：

```
置 downloading
  → GET /api/product-library/projects/<id>/storyboard-package
  → 落盘 package.zip                       （上限 2 GiB，`videoPackageLimit`）
  → 解压 + 每个资源逐个 sha256 校验
  → 读 script.json、比对语义 hash
  → persist 任务记录（DataDir / Name）
  → 这时才调 startVideoWorker 检查 video-runtime   ← 缺失在这里才暴露
  → 失败：state=failed, errorCode=RUNTIME_UNAVAILABLE（:484-488）
```

即：**缺渲染组件的机器上，一次完整的素材包下载 + 解压 + 校验会先白跑一遍**，然后才报"组件没就绪"。

### 3.3 用户端表现

1. **入口不受约束**。前端 `bridgeAvailable` 只判断 `window.octopDesktopVideo?.version === 1`
   （`dashboard/src/context/DesktopVideoJobsContext.tsx:106-124`），含义是"桌面壳的 JS 桥注入成功"，
   与 `video-runtime` 是否存在**完全无关**；向导的 `isDesktop` 也只取这个值
   （`dashboard/src/pages/ProductVideoWizard/index.tsx:118-119`），所以按钮照样可点。
2. **点下去不会立刻报错**。`start()` 建完记录就 `go m.run(...)` 返回（`video.go:337`），
   异常只能靠 1.8s 一次的 `list` 轮询拿到。
3. **文案无法指导修复**（`dashboard/src/locales/zh.json:532`）：

   > 「本机制作组件尚未就绪，请重启 Octop 后重试。」

   重启不会把缺失的 `video-runtime` 变出来。
4. **"重试"必然复现**。`retry` 只是清掉 `data/`、`package.zip`、`final.mp4` 后重走同一个 `run()`
   （`video.go:884` `retryRun()`），会再次撞同一个 `RUNTIME_UNAVAILABLE`。
5. **无降级**。既不下补 `video-runtime`，也不回退到服务器端渲染，就是硬失败。
   失败记录持久化在 `~/.octop/desktop-video-jobs/<sha256(server)>/<sha256(owner)>/<jobId>.json`，重启后仍是 failed。

### 3.4 什么情况下会命中

`video-runtime` 是**构建期**产物：`remotion/build-desktop-runtime.mjs` 用 `curl.exe` 从
`nodejs.org/dist/v<ver>` 下 Node zip 并校验 `SHASUMS256.txt`（`:27`、`:77`、`:82`），
NSIS 用 `SetOutPath "$INSTDIR\video-runtime"` 打进安装目录（`desktop/src/build/windows/nsis/project.nsi:77-78`）。

因此以下情况必命中：

- 手工打 zip / 拷 exe 分发时漏了 `video-runtime/` 目录（当前 `desktop/src/bin/` 即如此）
- `OCTOP_DESKTOP_VIDEO_RUNTIME` 指向错误路径
- 老客户端只升级了服务器 Dashboard —— 设计文档已写明
  「单独更新服务器 Dashboard 不会给旧客户端增加本机制作能力」（`docs/design/desktop-auto-video/README.md:34`）

---

## 四、缺陷清单

| 编号 | 缺陷 | 影响 | 建议优先级 |
|---|---|---|---|
| D1 | 运行时校验排在整包下载/解压/校验之后（`video.go:407-494`） | 缺环境时白下载一次完整素材包（上限 2 GiB） | P1 |
| D2 | 无运行时能力查询，前端按钮不受运行时状态约束（`DesktopVideoJobsContext.tsx:106-124`） | 用户以为能用，点了才失败 | P1 |
| D3 | `start()` 异步返回，错误只能靠轮询（`video.go:337`） | 失败反馈延迟，且没有"立即失败"的通道 | P2 |
| D4 | `RUNTIME_UNAVAILABLE` 文案指导错误（`zh.json:532` / `en.json:532`） | 用户按提示重启无效，只会反复重试 | P2 |
| D5 | `retry` 对缺失类错误无意义，必然复现（`video.go:884`） | 无效重试消耗下载流量 | P2 |
| D6 | 无自动补齐、无服务器渲染降级 | 功能整体不可用，只能人工重装 | P3（设计取舍） |
| D7 | `videoRuntimeDir()` 的 error 分支实质不可达（只有 `os.Executable` 失败才报）（`video.go:497-506`） | `:484-488` 的 `RUNTIME_UNAVAILABLE` 是死代码，易误读 | P3 |
| D8 | worker 的 stderr 被整体丢弃（`video.go:691` `go io.Copy(io.Discard, stderr)`），非零退出统一归为 `RENDER_FAILED`（`:731-736`） | 装了但损坏的 runtime 表现为 `RENDER_FAILED`，现场无任何日志可查 | P1 |

> D8 补充：D1~D3 是"缺得晚"，D8 是"坏了也没法查"。两者叠加的结果是——现场只能看到
> 「视频制作失败，请重试。」这句话，既不知道是环境问题还是渲染问题。

---

## 五、核对清单（给开发逐条回执）

- [ ] D1：确认是否可以前移
- [ ] D2：确认是否新增能力探测
- [ ] D3：确认 `start()` 是否改为同步校验
- [ ] D4：确认文案改写
- [ ] D5：确认重试前是否复检
- [ ] D6：确认是否要做降级（可明确记为"不做"）
- [ ] D7：确认是否清理死分支
- [ ] D8：确认是否落 worker stderr 到 `~/.octop/logs/`

### 建议的最小改动（供讨论，未实施）

1. 把 `startVideoWorker()` 里的三个 stat 抽成 `checkVideoRuntime(runtimeDir) error`，
   在 `start()`（`video.go:295`）建记录之前就调用 —— 同步返回错误，webview 拿到即提示，省掉整包下载。
2. 新增 `capability` action（`videoAction` 里加一个 case，`video_bridge.go:64` 白名单同步），
   返回 `{videoRuntime: bool}`；前端 `DesktopVideoJobsContext` 暴露 `runtimeReady`，
   向导在 `isDesktop` 之外同时判断它，未就绪时禁用入口并给出安装指引。
3. 文案改为"本机未安装视频制作组件，请重新安装 Octop 桌面版"，中英文同步。
4. worker stderr 写到 `~/.octop/logs/desktop-video.log`，`RENDER_FAILED` 时在 UI 上给一句"详见日志"。

---

## 六、复现步骤

```bash
# 1. 确认本地模式（不设 OCTOP_DESKTOP_URL，且 exe 未烘焙 defaultServerURL）
strings -a desktop/src/bin/Octop.exe | grep -c videogen   # 期望 0 → 无烘焙

# 2. 确认环境缺失
ls ~/.octop/portable 2>/dev/null || echo "无 portable"
ls desktop/src/bin/video-runtime 2>/dev/null || echo "无 video-runtime"

# 3. 层一：直接运行，会停在
#    bundled portable package Octop-windows-amd64.zip not found beside application
desktop/src/bin/Octop.exe

# 4. 层二：远端模式起壳后，在向导第 4 步点"本机制作"
#    → 任务先进入 downloading，下载完成后才变 failed + RUNTIME_UNAVAILABLE
```

## 七、附录：文件与行号索引

| 主题 | 位置 |
|---|---|
| 便携环境解压 / 原子替换 | `desktop/src/download.go:36` `ensurePortable`、`:70` `replacePortable` |
| 便携 zip 来源 | `desktop/src/download.go:235` `bundledPortableZip`、`embed_portable_embedded.go:10` |
| 启动分流（远程 / 本地） | `desktop/src/main.go:191` `boot()`、`:35` `resolveRemoteDashboardURL` |
| 运行时目录 / 设置 | `desktop/src/settings.go:48` `portableDir`、`desktop/src/video.go:497` `videoRuntimeDir` |
| 渲染任务全流程 | `desktop/src/video.go:407` `run()`、`:637` `startVideoWorker`、`:884` `retryRun` |
| 错误码白名单 | `desktop/src/video_bridge.go:64` |
| 前端桥与能力判断 | `dashboard/src/context/DesktopVideoJobsContext.tsx:106-135` |
| 前端错误文案 | `dashboard/src/locales/zh.json:532`、`dashboard/src/locales/en.json:532` |
| 渲染运行时构建 | `remotion/build-desktop-runtime.mjs:27`、`:77-85` |
| 安装包内容 | `desktop/src/build/windows/nsis/project.nsi:77-78`、`desktop/src/build/windows/Taskfile.yml:56` |
| 分片下载（未实现） | `docs/desktop-bootstrap-installer.md:6` |
