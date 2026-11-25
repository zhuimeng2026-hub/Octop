# Develop 分支专有：PC 桌面客户端热加载开发与调试环境

> 适用范围：**仅 `develop` 分支**。本文记录在 Windows 本机从「同步远端 → 建独立测试实例 → 配 LLM → 启动热加载 PC 客户端 → 调试登录 → 排障」的完整可复现流程。
>
> 背景：桌面壳是 Wails v3（`desktop/src/`），前端是 `dashboard/`（Vite + React）。二者是独立进程：桌面壳通过 `OCTOP_DESKTOP_URL` 指向前端地址，前端通过 Vite 代理把 `/api/*` 转发到后端。调试登录（D7）是 develop-only 功能，**发布候选不包含**（DSK-006 仍需真实微信扫码）。
>
> 相关必读：[PRD §4.3 微信登录调试开关](PRD.md#43-微信登录调试开关d7)、[桌面验收用例](eval/examples/desktop-login-debug.yaml)、[Windows 桌面构建说明](desktop-windows-build.md)、[部署边界](../AGENTS.md)。

---

## 〇、组件拓扑（先建立心智模型）

```
┌───────────────────────────────────────────────────────────────────────┐
│  桌面壳 Octop.exe (Wails v3, WebView2)                                │
│    - 开发模式：OCTOP_DESKTOP_DEV=1（跳过本地 portable 运行时，开 DevTools）│
│    - OCTOP_DESKTOP_URL         → 前端地址（Vite）                       │
│    - OCTOP_DESKTOP_AUTH_URL    → 后端地址（微信 SSO / 调试登录回跳）        │
└──────────────────────────────┬────────────────────────────────────────┘
                               │ HTTP 加载页面 + Wails 桥
                               ▼
┌───────────────────────────────────────────────────────────────────────┐
│  Vite dev server（dashboard/）                                         │
│    - 普通热加载: 0.0.0.0:5173，BASE_URL=/videogen，代理远程 ocbot        │
│    - 调试登录  : 127.0.0.1:5174（strictPort），代理本机测试后端 :8088      │
│    - 前端改动 → HMR，无需重建桌面壳                                      │
└──────────────────────────────┬────────────────────────────────────────┘
                               │ Vite proxy /api/*
                               ▼
┌───────────────────────────────────────────────────────────────────────┐
│  后端 octop run（独立 OCTOP_HOME 测试实例）                             │
│    - 127.0.0.1:8088，SQLite，独立 DB/数据，绝不复用 ~/.octop 或远程 ocbot │
│    - /api/auth/login、/api/auth/me、/api/agents、chat/ws               │
└──────────────────────────────┬────────────────────────────────────────┘
                               │ LLM provider（OpenAI 兼容）
                               ▼
                    网关（见本文 §3，密钥不落盘）
```

**三条铁的边界**：
1. 前端源码（`dashboard/`）与后端源码（`src/octop/`）是两个部署单元；改前端只触发 Vite HMR，不需要重建后端。
2. 调试登录只认**回环**后端（`127.0.0.1`/`localhost`/`[::1]`），非回环目标或直连远程模式一律拒绝。
3. 测试实例用独立 `OCTOP_HOME`，不能碰 `~/.octop` 或远程 ocbot 的数据。

---

## 一、工具链与前置条件

| 组件 | 版本 / 要求 | 检查命令 |
|---|---|---|
| Go | 1.25+（实测 1.26.5） | `go version` |
| Wails CLI | v3.0.0-beta.13 | `wails3 version` |
| Node.js | 22.x | `node -v` |
| Python | 3.12+（uv 管理） | `uv run octop version` |
| 前端依赖 | `dashboard/node_modules` 存在 | `test -d dashboard/node_modules` |

安装 Wails：
```bash
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.13
```

> **Node 路径提示**：本机 Node 由 WorkBuddy 管理，路径形如
> `C:\Users\huawei\.workbuddy\binaries\node\versions\22.22.2-6`。启动脚本里必须显式
> 把它和 Go（`C:\Users\huawei\go\bin`）放进 PATH，且**不要**把 WorkBuddy 的 Python
> 放进 PATH（见 §7 坑 A）。npm 一律加 `--registry=https://registry.npmmirror.com`。

---

## 二、同步 develop 到最新

远端有 5 个：`origin`（团队 fork）、`fork`、`gitee`、`cnb`、`upstream`（上游只读）。
日常以 **origin/develop** 为准。

```bash
# 逐个 fetch（不要 git fetch --all，会被安全策略拦截）
for r in origin fork cnb gitee upstream; do git fetch "$r" --prune; done

# 查看差距
git status -sb                                  # 看 ahead/behind
git rev-list --count HEAD..origin/develop       # 落后多少
git rev-list --count origin/develop..HEAD       # 领先多少（0 表示可快进）

# 合并预检
git merge-tree --write-tree develop origin/develop   # rc=0 无冲突

# 工作区若全是换行符噪音（CRLF/LF），先甄别再清理：
git diff --ignore-cr-at-eol --numstat | wc -l   # 0 → 全是换行符，无真实改动
git checkout -- dashboard/                       # 清理噪音

# 快进合并
git merge --ff-only origin/develop
```

> **注意**：若本地领先 >0，需改用 `git merge --no-ff origin/develop`（产生合并提交），
> 合并后用 `comm -12` 检查双方共同改过的文件，重点核对大文件逻辑未丢失。
> 收尾 develop→main 也用 merge commit，不 squash。

---

## 三、建独立测试实例 + 自动生成测试账号

D7 要求：独立 `OCTOP_HOME` + 普通（非管理员）账号。以下用
`C:\Users\huawei\.octop-debug` 作为测试实例根目录。

```bash
export OCTOP_HOME="C:/Users/huawei/.octop-debug"

# 1) 初始化（自动生成管理员）
uv run octop init \
  --admin-username debugadmin \
  --admin-password 'DebugAdmin@2026' \
  --yes

# 2) 建普通测试账号（role=user，调试登录要求 user 角色）
uv run octop user create debuguser \
  --password 'DebugUser@2026' \
  --role user \
  --display-name 'Debug Tester'
```

**关键坑**：`octop user create` **不会**自动创建默认 agent（CLI 不传 template_id，
`users.py` 里的 `try_bootstrap_default_agent` 不触发），所以登录后会出现「助手没有准备成功」。
必须手动补建：

```bash
uv run octop agent create "我的助手" --user debuguser
# → {"agent_id": "03TBFB", "name": "我的助手"}
```

确认：`python -c "import sqlite3; c=sqlite3.connect(r'C:\Users\huawei\.octop-debug\octop.db'); print(c.execute('select agent_id,name,user_id from agents').fetchall())"`

---

## 四、配置 LLM provider（否则界面能进但不能对话）

新测试实例 `providers` 表为空 → `/api/providers/resolved` 返回 `[]` → 对话无模型可用。
需配一个 **OpenAI 兼容**网关。密钥**只在命令行环境变量传递，不写进任何文件或日志**。

```bash
# 从本机主凭据读 base_url 与 token（示例：~/.claude/settings.json 的 env）
# ANTHROPIC_BASE_URL=https://aikey4k.mengxa.com:8443  —— 实测其 /v1 是 OpenAI 兼容
# ANTHROPIC_AUTH_TOKEN=<本机主 token，不落盘>

uv run octop provider create \
  --name dev-gateway \
  --kind openai \
  --base-url "$BASE/v1" \
  --api-key "$TOKEN" \
  --models '[{"id":"qwen3.8-flash","name":"qwen3.8-flash","enabled":true}]'

uv run octop models active --provider dev-gateway --model qwen3.8-flash

# 验证连通（one-token ping）
uv run octop provider test 1 --model qwen3.8-flash
```

**选模型的坑**：网关模型列表里 `supported_endpoint_types` 含 `openai` 才能用于
Octop 的 OpenAI provider。实测可用：`qwen3.8-flash`、`qwen3.5-35b-a3b`、
`deepseek-v4-pro-0813`、`glm-5.3-prime` 等。

**必须重启后端**（CLI 离线写入不会触发运行中后端的 `on_provider_changed`）：
```bash
# 用精确 PID 停后端，不要用 taskkill /IM（见 §7 坑 B）
taskkill //F //PID <backend_pid>
# 然后按 §5 重新启动
```

验证：`/api/providers/active-model` 返回 `{"provider_name":"dev-gateway","model":"qwen3.8-flash"}`，
`/api/providers/resolved` 返回含 `qwen3.8-flash` 的列表。

---

## 五、启动后端（本机测试实例）

用 Bash 工具的后台机制运行（**不要加 `&`**，否则 shell 退出会把子进程一起回收）：

```bash
cd /d/Octop
MSYS_NO_PATHCONV=1 \
OCTOP_HOME="C:/Users/huawei/.octop-debug" \
OCTOP_BIND_HOST=127.0.0.1 OCTOP_PORT=8088 \
uv run octop run --host 127.0.0.1 --port 8088
# 用 run_in_background=true 提交
```

健康检查（首次启动约 13s，第一次请求常为空，需重试）：
```bash
curl -s --noproxy '*' http://127.0.0.1:8088/api/health
```

---

## 六、启动热加载 PC 客户端（两种模式）

### 6.1 直接启动已构建 exe（推荐，绕开 wails3 dev 的 build 阶段）

官方 `desktop/package-dev-remote.ps1/.sh` 内部走 `wails3 dev`，后者每次都跑一遍
`wails3 task build`；本机经 explorer 启动时该阶段稳定报 `exit status 49`（见 §7 坑 A）。
因此采用「手动 build 一次 + 自包含 .bat 拉起 Vite 和 exe」：

```bash
cd desktop/src && wails3 task build       # 生成非 production 的 bin/Octop.exe（带调试器）
```

`.workbuddy/dev-client-direct.bat`（普通热加载，连远程 ocbot）：
```bat
@echo off
chcp 65001 >nul
set "NODE_BIN=C:\Users\huawei\.workbuddy\binaries\node\versions\22.22.2-6"
set "PATH=%NODE_BIN%;C:\Users\huawei\go\bin;C:\Windows\System32;C:\Windows;C:\Windows\System32\Wbem"
cd /d D:\Octop\dashboard
set "BASE_URL=/videogen"
set "VITE_API_TARGET=https://ocbot.aixifs.com"
set "VITE_DEV_PORT=5173"
set "OCTOP_DEV_SKIP_WECHAT_LOGIN=0"
start "Octop-Vite-HMR" /MIN cmd /c ""%NODE_BIN%\npm.cmd" run dev"
REM ...（轮询 http://127.0.0.1:5173/videogen/api/health）...
cd /d D:\Octop\desktop\src
set "OCTOP_DESKTOP_URL=http://127.0.0.1:5173/videogen/"
set "OCTOP_DESKTOP_AUTH_URL=https://ocbot.aixifs.com/videogen"
set "OCTOP_DESKTOP_DEV=1"
start "Octop-Dev-Shell" /MIN cmd /c ""D:\Octop\desktop\src\bin\Octop.exe""
```

### 6.2 调试登录模式（D7，免微信扫码）

Vite 约束（硬编码在 `dashboard/vite.config.ts`，不满足会拒绝启动）：

| 变量 | 值 | 说明 |
|---|---|---|
| `VITE_DEV_PORT` | `5174` | 调试模式强制固定端口 |
| Vite host | `127.0.0.1` | strictPort，隔离浏览器会话 |
| `VITE_API_TARGET` | `http://127.0.0.1:8088` | 纯 loopback origin，无子路径 |
| `BASE_URL` | 空（相对） | 本机实例无 `/videogen` 前缀 |
| `OCTOP_DEV_SKIP_WECHAT_LOGIN` | `1` | 开关 |
| `OCTOP_DEV_LOGIN_USERNAME` | `debuguser` | 普通账号（role=user） |
| `OCTOP_DEV_LOGIN_PASSWORD` | `DebugUser@2026` | 仅从 Vite 进程环境读取，不进浏览器/日志 |

`.workbuddy/dev-client-debuglogin.bat` 按上表设置 Vite，然后：
```bat
set "OCTOP_DESKTOP_URL=http://127.0.0.1:5174/"
set "OCTOP_DESKTOP_AUTH_URL=http://127.0.0.1:8088"
set "OCTOP_DESKTOP_DEV=1"
start "Octop-Debug-Shell" /MIN cmd /c ""D:\Octop\desktop\src\bin\Octop.exe""
```

**必须在用户会话启动**（项目铁律）：工具会话直拉 WebView2 会秒崩。用：
```powershell
Start-Process explorer.exe -ArgumentList "D:\Octop\.workbuddy\dev-client-debuglogin.bat"
```

调试登录链路：前端 POST 同源 `/__octop_dev_login` → Vite 中间件用环境变量里的账号密码
POST `http://127.0.0.1:8088/api/auth/login` → 校验返回 `user.role=="user"` 且无 MFA →
签发 JWT → 前端存当前窗口会话 → 鉴权守卫确认 `/api/auth/me` → 进入应用。
跨来源请求返回 403，登录响应 `Cache-Control: no-store`。

---

## 七、常见坑（按踩坑频率排序）

### 坑 A：`wails3 dev` 在 `generate:syso` 报 `exit status 49`
- 现象：`python stamp_version.py json ...` 报 `exit status 49`，`wails3 task build` 失败。
- 真相：单独在 Bash 跑同样命令 rc=0，手动 `wails3 task build` 也 rc=0。是 .bat 经 explorer
  启动时 PATH 混入 WorkBuddy 的 Python 3.13 与 go-task 内部环境冲突导致的偶发问题。
- 规避：用 §6.1 的「手动 build + 自包含 .bat」，PATH 只放 Node + Go + System32，不放 Python。

### 坑 B：`taskkill /IM Octop.exe` 会连后端一起杀
- Windows 进程名大小写不敏感，后端 `.venv\Scripts\octop.exe` 和桌面壳 `Octop.exe`
  会被同时匹配。
- 正确做法：用 PowerShell 查精确 PID 再杀：
  ```powershell
  Get-CimInstance Win32_Process -Filter "Name='octop.exe'" | Select ProcessId,CommandLine
  taskkill /F /PID <精确PID>
  ```
  后端命令行带 `run --port 8088`，桌面壳命令行是 `desktop\src\bin\Octop.exe`。

### 坑 C：登录后显示「助手没有准备成功」
- 原因：测试实例 agents 表为空（见 §3）。
- 修复：`uv run octop agent create "我的助手" --user debuguser`，重启桌面壳。

### 坑 D：界面能进但不能对话
- 原因：测试实例没有 LLM provider（见 §4）。
- 修复：配 provider + active model + 重启后端。
- 判断对话是否真的成功：uvicorn 日志不记录 LLM 内部调用，要查库：
  ```python
  import sqlite3, json
  c = sqlite3.connect(r'C:\Users\huawei\.octop-debug\octop.db')
  for rid, role, mj in c.execute('select id,role,message_json from thread_messages order by id'):
      d = json.loads(mj); print(rid, role, json.dumps(d, ensure_ascii=False)[:160])
  ```
  有 human → ai(推理) → tool(工具调用) → ai(最终回复) 即对话成功。

### 坑 E：装完制作组件后还要手动点「验证制作环境」
- **develop 新语义（2026-11-25）**：组件下载解压完成后，桌面壳会**自动跑一次真实渲染验证**（`video_install.go` 的 `runPostInstallVerification()` → `startEnvironment("verify")`），成功后直达 `ready`，无需再手动点验证按钮。验证仍是一段 1 秒测试 MP4，不是简单文件检查。
- 触发 BUSY（下载后狭窄窗口内有渲染任务）时会降级为普通 check，并在日志里写明；此时仍可能显示「尚未验证」，手动点一次即可。
- **验证失败一定有日志**：worker 的真实 stderr（堆栈/模块错误）逐行写入 **exe 同目录 `desktop-nav.log`**（4MB 轮转，dev 模式同时打 stderr）。相关行：
  - `video install: parts in place, starting automatic render verification`（自动验证起点标记）
  - `video environment state=... code=...` / `video env: verify failed (code=... waitErr=... final=...)`（结果与真实原因）
- 排障直接 `grep -iE 'video (install|env|environment)' <exe目录>/desktop-nav.log`。

### 坑 F：后台启动后端子进程被回收
- 用 Bash 后台命令时若命令里带 `&`，工具的外层 shell 退出会一并杀掉子进程。
- 正确：直接用工具的 `run_in_background=true`，命令里**不要**加 `&`。

### 坑 G：健康请求首次为空
- `octop run` 首次启动约 13s，第一次 `/api/health` 常为空。用重试循环，不要一次就下结论。

---

## 八、验证清单（逐项确认）

在上述环境完整跑通后，以下均应成立：

- [ ] `git status -sb` 显示 `## develop...origin/develop` 无 ahead/behind
- [ ] `go build ./...`（desktop/src）与 `npx tsc -b`（dashboard）均 rc=0
- [ ] 本机后端 `/api/health` = 200；`/api/providers/resolved` 非空
- [ ] Vite 5174 就绪 → shell 日志 `boot: health probe ok`、`WebView2 Environment created successfully`
- [ ] 调试登录端点 `/__octop_dev_login` 同源 200 返回 JWT（payload `sub=2, role=user`），跨来源 403
- [ ] `/api/auth/me` 返回 `debuguser`；`/api/agents` 200 且含 `我的助手`
- [ ] 桌面壳 DevTools 标题为 `127.0.0.1:5174/?desktop=1`（非 login 页）→ 自动登录进入主界面
- [ ] 发一条消息后，`thread_messages` 出现 human → ai → tool → ai 完整消息链
- [ ] 改 `dashboard/src/App.tsx` → Vite 日志出现 `[vite] (client) hmr update /src/App.tsx` → 热加载生效
- [ ] 测试完成后清除 `OCTOP_DEV_SKIP_WECHAT_LOGIN`（或设 0），退出调试窗口 → 恢复微信登录入口

---

## 九、收尾

调试会话结束：
1. 关掉桌面窗 + Vite（5174）+ 本机后端（8088）。
2. 清除 `OCTOP_DEV_SKIP_WECHAT_LOGIN` 环境变量，避免误入调试模式。
3. 独立测试实例 `~/.octop-debug` 可保留复用，或整体删除（不影响 `~/.octop`）。
4. **发布前必做**：按 DSK-006 用 `release/*` 候选做生产构建，确认调试端点 404、
   强制传入开关也无法启用，并完成真实微信扫码 + 回调 + 桌面会话恢复验收。
