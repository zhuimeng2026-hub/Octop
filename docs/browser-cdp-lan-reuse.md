# 复用桌面 Chrome 登录态（CDP 局域网共享）

让**服务器上的 Octop** 直接操作**你自己电脑上已登录的浏览器** —— 视频号助手
（channels.weixin.qq.com）、公众号后台（mp.weixin.qq.com）、任何需要扫码登录的后台。

服务器不再自己开一份 Chromium、不再自己扫码，登录态就是桌面那台 Chrome 的 cookie。

本文是一份**可执行的实测手册**：桌面端（Windows）配一次，服务器端（Linux）按清单验，
每步都带命令、期望输出和判定标准。

> 配套知识笔记（知识库仓库 `ob-vault`）：
> `微信生态/视频号助手网页操作-浏览器能力与登录态.md` → 路线 C。

---

## 0. 30 秒速览

```
┌──────────────── 桌面端 Windows（192.168.20.172） ────────────────┐
│  Chrome  --remote-debugging-port=9222                            │
│           --user-data-dir=C:\Users\Admin\chrome-cdp-profile      │
│           （已扫码登录视频号助手）                                  │
│                      │  127.0.0.1:9222                          │
│                      ▼  netsh portproxy（0.0.0.0:9223 → 127.0.0.1:9222）│
│  0.0.0.0:9223  ─────┘  防火墙仅放行 192.168.20.0/24              │
└──────────────────────────────┬───────────────────────────────────┘
                               │ CDP over HTTP/WS
┌──────────────────────────────▼───────────────────────────────────┐
│  服务器 Linux（192.168.20.173）                                   │
│  ~/.octop/env:  BROWSER_USE_CDP_HOST=192.168.20.172                │
│                  BROWSER_USE_CDP_PORT_START=9223                   │
│  Octop agent → browser_use 工具 → octop-browser → 直连桌面 Chrome │
└──────────────────────────────────────────────────────────────────┘
```

| 端口 | 绑定 | 谁用 |
|---|---|---|
| `9222` | `127.0.0.1` | Chrome 本体，只在桌面本机可连 |
| `9223` | `0.0.0.0` | portproxy 入口，暴露给局域网（服务器用这个） |

**为什么必须有 9223 这一层**：Chrome 89+ 把调试端口**硬编码绑到 `127.0.0.1`**，
`--remote-debugging-address` 这个参数被忽略（填 `0.0.0.0` 也一样只听回环）。
只能用 `netsh interface portproxy` 做端口转发把它捅出去。

---

## 1. 适用 / 不适用

| | |
|---|---|
| ✅ 适合 | 一次登录、长期复用；服务器跑定时任务（每天自动发视频号）；桌面有人值守、Chrome 可以一直开着 |
| ✅ 适合 | 需要**人工介入**的场景：服务器发指令，桌面 Chrome 上直接看到进度、扫码、点确认 |
| ❌ 不适合 | 桌面经常关机 —— 服务器侧会整条链路断（这是设计如此，不是 bug） |
| ❌ 不适合 | 需要**完全无人值守**且桌面不在线 —— 那种情况应该在服务器自己维护一份 profile 登录态 |

---

## 2. 前置条件

**桌面端（Windows）**

- Chrome 89+（实测 152 可用）
- 管理员 PowerShell（`netsh` 要管理员，WorkBuddy 沙箱里 `netsh` 会被**静默拦截**，无任何输出）
- 一个**非默认**的 `--user-data-dir`（见坑 1）

**服务器端（Linux）**

- Octop 已在本机跑起来（本机：`uv run octop run --host 0.0.0.0 --port 8188`）
- `octop-browser` 已装（随 `octop-harness` 一起装，`/opt/Octop/.venv/bin/octop-browser`）
- 两台机器同网段（桌面 `192.168.20.172`，服务器 `192.168.20.173`）

---

## 3. 桌面端操作

### 3.1 起 Chrome（非默认 profile）

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="C:\Users\Admin\chrome-cdp-profile"
```

> **不要用默认 profile**：Chrome 对默认 `User Data` 目录直接报错
> `DevTools remote debugging requires a non-default data directory`。
> 也**不要试图复制默认 profile**（本机那个目录 36.8 GB，排除缓存后仍有 10 GB）。
>
> Chrome **必须由你手动启动并保持运行**。WorkBuddy 沙箱拉不起持久 GUI 进程，
> 后台 `&` / `nohup` / `Start-Process` 起的 Chrome 会随命令结束被回收。

### 3.2 建端口转发 + 防火墙（管理员 PowerShell）

```powershell
netsh interface portproxy add v4tov4 `
  listenport=9223 listenaddress=0.0.0.0 `
  connectport=9222 connectaddress=127.0.0.1

