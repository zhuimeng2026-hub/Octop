# Octop desktop (Wails v3)

All desktop-client code lives here. This is **not** `src/octop/infra/control/desktop`
(remote desktop streaming). Windows remote releases use a small thin client;
local/full builds retain the green portable backend.

| Path | Role |
|------|------|
| [`portable/`](portable/) | Green zip packaging (was `scripts/green/`) |
| [`src/`](src/) | Wails v3 shell: load bundled zip, spawn Octop, tray/settings |
| [`package-release.sh`](package-release.sh) | Native end-to-end portable + Wails release build |

## Data directory

Same as the Octop CLI/server default:

- `OCTOP_HOME` → `~/.octop` (or the existing `OCTOP_HOME` env)
- Green runtime extract → `~/.octop/portable/`
- Shell prefs → `~/.octop/desktop-settings.json`

## Build green zip

From repo root:

```bash
make -f desktop/portable/Makefile green
```

CI: `.github/workflows/octop-desktop.yml` builds native platform/arch variants.
`v*` tags and `workflow_dispatch` (platforms=`all`) run all six; pull requests
that touch `desktop/` build `darwin-*` and `windows-*` (amd64 + arm64). Each job
first creates the green zip and then packages the matching Wails application.

## Build a complete desktop release

Run the release script on the matching native host. It builds the Dashboard and
Wails package. Full/local builds also create and verify the portable runtime;
remote Windows builds default to the thin client and skip Python packaging:

```bash
desktop/package-release.sh
# Reuse an existing desktop/portable/release/Octop-portable-<plat>-<version>.zip:
desktop/package-release.sh darwin-arm64 --reuse-portable
# Force a full/local Windows build when required:
OCTOP_DESKTOP_DEFAULT_SERVER_URL='' desktop/package-release.sh windows-amd64
```

