# Windows 桌面客户端构建说明

> 面向在 Windows 机器上出包的机器。本文档覆盖三种变体、完整命令、验证清单和常见坑。
>
> 背景：Gitee 单个 Release 附件上限 **100 MB**，完整客户端安装器是 200–340 MB
> （内嵌 Python 运行时），直接传不上去。Windows 侧要出的是 **< 100 MB** 的变体。

---

## 一、三种变体，先选对

| 变体 | 命令里给什么 | 安装器体积 | 行为 | 适合 Gitee |
|---|---|---|---|---|
| **远程版**（thin） | 什么都不给（默认） | ~18 MB | 连已部署的 Octop 服务，本机不装运行时 | ✅ |
| **本地版**（slim） | `PORTABLE_RUNTIME_URL=<地址>` | ~20 MB | 本机跑完整运行时，**首启**下载 ~290 MB 运行时 | ✅ |
| 完整版（full） | `DEFAULT_SERVER_URL=`（置空） | ~300 MB | 本机跑完整运行时，离线包 | ❌ 超 100 MB |

> 默认是远程版：`desktop/src/Taskfile.yml` 里全局 `DEFAULT_SERVER_URL` 默认指向
> `https://ocbot.aixifs.com/videogen`。要出本地版就传 `PORTABLE_RUNTIME_URL`，
> 它会自动盖掉远程地址（否则壳会直接连远程服务，运行时永远不会被下载）。

**选哪个**：绝大多数用户装完即用、要能连你的服务 → **远程版**（最省事，18MB）。
要给"自己本地跑一套"的用户 → **本地版**（首启要联网）。

---

## 二、机器准备

| 依赖 | 版本 | Windows 上的装法 |
|---|---|---|
| Git Bash | 任意近期版本 | 装 Git for Windows 时勾选（脚本是 bash 写的） |
| Go | **1.25+** | https://go.dev/dl/ |
| Wails v3 CLI | **v3.0.0-beta.13**（必须一致） | `go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.13` |
| NSIS（makensis） | 3.x | `choco install nsis`，或 https://nsis.sourceforge.io/ |
| Node.js | 20 或 24 | https://nodejs.org/（脚本会自动尝试 `nvm use 24`） |
| uv | 任意 | https://docs.astral.sh/uv/ |

Windows 走 WebView2，**不需要** GTK / WebKit（那是 Linux/macOS 的事）。

自检：

```bash
go version
wails3 version          # 应为 v3.0.0-beta.13
makensis -VERSION       # 应有版本号
node -v
uv --version
```

---

## 三、构建

### 3.1 拉代码

```bash
git clone git@github.com:zhuimeng2026-hub/Octop.git
cd Octop
git checkout feat/desktop-slim-installer     # 或合并后的 develop / main
```

### 3.2 构建前端（必须，不能跳）

desktop 客户端的界面来自 dashboard，它被打进 octop wheel 里。**不构建前端就会得到一个
首屏白屏的客户端**。

```bash
make build-frontend
# 等价于：cd dashboard && npm ci && npm run build
# 产物落在 src/octop/dashboard/（该目录被 gitignore，是构建产物）
```

> 国内网络建议先设镜像：`npm config set registry https://registry.npmmirror.com`

### 3.3 构建 portable 运行时（只有本地版 slim 需要）

slim 客户端首启时要下载的就是这个 zip。**它必须在 Windows 上构建**——跨平台交叉组装
会失败（`aliyun-python-sdk-core` 只有源码包，没有 Windows wheel）：

```bash
bash desktop/portable/bootstrap-runtime.sh windows-amd64   # 下载便携 CPython
bash desktop/portable/package.sh windows-amd64              # 装依赖 + 打包
# 产物：desktop/portable/release/Octop-portable-windows-amd64-1.4.0.zip  (~290 MB)
```

ARM64 版同理，把平台换成 `windows-arm64`。

> 依赖源慢时可以走镜像：`PBS_BASE_URL=https://registry.npmmirror.com/-/binary/python-build-standalone/20251209`

### 3.4 打安装包

**远程版（thin，默认）：**

```bash
cd desktop/src
wails3 task package ARCH=amd64 VERSION=1.4.0
# 产物：desktop/src/bin/Octop-desktop-windows-amd64-1.4.0.exe   (~18 MB)
```

