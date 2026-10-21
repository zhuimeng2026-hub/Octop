# Octop × Remotion — 本机视频渲染

服务器上的 Octop（LLM 走 new-api）负责**产出视频脚本**，本机负责**渲染成片**。
两者之间只有两个文件面：服务器工作区里的 `render-jobs/<job_id>/` 目录，和渲染完成
后回到同一目录的 `final.mp4`。

```
服务器 workspace                    本机
render-jobs/<job>/          ──拉──▶  work/<job>/project/{script.json, assets/}
  script.json                            │
  assets/*                               ▼
                              Remotion 渲染（本地 Chromium + ffmpeg）
                                         │
  render-jobs/<job>/final.mp4 ◀──上传── out/final.mp4
```

本机**不需要**被外网访问：同步器只做出站请求。

## 目录

| 路径 | 说明 |
|------|------|
| `src/` | Remotion 工程（Composition + 场景组件）。渲染器用它出片，脚本只提供数据 |
| `src/types.ts` | `script.json` 的契约（TypeScript 类型 + 校验辅助函数） |
| `src/scenes/` | 六种场景的组件：title / bullets / image / video / text / endcard |
| `render.mjs` | 渲染器：`script.json` + `assets/` → mp4 |
| `sync.mjs` | 同步器：轮询服务器 → 下载任务 → 渲染 → 回传成片 |
| `example/` | 可直接跑的示例（`script.json` + 测试素材） |

## 一次性准备

```bash
cd remotion
npm install
node render.mjs --project example --quality draft   # 会自动下载 Remotion 的 Chromium
```

## 渲染单个任务

```bash
node render.mjs --project <dir> [--out <file.mp4>] [--quality draft|prod]
```

`<dir>` 需要包含：

```
script.json
assets/cover.png
assets/clip.mp4
```

- `--quality draft`：半分辨率 + crf 28，用于快速验证脚本（秒级出片）
- `--quality prod`：全分辨率 + crf 18，用于成品

## 常驻同步

```bash
node sync.mjs \
  --server https://ocbot.aixifs.com/videogen \
  --agent  <agent_id> \
  --token  <dashboard JWT> \
  --queue render-jobs \
  --interval 30
```

- `--once`：只跑一轮（适合 cron / 手工触发）
- `--work ./work`：本地工作目录（默认 `remotion/work`）
- `--deliver auto|server|local`：成片去向（默认 `auto`，见下）
- `--no-upload`：`--deliver local` 的别名
- 任务处理记录在 `work/state.json`，已完成的 job 不会重复渲染

### 成片去向：自动，不必手工切模式

| 模式 | 行为 | 需要的权限 |
|------|------|-----------|
| `auto`（默认） | 本机渲染后**自动尝试回传**；回传失败（如只读凭证）就留在本机，成片不会丢 | 只读即可 |
| `server` | 一定回传服务器，回传失败则该任务报错 | 读 + 写 |
| `local` | 只留本机 `work/<job>/project/out/final.mp4` | 只读 |

单个任务还能自己带指令，优先级高于上面的默认值：

- `script.json` 顶层的 `"deliver": "server" | "local"`（服务器上的模型写的）
- 或任务目录里一个 `deliver` 文件，内容为 `server` / `local`

所以「界面上自动切换」的做法是：用户在对话里说「成片发我」，模型就在 `script.json`
里写 `"deliver": "server"`；本机下一轮轮询就会把成片传回服务器，用户在聊天里就能看到。

### token 怎么拿

同步器需要一个**对该 agent workspace 有权限**的 JWT：

1. 浏览器登录 `https://ocbot.aixifs.com/videogen`，F12 → Application → Local Storage →
   `auth_token` 的值；或
2. 在能访问服务器 `~/.octop` 的机器上 `octop user login`，从 `~/.octop/cli_state.json` 取。

> workspace 的读写接口要求 **agent 处于运行中**（`require_running_workspace`），
> 也就是服务器上那个 agent 要开着。
>
> 服务器不需要能连到本机：同步器只做出站请求（GET 树 / 下载 / 可选上传）。

## 服务器侧（模型）要做什么

见 `../skills/remotion-video/SKILL.md`：模型只负责把素材和描述变成
`render-jobs/<job_id>/script.json` + `render-jobs/<job_id>/assets/`，
剩下的由本机同步器接手。

## 依赖

| 依赖 | 说明 |
|------|------|
| Node.js ≥ 18 | 实测 24.14 |
| Chromium | 优先用本机已装的（Playwright 的 / 系统 Chrome）；没有才让 Remotion 下载自己的 headless shell |
| ffmpeg | Remotion 内置；本机 8.1.2 可用 |
| 磁盘 | node_modules 约 400 MB（若需下载 Remotion Chromium 再加约 500 MB） |

### 关于 Chromium

`render.mjs` 会依次找：

1. 环境变量 `REMOTION_BROWSER_EXECUTABLE` 指定的路径；
2. `%LOCALAPPDATA%/ms-playwright/chromium-*/chrome-win64/chrome.exe`（Playwright 装的）；
3. `%LOCALAPPDATA%/Google/Chrome/Application/chrome.exe` 或 Edge。

都找不到才调用 `ensureBrowser()` 下载 Remotion 自带的 headless shell。

> **本机实测**：`storage.googleapis.com`（Remotion 的 Chromium 下载源）在这台机器上只有
> ~10 KB/s，150 MB 要下几小时。因此务必让渲染器用本机已有的 Chromium —— 装一次
> Playwright 的 chromium 即可：`npx playwright install chromium`。
> Remotion 也能用系统的 Chrome/Edge，指定路径即可：
> `REMOTION_BROWSER_EXECUTABLE="C:\Program Files\Google\Chrome\Application\chrome.exe"`.