New-NetFirewallRule -DisplayName 'Chrome CDP 9223' `
  -Direction Inbound -Action Allow -Protocol TCP `
  -LocalPort 9223 -RemoteAddress 192.168.20.0/24
```

> 防火墙规则**必须限定网段**，不要开放给所有来源（见 §8 安全）。
> 桌面已有现成脚本：`C:\Users\Admin\chrome-cdp-lan.bat`（管理员窗口运行，
> 自提权 → 确认 9222 就绪 → 建 portproxy → 建防火墙 → LAN 自检）。
> Chrome 不用重启，现有窗口和登录态都保住。

### 3.3 桌面本机自检

```powershell
curl http://127.0.0.1:9222/json/version
netsh interface portproxy show v4tov4
#    期望: 0.0.0.0  9223  ->  127.0.0.1  9222
```

### 3.4 登录视频号助手

在**这个 Chrome 窗口**里打开 https://channels.weixin.qq.com/ ，微信扫码登录。
登录态落在这个 profile（`chrome-cdp-profile`）里，服务器后续直接复用。

---

## 4. 服务器端配置

### 4.1 两种连接模式

| 模式 | 环境变量 | 特点 |
|---|---|---|
| **A. HOST + PORT（首选）** | `BROWSER_USE_CDP_HOST=192.168.20.172`<br>`BROWSER_USE_CDP_PORT_START=9223` | octop-browser 正常走 launcher，**只是 launcher 不在本地拉 Chrome，改成去这个 host 的这个 port 接管**。支持 `new-tab` / `switch-tab`。 |
| B. 直连 WS（备选） | `BROWSER_USE_CDP_WS_URL=ws://192.168.20.172:9223/devtools/browser/<id>` | 完全绕过 launcher 直接连。**不能切标签页**（`session.py` 明确抛 `Cannot switch tabs when connected via BROWSER_USE_CDP_WS_URL`）。WS 地址要带 `<id>`，每次 Chrome 重启都会变，所以只在 mode A 走不通时用。 |

**为什么首选 A**：A 模式下 `switch-tab` 可用，而且不需要手工维护会变的 WS 地址。

> 远程模式下如果端口不通，octop-browser 不会退回本地拉 Chrome，而是报
> `Cannot launch Chrome on remote host '<host>'` 并提示改用
> `--remote-debugging-address` 或 `BROWSER_USE_CDP_WS_URL` —— 这是预期行为，
> 看到它就说明 9223 没通，回去查防火墙和 portproxy。

### 4.2 写进 Octop 的全局环境变量

环境变量文件是 **`~/.octop/env`**（dotenv 格式，**不是** `.env`）。

- 服务启动时由 `infra/server.py` 的 `apply_env_file()` 合并进进程 `os.environ`
- 面板「设置 → 高级设置 → 环境变量」（`/advanced-settings`）改完会**立即写盘并生效**
  （`apply_env_file_replace`），不需要重启

写入内容：

```bash
BROWSER_USE_CDP_HOST=192.168.20.172
BROWSER_USE_CDP_PORT_START=9223
```

> `browser_use` 工具是在 **Octop 服务进程内**执行的，读的是服务进程的 `os.environ`，
> 所以变量必须进到 Octop 进程里，而不是只进 agent 的 workspace `.env`。

### 4.3 profile 与端口的对应关系（重要）

octop-browser 给每个 profile 分配一个 CDP 端口，**从 `BROWSER_USE_CDP_PORT_START` 开始递增**，
分配结果持久化在 `~/.octop-browser/profiles/.octop-browser-profiles.json`。

| profile 名 | 分配端口 | 说明 |
|---|---|---|
| `user-1`（Octop 第一个用户） | 9223 | 桌面上有 9223 → ✅ |
| `user-2`（第二个用户） | 9224 | 桌面上没有 → ❌ 连接失败 |

Octop 的 profile 名由 `infra/utils/browser_media.py` 的 `user_browser_profile()` 生成，
形如 `user-<user_id>`。

**两条应对办法，选一条：**

1. **多暴露几个端口**（推荐，多用户场景）—— 桌面端多加几条转发，全部指向同一个 Chrome：

   ```powershell
   9223..9228 -> 127.0.0.1:9222
   ```

   同一个 Chrome、同一份登录态，只是多了几个入口。

