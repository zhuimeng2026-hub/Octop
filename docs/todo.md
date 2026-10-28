# 项目待办

**需要在特定环境完成、当前服务器环境做不了**的事项。

每条注明：环境要求、为什么不能在服务器做、已完成到哪一步、验收标准、相关文档。
服务器侧能做的部分**不要写进来** —— 直接做掉。

| # | 事项 | 需要的环境 | 状态 | 相关文档 |
|---|---|---|---|---|
| T-001 | 路线 C 实测：服务器复用桌面 Chrome 登录态操作视频号助手 | Windows 桌面端 | ⏳ 待安排 | [browser-cdp-lan-reuse.md](./browser-cdp-lan-reuse.md) |

---

## T-001 · 路线 C 实测（服务器复用桌面 Chrome 登录态）

**状态**：⏳ 待安排（2026-10-28 立项）

### 要做什么

验证服务器上的 Octop 能通过 CDP 局域网共享，**直接操作桌面 Windows 上已登录的
视频号助手**（channels.weixin.qq.com），服务器侧不需要自己扫码、不需要自己开浏览器。

完整步骤见 [browser-cdp-lan-reuse.md](./browser-cdp-lan-reuse.md)，A/B/C 三段。

### 为什么不能在服务器做

Chrome 跑在 Windows 桌面上，**扫码登录这一步只能在有屏幕、有微信扫码的地方完成**；
服务器是无头 Linux，没有桌面会话，也没有微信客户端。
而 `browser_use` 的价值恰恰在于**复用桌面那份登录态** —— 服务器自己扫码只是退回
路线 B（各自维护一套 profile），验证不了路线 C 的核心命题。

### 服务器侧已完成（不用重做）

- `octop-browser` 1.0.0 已装（`/opt/Octop/.venv/bin/octop-browser`），底层 `octop-browser` 走 CDP
- Chromium 在位（`/usr/bin/chromium-browser`）
- 端口探测与分层诊断法已写进手册 §5 A0
- 2026-10-28 实测：桌面 `192.168.20.172` 的 **3389 开 / 9223 开 / 9222 关**，
  `curl :9223` 结果为 `Connected → Connection reset by peer`
  → **portproxy 规则已建好，缺的是桌面 Chrome 那一端**
- 环境变量写法已确认：写进 `~/.octop/env`（**不是 `.env`**），
  `BROWSER_USE_CDP_HOST` + `BROWSER_USE_CDP_PORT_START`；面板「高级设置 → 环境变量」保存即生效

### 桌面端要做的

1. **先关掉所有 Chrome**（含托盘），再执行：

   ```powershell
   & "C:\Program Files\Google\Chrome\Application\chrome.exe" `
     --remote-debugging-port=9222 `
     --user-data-dir="C:\Users\Admin\chrome-cdp-profile"
   ```

   > 已在运行的 Chrome 会复用旧进程并直接退出，`--remote-debugging-port` 不生效，
   > 9222 不会开 —— 症状就是服务器侧 `9223` 连上但 reset。

2. 在这个窗口里打开 https://channels.weixin.qq.com/ ，微信扫码登录
3. 保持这个 Chrome 开着（WorkBuddy 沙箱拉不起持久 GUI 进程，只能手动开着）

### 验收标准

| 段 | 判定 |
|---|---|
| A | 服务器 `curl http://192.168.20.172:9223/json/version` 返回 JSON（含 `webSocketDebuggerUrl`） |
| B | `octop-browser eval-js "document.title"` 返回含「视频号助手」的标题；`dom-tree` 出现后台菜单（内容 / 数据 / 直播）；截图是**已登录后台**而非扫码页 |
| C | Octop agent 用 `browser_use` 打开视频号助手，截图同样是已登录后台 |

### 收尾

测完在桌面管理员 PowerShell 里撤掉转发与防火墙：

```powershell
netsh interface portproxy delete v4tov4 listenport=9223 listenaddress=0.0.0.0
Remove-NetFirewallRule -DisplayName 'Chrome CDP 9223'
```

### 实测完成后

- 把真实输出回填到 [browser-cdp-lan-reuse.md](./browser-cdp-lan-reuse.md) 的「实测记录」表
- 知识库笔记 `微信生态/视频号助手网页操作-浏览器能力与登录态.md` 里的路线 C 一节，
  把「待实测」改成实测结论

### 相关

- [browser-cdp-lan-reuse.md](./browser-cdp-lan-reuse.md)：完整实测手册
- [deployment-pitfalls.md](./deployment-pitfalls.md)：部署类踩坑的写法参考
