# Windows 瘦安装器（Bootstrap Installer）方案

> 目标：把桌面端首包从 **~250MB+ 压到 ~12MB 以内**，安装器只负责"把壳装上"，
> 完整运行环境在首启后由壳自己分阶段下载、断点续传、后台补齐可选组件。
>
> 状态：设计稿，未实现。范围仅限 **Windows（amd64 / arm64）**。

---

## 一、现状与实测数据

### 1.1 今天的 Windows 安装包是怎么打出来的

CI 链路（`.github/workflows/octop-desktop.yml` + `desktop/src/build/windows/Taskfile.yml`）：

```
dashboard build → src/octop/dashboard
      ↓
desktop/portable/package.sh windows-amd64
      ↓ 产出  Octop-portable-windows-amd64-<ver>.zip
         = Octop-windows-amd64/
             runtime/    便携 CPython（PBS 3.12.12）
             packages/   209 个生产依赖 + octop 本体
             launch.py / start.bat / README.txt / VERSION.txt
      ↓
wails3 task package  →  stage:portable 把 zip 拷成 desktop/src/bundled/portable.zip
      ↓
go build -tags production   →  //go:embed bundled/portable.zip  （embed_portable_embedded.go）
      ↓
makensis project.nsi        →  Octop-desktop-windows-amd64-<ver>.exe
```

关键点：**portable zip 被整个 `go:embed` 进 `Octop.exe`，再由 NSIS 包一层**。
所以用户下载的 `.exe` ≈ 便携环境的全部内容（压缩后）。

> `desktop/src/embed_portable_embedded.go` 的 build tag 是 `production && !darwin`，
> macOS 走 `Resources/Octop-<plat>.zip`；Windows 与 Linux 走 embed 路径。

### 1.2 实测体积

在 `/opt/Octop` 实测（`.venv` 为 Python 3.14 的 `uv sync` 环境；生产依赖以
`uv export --frozen --no-dev` 的 **209 个发行版**为准，该导出才是 portable 打包用的清单）：

| 项 | 体积 | 口径 |
|---|---|---|
| 生产依赖树（209 个 dist） | **498 MB** | 磁盘实测，**未压缩** |
| └ playwright（含自带 node 驱动） | 136 MB | |
| └ numpy + numpy.libs | 74 MB | 被 `langchain-community` / `langchain-aws` 拉入 |
| └ zstandard / sqlalchemy / langchain-community / botocore | 22 / 21 / 19 / 19 MB | |
| └ pillow / uvloop / cryptography / lxml / google-genai | 15 / 13 / 11 / 10 / 9 MB | |
| 便携 CPython（PBS 3.12.12） | ~120 MB | 未压缩；`install_only_stripped` 压缩后约 40MB |
| octop 本体（`src/octop`，含 25MB dashboard） | 33 MB | wheel 内 |
| dashboard 构建产物 | 25 MB | 首屏 3.6MB / PWA 预缓存 7.2MB |
| 桌面壳资源 `desktop/src/assets` | 656 KB | index.html 23KB + 两个 mascot webp 627KB |
| **当前安装包 `.exe` 估算** | **~250–280 MB** | 498MB site-packages 压缩比按 ~50% 估（未实测，压缩率依内容而异） |

> 压缩体积是估算值；准确数字以 CI 产出的
> `Octop-desktop-windows-amd64-<ver>.exe` 的 artifact 体积减去 `Octop.exe` 体积为准。
> 文档里凡是标"估算"的都请以 CI 实测替换。

### 1.3 已经存在的、可直接复用的零件

| 能力 | 位置 | 复用方式 |
|---|---|---|
| 便携 Python 引导 | `desktop/portable/bootstrap-runtime.sh` | 已有 PBS 版本/triple/镜像逻辑 |
| 冻结依赖导出 + wheel 预拉 | `desktop/portable/vendor-wheels.sh` | `uv export --frozen --no-dev` |
| portable 打包 | `desktop/portable/package.sh` | 产出 zip，改为分片时在此处分叉 |
| 原子替换 | `desktop/src/download.go:replacePortable` | `.new` → `.previous` → 正式目录的换名模式 |
| 升级前 DB 备份 | `desktop/src/portable_upgrade.go` | SQLite `backup()` 脚本 |
| 版本比较 | `desktop/src/version.go` | PEP440 解析，勿另起一套 |
| 拉起 + 健康检查 | `desktop/src/process.go:startOctop`、`download.go:waitHealth` | 端口选择、`/api/health` 轮询 |
| 状态事件 | `desktop/src/main.go` → `desktop:status` | 壳 UI `desktop/src/assets/index.html:753` 已在消费 |
| 首启向导 | `src/octop/api/routers/setup.py` + `api/middleware/setup_lockdown.py` | 无用户时全站 503 `setup_required` |