2. **CLI 测试时用同一个 profile 名** —— 别用 `default` 去占掉 9223，
   否则 Octop 的 `user-1` 会被分到 9224：

   ```bash
   .venv/bin/octop-browser list-tabs --profile user-1 --json
   ```

---

## 5. 实测步骤

### A 段 · 连通性（服务器端，先做这三条）

```bash
# A1 桌面 Chrome 的 CDP 入口通不通
curl -s -m 5 http://192.168.20.172:9223/json/version
```

期望：返回 JSON，含 `"Browser": "Chrome/152.0.7977.77"` 和 `webSocketDebuggerUrl`。
**Chrome 152 会自动把 ws URL 里的 host:port 换成 LAN 地址**（尊重 Host header），
拿到的地址可直接用，不用手动替换。

空输出 = 端口不通 → 桌面 Chrome 没开 / portproxy 没建 / 防火墙没放行。

```bash
# A2 桌面当前开着哪些标签页
curl -s -m 5 http://192.168.20.172:9223/json/list | head -30
```

期望：能看到 `channels.weixin.qq.com`（先在桌面登录过）。

```bash
# A3 反向确认"确实只绑回环"，这反而是好事
curl -s -m 5 http://192.168.20.172:9222/json/version
```

期望：连不上或 502 —— 说明 Chrome 真的只听 `127.0.0.1`，转发路径才是对的。

### B 段 · 用 CLI 驱动桌面 Chrome（服务器端）

```bash
cd /opt/Octop
export BROWSER_USE_CDP_HOST=192.168.20.172
export BROWSER_USE_CDP_PORT_START=9223

# B1 看标签页（此时应该只有桌面开着的那些）
.venv/bin/octop-browser list-tabs --profile user-1 --json

# B2 打开视频号助手
.venv/bin/octop-browser navigate "https://channels.weixin.qq.com/" --profile user-1 --json

# B3 页面标题 —— 这一条就能判断登录态有没有复用
.venv/bin/octop-browser eval-js "document.title" --profile user-1

# B4 抓 DOM，看是「已登录的后台」还是「扫码登录页」
.venv/bin/octop-browser dom-tree --profile user-1 | head -40

# B5 截图（肉眼确认）
.venv/bin/octop-browser screenshot --path /tmp/channels.png --profile user-1
```

**判定标准**

| 观察 | 结论 |
|---|---|
| B3 返回含「视频号助手」的标题，B4 出现后台菜单（内容/数据/直播等），B5 截图是已登录后台 | ✅ **登录态复用成功**，路线 C 成立 |
| B3/B4 出现「扫码登录」 | ❌ 桌面那台 Chrome 没登录，或连的不是那个 profile —— 回 §3.4 |
| B1 就报 `Cannot launch Chrome on remote host` | ❌ 9223 不通 —— 回 A1 |
| B1 能列出标签页但 B2 卡住 | ⚠️ 桌面 Chrome 正在弹验证码 / 模态框，或该 tab 被别的程序占着 |

### C 段 · 通过 Octop 应用本身验证（最终目标）

1. 重启 Octop 服务（若没在面板上改的环境变量）：

   ```bash
   pkill -f "octop run --host 0.0.0.0 --port 8188"   # 按实际进程调整
   cd /opt/Octop && uv run octop run --host 0.0.0.0 --port 8188
   ```

   或在面板「高级设置 → 环境变量」里写好变量并保存（**保存即生效，不用重启**）。

2. 建一个 agent，在对话里让它操作视频号助手，例如：

   > 打开 https://channels.weixin.qq.com/ ，截图给我看看现在是已登录状态还是扫码页。

3. 判定：
   - 拿到一张**已登录后台**的截图 → ✅ 端到端打通
   - 截图是**扫码页** → 桌面登录态没被用上，检查 B 段是否通过（多半是 profile 名/端口不对）
   - 工具报 `browser_use blocked: the current turn has no Octop user id` →
     这不是本问题，是当前会话没有 Octop 用户上下文（`infra/agents/middleware/browser_profile.py`）

---

## 6. 已知限制