**本地版（slim）：**

```bash
cd desktop/src
wails3 task package \
  ARCH=amd64 \
  VERSION=1.4.0 \
  PORTABLE_RUNTIME_URL="https://github.com/zhuimeng2026-hub/Octop/releases/download/v1.4.0-gitee.1/Octop-portable-windows-amd64-1.4.0.zip"
# 产物：desktop/src/bin/Octop-desktop-slim-windows-amd64-1.4.0.exe   (~20 MB)
```

ARM64：`ARCH=arm64`，其余不变。

> 也可以用仓库自带的发布脚本（它会串起前端 → portable → 校验 → 打包）：
> `bash desktop/package-release.sh windows-amd64`。
> 但它走的是远程版/完整版，**slim 变体目前只能直接调 `wails3 task package`**。

---

## 四、运行时 URL 是关键

slim 客户端把运行时地址**编译期写死**进 exe。地址必须在用户首次启动前就公开可达，
否则首启会下载失败（客户端会重试，但用户看到的是报错）。

可选地址源：

| 地址 | 说明 |
|---|---|
| GitHub Release 资产 | `https://github.com/<owner>/<repo>/releases/download/<tag>/Octop-portable-windows-<plat>-<ver>.zip` |
| 腾讯云 COS | `https://<bucket>.<endpoint>/octop/release/<ver>/Octop-portable-windows-<plat>-<ver>.zip` |

两者可以都写，逗号分隔，客户端按顺序尝试（前一个失败自动换下一个）：

```
PORTABLE_RUNTIME_URL=https://<bucket>.<endpoint>/octop/release/1.4.0/Octop-portable-windows-amd64-1.4.0.zip,https://github.com/zhuimeng2026-hub/Octop/releases/download/v1.4.0-gitee.1/Octop-portable-windows-amd64-1.4.0.zip
```

**顺序建议**：COS 在前（国内快），GitHub 在后（兜底）。但 COS 上的对象要先上传好，
否则首个用户会先撞到 COS 的 404 再退回 GitHub。

下载会**断点续传**：中途断网或杀进程，下次启动从断点继续，不会从头再下。

**更稳的做法：给 manifest**

只给 zip 地址时客户端没有校验和，镜像给了坏包只能等下次重试。改用 manifest
（描述版本、分片、镜像、sha256）就能强校验：

```bash
cd desktop/src
wails3 task package \
  ARCH=amd64 \
  VERSION=1.4.0 \
  PORTABLE_RUNTIME_MANIFEST_URL="https://<bucket>.<endpoint>/octop/release/1.4.0/manifest.json,https://github.com/zhuimeng2026-hub/Octop/releases/download/v1.4.0-gitee.1/manifest.json"
```

manifest 长这样（`format` 是 `zip` 或 `tar.gz`，`urls` 是有序镜像列表）：

```json
{
  "version": "1.4.0",
  "parts": [
    {
      "id": "runtime",
      "urls": ["https://cos/.../Octop-portable-windows-amd64-1.4.0.zip"],
      "size": 304087040,
      "sha256": "…",
      "format": "zip",
      "stripRoot": true,
      "required": true
    }
  ]
}
```