### 1.4 结论

**能，而且改造点集中在两个地方**：

1. **不再把 portable zip 嵌进 exe**（省掉首包里的 250MB）——改由首启时从远端拉。
2. **把"完整环境"拆成能分阶段下载的片**——而这件事的上游是**依赖分组**，
   因为现在 `packages/` 是一棵 498MB 的扁平目录，没法"只下载其中一部分"。

---

## 二、目标与非目标

### 目标

| # | 目标 | 验收口径 |
|---|---|---|
| G1 | Windows 首包 ≤ **12MB**（NSIS 安装器） | CI 产出的 `.exe` 体积 |
| G2 | 安装后立刻能用；缺什么后台补什么 | 装完 60 秒内 dashboard 可访问 |
| G3 | 下载可断点续传、可失败重试、可跨镜像切换 | 拔网线/杀进程后重启，进度不丢 |
| G4 | 每个分片强校验（sha256），损坏不落盘 | 篡改分片必须被拒 |
| G5 | 保留现有"完整离线包"形态，存量用户不受影响 | `Octop-portable-windows-*.zip` 继续发布 |
| G6 | 升级路径复用现有 `replacePortable` 原子语义 | 升级失败保留旧版本可启动 |

### 非目标

- **不减少最终磁盘占用**——瘦安装器只改"怎么下载"，不改"装多大"。
  真要减最终体积，见 [§八 依赖瘦身](#八依赖瘦身前置项)。
- 不做静默后台自更新（`infra/setup/self_update.py` 已经在应用内做这件事）。
- 不做 Linux / macOS 瘦安装器（本轮只做 Windows；分片格式设计成可跨平台复用）。
- 不改 `octop` 后端与 dashboard 的功能面。

---

## 三、总体架构

```
┌─ 首次下载（~12MB）──────────────────────────────┐
│  Octop-desktop-windows-amd64-<ver>-slim.exe     │
│   NSIS stub  +  Octop.exe (Wails 壳, 不内嵌      │
│   portable)  +  desktop/src/assets (656KB)       │
│   装到: %ProgramFiles%\Octop\Octop.exe          │
└──────────────────────────────────────────────────┘
                        │
                        ▼  首启
┌─ 壳自举（Octop.exe 内）──────────────────────────┐
│  1. 读 manifest.json（版本/分片清单/校验和）      │
│  2. 按阶段下载 → 校验 → 解压 → 原子切换          │
│     阶段 A: runtime/   (便携 CPython)             │
│     阶段 B: app/       (octop 本体 + dashboard)    │
│     阶段 C: packages/  (生产依赖)                 │
│  3. 拉起 octop 服务 → waitHealth → 打开 dashboard │
│  4. 后台补可选组件（浏览器/飞书/AWS 链/OCR…）     │
└──────────────────────────────────────────────────┘
                        │
                        ▼
┌─ 运行时落地位置 ─────────────────────────────────┐
│  %LOCALAPPDATA%\Octop\portable\     ← 运行时（可写、非 Program Files）│
│    runtime\  packages\  app\  state.json  cache\   │
│  %USERPROFILE%\.octop\              ← 数据（OCTOP_HOME，现有逻辑） │
└──────────────────────────────────────────────────┘
```

**为什么不把运行时写进 `Program Files`**：

- `Program Files` 下的写入需要管理员权限，普通用户安装体验直接崩；
- 往 `Program Files` 写 500MB 会被 Defender 实时扫描拖慢到不可忍受；
- `Program Files` 是受保护目录，杀毒软件对其写入的拦截策略更激进。

所以 NSIS 安装器**只写一个 exe**（+ 快捷方式 + 卸载注册表项），运行时全部由壳自己
下载到 `%LOCALAPPDATA%`。这也是"首包能小"的前提：安装器里根本没有运行时。

> 现有 `portableDir()`（`desktop/src/settings.go:48`）是 `~/.octop/portable`。
> 建议改为 `%LOCALAPPDATA%\Octop\portable`，数据仍在 `~/.octop`（`OCTOP_HOME`）。
> 改动点只有 `portableDir()` 一个函数，但它同时被 `download.go`、`main.go`、
> `process.go` 使用，改动面可控。

---

## 四、制品设计

### 4.1 分片格式：tar.gz，不用 zip

| 候选 | 结论 |
|---|---|
| `zip` | ❌ Windows 无 symlink 权限（`download.go:unzipGreenFiles` 里有 `os.Symlink` 分支，Win 上需管理员或开发者模式）；zip 中心目录在尾部，不适合"下到一半"语义 |
| `tar.gz` | ✅ Go stdlib `archive/tar` + `compress/gzip` 直接支持流式解压；无 symlink 需求；跨平台同构，未来做 mac/Linux 复用同一套分片 |

**分片即 tar.gz**，每个分片解压到一个目标目录，解压完再由上层做目录级原子切换。

### 4.2 分片清单

| ID | 内容 | 目标目录 | 必需 | 估算体积（压缩） |
|---|---|---|---|---|
| `runtime` | 便携 CPython 3.12.12（windows-amd64 / windows-arm64） | `runtime/` | 是 | ~40 MB |
| `app` | octop wheel 解包结果（含 25MB dashboard） | `packages/octop/` | 是 | ~30 MB |
| `deps-core` | 209 个生产依赖中"核心组"的部分 | `packages/` | 是 | ~150–200 MB |
| `deps-browser` | playwright python 包（136MB） | `packages/` | 否 | ~50 MB |
| `deps-browser-chromium` | Chromium 运行时 | `packages/`（playwright 缓存目录） | 否 | ~170 MB |
| `deps-feishu` | lark-oapi（58MB） | `packages/` | 否 | ~20 MB |
| `deps-aws` | boto3/aioboto3/aiobotocore/botocore 链 | `packages/` | 否 | ~25 MB |
| `deps-ocr` | rapidocr/onnxruntime/opencv（已是 extras） | `packages/` | 否 | ~90 MB |
| `deps-embedding` | fastembed/tokenizers（已是 extras） | `packages/` | 否 | ~60 MB |

`deps-core` / `deps-browser` / `deps-feishu` / `deps-aws` 这四片的**切分依据来自
[§八](#八依赖瘦身前置项)的 extras 化**。extras 化没做之前，这四片无法在构建期拆开——
这是整个方案的技术关键路径。

### 4.3 manifest

每个版本、每个平台一份：

```jsonc
{
  "version": "1.1.0",
  "platform": "windows-amd64",
  "python": "3.12.12",
  "pbs_tag": "20251209",
  "parts": [
    {
      "id": "runtime",
      "url": ["https://github.com/TencentCloud/Octop/releases/download/v1.1.0/Octop-parts-windows-amd64-1.1.0-runtime.tar.gz",
              "https://<bucket>.<endpoint>/octop/release/1.1.0/Octop-parts-windows-amd64-1.1.0-runtime.tar.gz"],
      "size": 41943040,
      "sha256": "…",
      "target": "runtime",
      "required": true
    }
  ]
}
```

- `url` 是**有序数组**，客户端按序尝试（GitHub Release → COS → 其他镜像）。
- `sha256` 对**压缩包**校验（不是对解压后的目录），保证下载完整性 + 供应链可信。
- `required: false` 的分片是"后台补齐"，失败不影响主流程。

manifest 本身也要有校验：随壳内置 manifest 的 `sha256`（编译期常量），
或对 manifest 单独签名。

### 4.4 制品托管

复用现有两条通道，客户端按序 fallback：

| 通道 | 现状 | 用途 |
|---|---|---|
| GitHub Release | `.github/workflows/octop-desktop.yml` 已挂 `Octop-portable-*` / `Octop-desktop-*` | 海外主源 |
| COS | `.github/workflows/upload-release-cos.yml` → `octop/release/<version>/<file>` | 国内主源（`patterns` 需加上 `Octop-parts-*`） |

CI 需要新增一个 job 产出分片 + manifest，并把它们一起挂到 Release / COS。

---

## 五、客户端下载器

### 5.1 落点

新增 `desktop/src/bootstrap/` 包（Go），核心文件：

| 文件 | 职责 |
|---|---|
| `manifest.go` | manifest 结构 + 拉取 + 校验 |
| `fetch.go` | HTTP 下载：Range 续传、镜像 fallback、指数退避重试 |
| `unpack.go` | tar.gz 流式解压到临时目录 |
| `state.go` | `state.json` 读写：已完成分片、版本、失败记录 |
| `stages.go` | 阶段编排（runtime → app → deps-core → 可选） |
| `bootstrap_test.go` | 单测（httptest 假服务器 + 断点/损坏/中断场景） |

### 5.2 下载语义

```
for part in manifest.parts where required:
    if state.completed(part) and sha256(staged_file) ok:  continue
    tmp = cache/<id>.tar.gz.part
    resume from len(tmp) using HTTP Range: bytes=<len>-
    on 200 (no range support) → truncate & restart
    on 416 (already complete) → verify & continue
    verify sha256(tmp) == part.sha256   → 不匹配：删 tmp，换镜像，重试
    unpack(tmp → <target>.new)          → fsync
    rename <target>.new → <target>      → Windows 下先 rename 旧目录为 .previous
    record state.completed(part)
```

要点：

- **断点续传**：`Range` 请求 + `.part` 文件。服务端不支持 Range（部分 COS 配置、
  代理会吞掉 Range）时降级为整片重下，功能不破。
- **镜像 fallback**：一个镜像失败（404 / 连接超时 / 校验不符）→ 自动切下一个。
- **重试**：单镜像内指数退避重试 3 次（1s/4s/16s），全失败才换镜像。
- **落盘前校验**：sha256 不过绝不解压。

### 5.3 Windows 特有的三个坑

| 坑 | 现状 | 处理 |
|---|---|---|
| **MAX_PATH 260** | `unzipGreenFiles` 用 `os.OpenFile` 写绝对路径，site-packages 里有长路径（如 `packages/.../site-packages/...`） | 解压时对超长路径加 `\\?\` 前缀；或把根目录设成短路径 `%LOCALAPPDATA%\Octop\p` |
| **目录 rename 不能覆盖** | Windows `os.Rename` 目标存在即失败 | 复用 `replacePortable` 的 `.new` / `.previous` 三段式 |
| **杀软实时扫描** | 解压 500MB 会被 Defender 逐文件扫描，耗时数倍 | 目标目录加排除项不可行（需管理员），改为：先解压到 `.new`、校验完成后再 rename；并提供"安装后手动排除目录"的提示 |

### 5.4 状态与恢复

`%LOCALAPPDATA%\Octop\portable\state.json`：

```jsonc
{
  "version": "1.1.0",
  "completed": { "runtime": {"sha256": "…", "at": "…"}, "app": {…} },
  "failed":    { "deps-browser": {"attempts": 3, "lastError": "…"} }
}
```

- 壳每次启动先读 `state.json`，跳过已完成的分片。
- 分片完成后立即落盘 → 断电/杀进程最多丢失当前分片的进度（`.part` 保留，可续）。
- 版本变更（`state.version != manifest.version`）→ 保留旧目录，重装新分片，
  全部就绪后原子切换（复用 `replacePortable` + `backupSQLiteBeforeUpgrade`）。

### 5.5 与现有 `ensurePortable` 的关系

现有 `ensurePortable`（`download.go:35`）处理的是"从内嵌 zip 解压"。

改造后变成两级：

```go
func ensurePortable(locale, status) error {
    if launchReady(portableDir()) && 版本匹配 { return nil }   // 已有可用环境
    if 有内嵌 zip（离线/开发构建） { 沿用旧路径解压 }            // 兼容
    return bootstrap.Run(manifestURL, status)                   // 在线分阶段下载
}
```

**旧的"内嵌 zip"路径必须保留**：

- 开发构建（`desktop/src/embed_portable.go`）依赖它；
- 离线场景（内网、air-gapped）仍需要完整包；
- 灰度期需要能一键回退到"全量内嵌"的安装器。

---

## 六、进度 UI

### 6.1 复用现有壳 UI

`desktop/src/assets/index.html` 已经是 Go 嵌入的 HTML 壳（23KB），有 loading 态和
`#status` 元素，通过 `desktop:status` 事件更新（`:753`）。扩展为进度面板：

- 阶段名（正在下载：便携运行环境 / 应用本体 / 依赖 / 可选组件）
- 进度条 + 已下载 / 总量 + 速度 + 预计剩余
- 可选组件行 + "稍后再说" / "立即下载"（默认后台下，不阻塞首次可用）
- 失败态：重试按钮 + 错误摘要 + "查看日志"

### 6.2 事件协议

新增 `desktop:progress` 事件（沿用 `desktop:status` 的风格）：

```go
type ProgressEvent struct {
    Stage    string  `json:"stage"`     // runtime | app | deps-core | optional
    PartID   string  `json:"partId"`
    Label    string  `json:"label"`     // 已本地化的展示名
    Received int64   `json:"received"`
    Total    int64   `json:"total"`
    SpeedBps float64 `json:"speedBps"`
    State    string  `json:"state"`     // pending | active | done | failed | skipped
    Error    string  `json:"error"`
}
```

壳 UI 侧按 `desktop/src/assets/index.html` 现有的 `Events.On(...)` 模式接。
**进度事件不落在后端**——它在环境还没装好时就要显示，那时 FastAPI 根本起不来。

### 6.3 文案

壳 UI 目前是**中英双语硬编码在 HTML 里**（`:569` / `:589` 两份 `copy` 对象），
不走 `src/octop/i18n/`（后端 i18n 只服务后端产出文案）。新增的安装阶段文案
沿用同一份 `copy` 结构，**不引入新的 i18n 机制**（见 `desktop/src/settings.go` 的 `Locale`）。

---

## 七、CI 与打包改造

### 7.1 新增分片构建

`desktop/portable/package-shards.sh <plat>`（与 `package.sh` 并列，不改原脚本）：

1. 复用 `bootstrap-runtime.sh` 拿 runtime；
2. 按 extras 分组分别 `uv pip install --target` 到独立 staging；
3. `uv build --wheel` 出 octop wheel；
4. 每个 staging 打成 `tar.gz`；
5. 生成 `manifest.json`（size / sha256 / url）；
6. 输出到 `desktop/portable/release/parts/`。

`package.sh`（整包 zip）**保持不变**，两条线并存。

### 7.2 瘦安装器

`desktop/src/build/windows/Taskfile.yml` 增加一个 task（如 `package:slim`）：

- `stage:portable` 改为**可选**：瘦安装器**不**执行它，因此 `bundled/portable.zip`
  不存在，`//go:embed bundled/portable.zip` 会编译失败 →
  需要把 embed 改成**可空**：`bundled/portable.zip` 不存在时用 `-tags portable_embed` 编译，
  或者在 `embed_portable_embedded.go` 里改为嵌入一个占位文件 + 运行时判断。
  **推荐**：加 build tag，产出两个变体：
  - `Octop-desktop-windows-<ver>.exe` —— 全量内嵌（离线/内网/回退用，行为不变）
  - `Octop-desktop-windows-<ver>-slim.exe` —— 瘦（在线首启下载，~12MB）

- NSIS 脚本 `build/windows/nsis/project.nsi`：瘦变体**不写任何运行时文件**，
  只装 exe + 快捷方式 + 卸载信息。

### 7.3 WebView2

保持现状：`wails3 generate webview2bootstrapper`（`Taskfile.yml` 的
`create:nsis:installer`）用的是 **bootstrapper**（~1.4MB 的在线引导器），
不是 127MB 的 offline installer。**不要换成 offline installer**，否则首包直接爆。

> Win11 自带 WebView2 Runtime；Win10 可能缺失，由 bootstrapper 在安装时拉取。
> 这是瘦安装器里唯一一个"安装期网络下载"，需要保留。

### 7.4 体积预算

| 组成 | 估算 | 备注 |
|---|---|---|
| NSIS stub | ~0.5 MB | `!include MUI2` 基础 |
| `Octop.exe`（Wails v3, `-w -s -trimpath`, CGO off） | 8–15 MB | **未实测**：本机缺 `webkitgtk-6.0` 无法构建 Wails 壳；以 CI 产物体积为准 |
| `desktop/src/assets` | 656 KB | 可压到 ~120 KB：两个 mascot webp（627KB）转有损/降尺寸 |
| WebView2 bootstrapper | ~1.4 MB | 已内含在 NSIS |
| **合计目标** | **≤ 12 MB** | |

> 顺带：`desktop/src/assets/octop-mascot-peek.webm`（266KB）没被 `index.html` 引用，
> 是死资源，可直接删（`desktop/src/assets` 里只有 `.webp` 两份 + png 图标 + index.html）。

---

## 八、依赖瘦身（前置项）

瘦安装器只能改变**下载方式**；要改变**最终装多大**，必须动依赖。四个大头：

| 依赖 | 体积 | 归属 | 能否移出 core |
|---|---|---|---|
| `playwright` | 136 MB | `octop` 直接依赖 | ✅ 引用点只有 `infra/browser/`、`api/routers/browser/env.py`，可惰性 import → `extras[browser]` |
| `numpy`(+libs) | 74 MB | `langchain-community` / `langchain-aws` 拉入 | ⚠️ 需在 **octop-harness** 侧收窄 extra（`octop-harness[all]` → 见下） |
| `lark-oapi` | 58 MB | `octop` + `octop-gateway` | ✅ 飞书渠道专用 → `extras[feishu]`；但 `octop-gateway` 硬依赖它，需要 gateway 侧同步改造 |
| `boto3` 链（aioboto3/aiobotocore/botocore） | ~60 MB | `deepagents` / `langchain-aws` 拉入 | ⚠️ 同样要 harness 侧处理 |

**`octop-harness[all]` 是最大的杠杆**：`pyproject.toml:24` 写的是
`octop-harness[all]>=1.0.4`，而 harness 依赖 `langchain`（元包）→ 连带
`langchain-community` + `langchain-aws` + `numpy` + AWS 链。

- 在 **octop-harness** 仓库新增一个更窄的 extra（例如 `octop-harness[base]`，
  只含 `langchain-core` / `langgraph` / `langchain-anthropic` / `langchain-openai`），
  Octop 侧改用它；
- 这是一次**跨仓库**改动，需要单独排期，且要验证 harness 的工具加载路径不依赖
  `langchain-community` 的 loader。

**收益预估**：extras 化完成后，基础安装（runtime + app + deps-core）可从
~500MB 降到 ~280MB，`deps-core` 压缩后 ~150MB。**首包仍然是 12MB**（瘦安装器），
但**首次完整下载**从 ~250MB 降到 ~150MB。

> 依赖瘦身**不影响本方案的可交付性**：即使 extras 化没做，分片也能做（只是
> `deps-core` 变回一整片 ~500MB 树、拆不出 browser/feishu/aws 三片）。
> 但不做的话，[§四](#四制品设计)的分片设计就只剩"必需/可选"两档，收益减半。

---

## 九、实施路线

| PR | 内容 | 依赖 | 风险 |
|---|---|---|---|
| **PR-0** | `pyproject.toml` extras 化：playwright → `extras[browser]`、lark-oapi → `extras[feishu]`；对应 import 改惰性 | — | 中（要确认所有 import 点） |
| **PR-0b** | octop-harness 侧收窄 extra（跨仓库） | PR-0 | 中（另一个包，需发版） |
| **PR-1** | `package-shards.sh` + manifest 生成；CI 新 job 产出分片（**先不发布、不引用**） | — | 低 |
| **PR-2** | Go 下载器（`desktop/src/bootstrap/`）：manifest / Range 续传 / sha256 / tar.gz 解压 / 原子切换 / `state.json`；单测用 httptest 假服务器覆盖断点、损坏、中断 | PR-1 | 中（Windows 路径/长路径要真机验） |
| **PR-3** | 壳 UI 进度面板（`desktop/src/assets/index.html` 扩展 + `desktop:progress` 事件） | PR-2 | 低 |
| **PR-4** | 瘦安装器变体：NSIS slim task + 可空 embed + 首启引导；**默认仍发布全量版** | PR-2, PR-3 | 中（改动打包链） |
| **PR-5** | 可选组件后台下载（dashboard 可用后继续拉） | PR-4 | 低 |
| **PR-6** | 灰度：slim 版作为主推下载项，全量版保留为"离线完整包" | PR-4 | 低 |

**PR-2 的验证必须在真 Windows 上做**，本仓库 CI 有 `windows-latest` 与
`windows-11-arm` 两个 runner（`octop-desktop.yml` 的 matrix），可直接用。

---

## 十、验收标准

1. `Octop-desktop-windows-amd64-<ver>-slim.exe` 体积 **≤ 12MB**。
2. 全新 Windows 机器上安装 → 壳启动 → 出现进度面板 → 完成后 dashboard 可访问，
   **全程无需用户手工操作**。
3. 下载中断（关进程 / 断网）后重启，进度从断点继续，不重复下载已完成分片。
4. 篡改分片内容 → sha256 校验失败 → 自动换镜像 → 仍失败则报错且**不落盘**。
5. 可选组件失败（镜像全挂）→ 主流程仍可用，UI 提示可稍后重试。
6. 升级：旧版 → 新版，DB 备份成功；新环境损坏时旧版本仍能启动。
7. 全量内嵌版（现有 `.exe`）行为**完全不变**（回归测试：现有
   `desktop/src/download_test.go` 全绿）。
8. 磁盘占用：基础安装完成后，`%LOCALAPPDATA%\Octop` 占用符合预期
   （runtime + core deps），可选组件按需追加。

---

## 十一、风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| SmartScreen / 杀软误报（未签名 + 下载行为） | 用户看到"未知发布者"、被杀软拦截 | 代码签名；NSIS 安装器只写 exe；分阶段下载而非单文件自解压；提供哈希校验页 |
| WebView2 缺失（Win10 N / 精简版） | 壳窗口打不开 | 保留 bootstrapper；安装前检测并给出提示 |
| Windows Defender 扫描解压中的 500MB | 安装耗时数倍 | 解压到 `.new` 再改名；提供 Defender 排除目录引导 |
| MAX_PATH 260 截断 | 部分依赖解压失败 | `\\?\` 前缀 + 短根目录（`%LOCALAPPDATA%\Octop\p`） |
| 企业代理 / 禁止外网 | 下载失败 | manifest `url` 数组支持自定义 base URL（设置项）；保留全量离线包 |
| 磁盘空间不足 | 解压中途失败 | 安装前预检可用空间（runtime+core ≈ 1.2GB） |
| 供应链篡改 | 装到恶意代码 | sha256 强校验 + manifest 签名 + 建议代码签名 |
| octop-harness extra 收窄引入回归 | harness 工具加载失败 | PR-0b 单独立项 + harness 侧测试 |
| 分片与版本错配 | 混装新旧文件 | manifest 绑定版本；目录级原子切换；`state.json` 记版本 |

---

## 十二、附录：关键代码位置

| 主题 | 位置 |
|---|---|
| portable zip 内嵌（生产构建） | `desktop/src/embed_portable_embedded.go`（`//go:embed bundled/portable.zip`） |
| portable zip 内嵌（开发构建） | `desktop/src/embed_portable.go` |
| 解压 + 原子替换 | `desktop/src/download.go:unzipGreenFiles` / `replacePortable` |
| 可启动判定 | `desktop/src/download.go:launchReady` |
| 升级前 DB 备份 | `desktop/src/portable_upgrade.go` |
| 运行时目录 / 设置 | `desktop/src/settings.go:portableDir` / `octopHome` |
| 拉起子进程 | `desktop/src/process.go:startOctop` |
| 健康检查 | `desktop/src/download.go:waitHealth` |
| 状态事件 | `desktop/src/main.go:setStatus` → `desktop:status` |
| 壳 UI（Go 嵌入 HTML） | `desktop/src/assets/index.html`（`desktop:status` 消费在 `:753`） |
| Windows 构建 / NSIS | `desktop/src/build/windows/Taskfile.yml` |
| WebView2 bootstrapper | `desktop/src/build/windows/Taskfile.yml:create:nsis:installer` |
| 便携 Python 引导 | `desktop/portable/bootstrap-runtime.sh` |
| 冻结依赖导出 | `desktop/portable/vendor-wheels.sh` |
| portable 打包 | `desktop/portable/package.sh` |
| pywin32 DLL 修复（Windows 必需） | `desktop/portable/package.sh:fix_windows_pywin32` |
| 便携入口（Windows DLL 路径） | `desktop/portable/templates/launch.py` |
| 便携启动脚本 | `desktop/portable/templates/start.bat` |
| 桌面 CI | `.github/workflows/octop-desktop.yml` |
| 制品上 COS | `.github/workflows/upload-release-cos.yml` |
| 下载链接表 | `scripts/release_download_links.py` |
| 后端首启向导 | `src/octop/api/routers/setup.py`、`src/octop/api/middleware/setup_lockdown.py` |