| 限制 | 出处 | 影响 |
|---|---|---|
| Chrome 调试端口硬绑回环，`--remote-debugging-address` 无效 | Chrome 89+ | 必须 portproxy 转发 |
| 默认 profile 上开 CDP 直接报错 | Chrome | 必须 `--user-data-dir` |
| `netsh` 在 WorkBuddy 沙箱被静默拦截（无输出） | 实测 | 转发/防火墙规则要管理员窗口手工建 |
| Chrome 不能由沙箱持久拉起 | 实测 | 必须人工手动开着 |
| 远程模式不能本地拉 Chrome，端口不通就报错 | `octop_browser/cdp/launcher.py` | 桌面关机 = 服务器报错，不是静默挂起 |
| `BROWSER_USE_CDP_WS_URL` 模式不能切 tab | `octop_browser/session.py` | 备选模式功能弱于 mode A |
| 单个 Chrome CDP 稳态并发连接上限 **256** | 实测 | 一个 Chrome 挂 3~5 个客户端舒服；更多要开多实例 |
| 别让多个客户端同时控制同一个 tab | 实测 | `Input.*` / `Page.navigate` 会互相覆盖 |
| **在 Chrome 里按 F12 会踢掉远程连接** | 实测 | 跑任务时别开 DevTools（reason `replaced_with_devtools`） |
| profile 端口递增分配 | `octop_browser/profile.py` | 多用户要桌面多暴露端口 |

---

## 7. 故障排查速查

| 症状 | 原因 | 修法 |
|---|---|---|
| `Cannot launch Chrome on remote host '192.168.20.172'` | 9223 不通 | 查 portproxy + 防火墙（§3.2），服务器端 `curl :9223/json/version` |
| Chrome 起不来：`DevTools remote debugging requires a non-default data directory` | 用了默认 profile | 加 `--user-data-dir`（§3.1） |
| 连上了但页面是扫码页 | 桌面没登录 / 连错 profile | 桌面重新登录；核对 profile 名与端口（§4.3） |
| `netsh` 命令无输出 | 沙箱静默拦截 | 管理员 PowerShell 手工执行 |
| 端口分配到了 9224 但桌面只开了 9223 | profile 端口递增 | 桌面多暴露端口，或统一用同一个 profile 名（§4.3） |
| 任务跑到一半连接断了 | 桌面按了 F12 / Chrome 被关 | 桌面别开 DevTools，别关 Chrome |
| `Cannot switch tabs when connected via BROWSER_USE_CDP_WS_URL` | 用了 mode B | 换回 mode A（HOST + PORT） |

---

## 8. 收尾（安全）

> ⚠️ 规则一开，**`192.168.20.0/24` 内任何机器都能完全控制这个浏览器**：
> 读写 cookie、以你的身份访问已登录站点、执行任意 JS。

用完务必关掉（管理员 PowerShell）：

```powershell
netsh interface portproxy delete v4tov4 listenport=9223 listenaddress=0.0.0.0
Remove-NetFirewallRule -DisplayName 'Chrome CDP 9223'
```

如果这台桌面要长期挂着给服务器用，就保持规则不删，但**务必把防火墙的
`RemoteAddress` 限定在 `192.168.20.0/24`**，别放开给整个互联网。

> `octop-browser close-session --kill` **不会**误杀桌面的 Chrome：
> `terminate_browser()` 对非本机 host（`cdp_host` 不是 `localhost`/`127.0.0.1`/`::1`）
> 直接返回 `False`，远程模式下的 idle 控制器也不会被创建。
> 但**别在桌面手动关 Chrome** —— 服务器侧会直接失去连接。

---

## 附：本文涉及的关键代码位置

| 位置 | 作用 |
|---|---|
| `src/octop/infra/server.py` | 启动时 `apply_env_file(~/.octop/env)` 合并进进程 `os.environ` |
| `src/octop/infra/utils/env_file.py` | `~/.octop/env` 的读写与合并（注意是 `env`，不是 `.env`） |
| `src/octop/infra/utils/browser_media.py` | `user_browser_profile()` → profile 名 `user-<id>` |
| `src/octop/infra/agents/middleware/browser_profile.py` | 强制把 `browser_use` 的 profile 绑到当前用户 |
| `src/octop/infra/agents/settings/tool_catalog.py` | 注册 `browser_use` 内置工具 |
| `octop_browser/settings.py` | `BROWSER_USE_CDP_HOST` / `BROWSER_USE_CDP_PORT_START` / `BROWSER_USE_CDP_WS_URL` |
| `octop_browser/cdp/launcher.py` | `launch_or_attach()`：远端 host 的接管与报错逻辑 |
| `octop_browser/session.py` | `switch_to_target()`：WS 模式禁止切 tab 的判断 |
| `octop_browser/profile.py` | profile → CDP 端口的分配规则 |