Wails requires native packaging, so all six variants are produced by the CI
matrix on macOS, Linux, and Windows runners rather than cross-compiled locally.
Windows packaging also needs [NSIS](https://nsis.sourceforge.io/) (`makensis`)
so the `.exe` is an installer rather than a portable single-file binary.
Remote Windows releases use a thin client: no embedded Python backend and no video runtime. Video creation uses a separate, manually installed **Octop 视频制作组件** package under `%LOCALAPPDATA%\Octop\video-runtime`; users do not install Node or run npm individually. The client detects missing components and provides installation guidance and a local render verification. See [manual component setup](../docs/archive/desktop-auto-video-2026-10/manual-components.md). Existing full local builds remain available with an empty remote server URL.

Build the separate Windows video component installer from a Windows host with:

```powershell
cd desktop/src
wails3 task components:package ARCH=amd64 VERSION=0.9.31
```

The installer is written under `desktop/src/bin/` and installs only into the
current user's `%LOCALAPPDATA%\Octop\video-runtime`. A build-time
`VIDEO_COMPONENTS_URL` may expose a download link; leave it empty until an
official release URL exists. Locally validated, unsigned installers are not
published release artifacts.

## Build a slim desktop release

The slim variant ships the Wails shell without the embedded Python runtime
(~20 MB instead of ~300 MB). The first launch downloads the portable runtime
from the URLs baked in at build time and unpacks it locally. It exists because
Gitee caps a release attachment at 100 MB — see `docs/gitee-release.md`.

```bash
cd desktop/src
wails3 task package \
  ARCH=amd64 \
  VERSION=1.4.0 \
  PORTABLE_RUNTIME_URL="https://<bucket>.<endpoint>/octop/release/1.4.0/Octop-portable-windows-amd64-1.4.0.zip,https://github.com/<owner>/<repo>/releases/download/v1.4.0/Octop-portable-windows-amd64-1.4.0.zip"
```

`PORTABLE_RUNTIME_URL` is a comma-separated list; the shell tries the URLs in
order. The output is named `Octop-desktop-slim-<plat>-<version>.<ext>`.
Without the variable, `wails3 task package` produces the full client as before.

The download resumes where it stopped, and a mirror that fails hands over to
the next one. `PORTABLE_RUNTIME_MANIFEST_URL` points at a manifest that
describes the runtime parts — their URLs, sizes and sha256 checksums — and
takes precedence over `PORTABLE_RUNTIME_URL`:

```bash
cd desktop/src
wails3 task package \
  ARCH=amd64 \
  VERSION=1.4.0 \
  PORTABLE_RUNTIME_MANIFEST_URL="https://github.com/<owner>/<repo>/releases/download/<tag>/manifest.json" \
  PORTABLE_RUNTIME_MANIFEST_SHA256="<optional checksum of the manifest>"
```

See `docs/desktop-bootstrap-installer.md` §0.4 for the manifest format.

## Build the Wails shell

Run these from **`desktop/src`** (that directory contains `Taskfile.yml` and
`build/config.yml`). Requires **Go 1.25+**, [Wails v3](https://v3.wails.io/)
`v3.0.0-beta.13`.

```bash
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.13
cd desktop/src
go mod tidy
wails3 build            # development binary under desktop/src/bin/
wails3 task package ARCH=arm64 VERSION=<version> \
  PORTABLE_ZIP=../portable/release/Octop-portable-darwin-arm64-<version>.zip
```

Dev against an already-running Octop (skips the bundled green zip):

```bash
cd desktop/src
OCTOP_DESKTOP_URL=http://127.0.0.1:8088 wails3 dev
```

Without `OCTOP_DESKTOP_URL`, first launch uses `~/.octop/portable/` if valid,
otherwise extracts the matching zip shipped with the desktop package (embedded
in the Windows and Linux binaries, under `Contents/Resources` on macOS). The
Wails shell never downloads Octop. For local runtime debugging, set
`OCTOP_DESKTOP_PORTABLE_ZIP=/absolute/path/Octop-portable-<plat>-<version>.zip`.
On later launches, a newer bundled portable version replaces the extracted
runtime after creating a consistent SQLite backup under `~/.octop/backups/`.
The upgraded Octop process then applies the normal database migrations during
startup. Newer extracted runtimes are never downgraded; PostgreSQL remains
externally managed and is not copied by the desktop shell.

GitHub Release names follow `Octop-<kind>-<os>-<arch>-<version>.<ext>`:

- Desktop GUI: `Octop-desktop-<plat>-<version>.dmg` (macOS; open and drag
  `Octop.app` into Applications), `.exe` (Windows NSIS installer — copies
  into `Program Files\Octop` and creates Start Menu + desktop shortcuts),
  `.tar.gz` (Linux)
- Green runtime zip: `Octop-portable-<plat>-<version>.zip`
- PyPI wheels stay `octop-<version>-py3-none-any.whl` (PEP 427)

The Linux tar.gz contains only the GUI binary; it has no separate portable zip or
server terminal process. Runtime upgrades remain owned by Octop:
the shell sets `OCTOP_GREEN_PACKAGES`, so `octop update` upgrades the extracted
`packages/` directory through Octop's existing `--target` logic.

Linux also needs GTK4 + WebKitGTK 6 to link. macOS 12+.

## 开发者模式（直连远程后台）

开发模式让 PC 端外壳直接对接一个**已在运行的 Octop 后台**，不解包本地 portable
运行时、不启动本地 Python 进程。三件事同时生效：

1. **直连远程后台**：WebView 导航到远程地址。没有配置远程地址时直接报错，不退回本地
   运行时——「悄悄跑起一个本地 Octop」正是调试时最常见的困惑来源。
2. **开发者工具**：窗口启用 WebView 开发者工具，`Ctrl+Shift+D` 唤起，右键菜单里的
   「检查」也保留。
3. **详细日志**：导航日志（URL、请求、失败）同时打到 stderr，控制台实时可见。

开启方式：`OCTOP_DESKTOP_DEV=1`（环境变量）或 `-X main.defaultDevMode=1`（编译期）。
`OCTOP_DESKTOP_DEV=0` 关掉编译期打开的默认值；`OCTOP_DESKTOP_DEVTOOLS=0` 只关掉
「随窗口自动打开开发者工具」。

> 开发者工具由 Wails 的构建标签决定：带 `production` 标签的发行包不带调试器
> （见 Wails 的 `application_debug.go` / `application_production.go`）。因此开发模式
> 只在非 production 构建——`wails3 dev`、`wails3 task build` 的默认产物——里有意义。

### 一条命令启动

| 入口 | 界面来源 | API 来源 |
|---|---|---|
| `desktop/package-dev-remote.sh`（macOS / Linux / Git Bash） | 本地 dashboard（Vite 热更新） | 远程后台（Vite 代理） |
| `desktop/package-dev-remote.ps1`（Windows） | 同上 | 同上 |
| `… --direct` / `-Direct` | 远程后台 | 远程后台 |
| `desktop/start-desktop.bat` | 远程后台 | 远程后台（读系统 `OCTOP_DESKTOP_URL`） |

```powershell
# Windows：本地前端热更新 + 远程后台 API
powershell -File desktop/package-dev-remote.ps1

# Windows：连本机自建的后端
powershell -File desktop/package-dev-remote.ps1 -Remote http://127.0.0.1:8088
```

```bash
# macOS / Linux
desktop/package-dev-remote.sh
desktop/package-dev-remote.sh --direct
```

脚本做的事：按远程地址拆出 origin 与子路径 → 起 `dashboard` 的 Vite dev server
（`BASE_URL=<子路径>`、`VITE_API_TARGET=<origin>`）→ 等 `/videogen/api/health` 打通 →
以 `OCTOP_DESKTOP_URL=<本地 dev server>` + `OCTOP_DESKTOP_DEV=1` 跑 `wails3 dev`。

代理按原样透传子路径：`/videogen/api/…` → `https://ocbot.aixifs.com/videogen/api/…`，
并带上远程 origin 的 `X-Forwarded-Proto` / `X-Forwarded-Host`——SSO 回调域必须与
注册值一致，冒充本地 origin 会直接报 `redirect_uri 参数错误`。

| 环境变量 | 含义 |
|---|---|
| `OCTOP_DESKTOP_URL` | 外壳要加载的地址（开发模式下必填） |
| `OCTOP_DESKTOP_DEV` | `1` 打开开发模式 |
| `OCTOP_DESKTOP_DEVTOOLS` | `0` 不随窗口自动打开开发者工具 |
| `OCTOP_DEV_REMOTE_URL` | 脚本用：远程后台地址 |
| `OCTOP_DEV_VITE_PORT` | 脚本用：本地 dashboard dev server 端口 |

产品侧需求与验收见 [PRD §4.2](../docs/PRD.md)。

## Icons

| File | Used for | Rule |
|------|----------|------|
| `src/build/appicon.png` | Windows `.ico`, Linux | Full-bleed 512x512 artwork |
| `src/build/appicon-macos.png` | macOS `.icns` | 1024x1024 canvas, artwork 824x824 centred |
| `src/assets/tray-icon.png` | Tray + app icon on Windows/Linux | Full-bleed |
| `src/assets/tray-icon-template.png` | macOS menu bar | 88px canvas, 64px black-on-transparent glyph |

macOS sizes both surfaces to a fixed box, so the padding has to live in the
artwork: the Dock follows Apple's 824/1024 icon grid, and Wails scales the menu
bar image to the full `NSStatusBar` thickness (22pt) where the glyph should be
~16pt. Full-bleed sources on either surface render a size bigger than every
other app. On macOS the Dock icon comes from the bundle's `icons.icns` only —
see `applyAppIcon` in `src/icons_darwin.go`.