详见 [desktop-bootstrap-installer.md §0.4](desktop-bootstrap-installer.md#04-怎么用)。

---

## 五、发布到 GitHub Release 与 Gitee

### 5.1 先把运行时 zip 传上 GitHub Release

运行时 zip 本身也是 Gitee 传不下的（290 MB > 100 MB），所以它留在 GitHub Release，
Gitee 页面给外链。

```bash
# 在有 GitHub token 的机器上（token 放 ~/.github_token 首行，或设 $GH_TOKEN）
bash scripts/gitee/upload_release_asset.sh <release-id> desktop/portable/release/Octop-portable-windows-amd64-1.4.0.zip
bash scripts/gitee/upload_release_asset.sh <release-id> desktop/src/bin/Octop-desktop-slim-windows-amd64-1.4.0.exe
```

### 5.2 再发 Gitee

```bash
export GITEE_TOKEN=<Gitee PAT，projects 权限>
bash scripts/gitee/publish_from_github.sh \
  --tag v1.4.0-gitee.1 \
  --source-repo zhuimeng2026-hub/Octop \
  --owner webheat --repo octop_client
```

它会：拉 GitHub Release 里 **< 100 MB** 的资产 → 生成 Release 说明 → 同步下载页 →
建 Gitee Release 并上传（超限的只列出并给外链）。

> 也可以在 GitHub Actions 里 dispatch `Gitee Release` 工作流（需要仓库 Secret
> `GITEE_TOKEN`），但那个工作流目前因 fork 的 Actions 被禁用而跑不起来。

---

## 六、验证清单

出包后逐项确认：

- [ ] `Octop-desktop-slim-windows-amd64-1.4.0.exe` 体积 **< 100 MB**（Gitee 硬限制）
- [ ] 在一台干净 Windows 上安装 → 启动 → 状态栏出现"正在下载运行环境… N%" → 完成后 dashboard 能打开
- [ ] **断网再启**：已下载的运行时不再下载，直接可用（离线可用）
- [ ] 下载中断（杀进程）后重启：从断点继续，不是从头再下
- [ ] `Octop-portable-windows-amd64-1.4.0.zip` 已上传到 GitHub Release，**且 URL 可公开下载**（拿无痕窗口试）
- [ ] 装完后运行时落在 `~/.octop/portable`（即 `OCTOP_HOME` 下，不是 Program Files）

---

## 七、常见坑

| 现象 | 原因 | 处理 |
|---|---|---|
| `wails3: command not found` | 没装或不在 PATH | `go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.13`，确认 `%GOPATH%\bin` 在 PATH |
| `makensis not found` | 没装 NSIS | `choco install nsis`，或设 `OCTOP_DESKTOP_MAKENSIS` 指向本地 makensis.exe |
| 安装后首屏白屏 | 没构建前端 | 补 `make build-frontend` 再重打 |
| `aliyun-python-sdk-core has no usable wheels` | 在 Linux/macOS 上交叉构建 Windows portable | portable 必须在 Windows 上构建 |
| 装完提示找不到 `pywintypes` | pywin32 的 DLL 没就位 | `package.sh` 会自动拷；确认走的是 `package.sh` 而不是手工拼 staging |
| arm64 包打出 amd64 的内容 | x64 Git Bash 上把 arm64 误判成 amd64 | 用 arm64 机器，或显式设 `GREEN_HOST_PLAT=windows-arm64` |
| slim 客户端首启 404 | 运行时 URL 指向的 zip 还没发布 | 先传 zip 再分发客户端；URL 是编译期写死的，改地址要重打 |
| slim 客户端连了远程服务、没下载运行时 | 构建时没清掉 `DEFAULT_SERVER_URL` | 传 `PORTABLE_RUNTIME_URL` 时打包任务会自动置空远程地址；确认用的是 `package:slim` |

---

## 八、参考：CI 里对应做什么

`.github/workflows/octop-desktop.yml` 的 `package` job 就是上面这套的自动化版本
（`bootstrap-runtime.sh` → `package.sh` → `wails3 task package` → 上传 artifact →
挂到 GitHub Release → 传 COS）。Windows 相关的两个额外动作：

1. 装 NSIS（choco 装不上时从 SourceForge 下 setup 静默安装）
2. 用 `windows-latest` / `windows-11-arm` 原生 runner（不能交叉）

> 该工作流目前在本 fork 跑不起来：fork 的 Actions 在 GitHub 侧被禁用
> （`actions/permissions` 显示 enabled，但 dispatch 一律返回
> `422 Actions has been disabled for this repository`），需要在网页上重新启用。

---

## 相关文件

| 主题 | 位置 |
|---|---|
| 打包任务（三种变体的选择逻辑） | `desktop/src/build/windows/Taskfile.yml` |
| portable 运行时构建 | `desktop/portable/package.sh`、`bootstrap-runtime.sh` |
| 一键发布脚本 | `desktop/package-release.sh` |
| 运行时下载实现（客户端侧） | `desktop/src/download.go` |
| Gitee 发布 | `docs/gitee-release.md`、`scripts/gitee/` |
| 瘦安装器方案与未实现项 | `docs/desktop-bootstrap-installer.md` |
