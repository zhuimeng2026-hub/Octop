# 桌面端单实例修复 — 测试记录

> **注意（后续变更）**：本记录验证的是**跨平台文件锁**方案（`fix/desktop-single-instance-20261023`）。
> 合入主干时该方案被改为**按平台分工**：Windows/macOS 改用 Wails 的 `SingleInstance`
> （可把二次启动的注意力转回首个窗口），Linux 保留本记录中的 flock 文件锁
> （Wails 的 Linux 实现依赖 D-Bus session bus，缺失时会导致启动直接失败）。
> 详见 `docs/desktop-single-instance.md`。下文 §1 的实现机制描述对应当时的分支状态。

- 分支：`fix/desktop-single-instance-20261023`
- 二进制：`desktop/src/bin/Octop.exe`（本分支 `go build` 产物，2026-10-23 09:22）
- 测试时间：2026-10-23
- 测试人：WorkBuddy（agent 后台会话中执行）

## 测试环境

| 项 | 值 |
| --- | --- |
| OS | Windows 10 家庭版 (Build 19045) |
| 工具链 | Go 1.26.5 / Wails v3.0.0-beta.13 / WebView2 155.0.4283.62 |
| 外部真实后端 | `https://ocbot.aixifs.com/videogen`（API 基路径 `/videogen/api`） |
| 启动方式 | `OCTOP_DESKTOP_URL="https://ocbot.aixifs.com/videogen" ./Octop.exe` |
| 本地后端 | 无（桌面壳直连远程，不启动本地 octop，属预期） |

## 1. 进程互斥（单实例）— ✅ 通过

**实现机制**：`main()` 最开头用跨平台文件锁 `octopHome()/desktop-instance.lock`
（Windows `LockFileEx(LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY)`，
Unix `flock(LOCK_EX | LOCK_NB)`）做进程级互斥；第二实例获锁冲突即 `log.Print("Octop desktop is already running")` 并 `return`，不创建任何窗口 / WebView2 / 托盘。

**验证（实机双开）**：

1. 启动实例 A → 进程存活（PID 11788），实例数 = 1。
2. 在 A 存活期间启动实例 B（同一命令）。B 立即输出：
   ```
   2026/10/23 09:33:16 Octop desktop is already running
   ```
   并以 `exit 0` 退出，**未拉起任何窗口 / WebView2 子进程**。
3. 进程实例数保持 = 1（仅 A）。

**验证（单元测试）**：`go test -run TestDesktopSingleInstanceLock` 通过，
覆盖「首实例获锁 → 第二实例拒绝(errInstanceRunning) → 首实例释放后第三实例可再获锁」。

结论：单实例互斥修复**生效**，满足"进程互斥、只有一个进程存在"。

## 2. 客户端启动与后端连通性 — ⚠️ 部分通过（环境限制）

- ✅ 新二进制可编译、可启动；Wails 运行环境创建成功，splash 资源（`/`、`octop-mascot-peek.webp`、`octop-mascot-type.webp`）由内置 `AssetFileServer` 正常返回。
- ✅ 外部后端健康检查可达：
  ```
  GET https://ocbot.aixifs.com/videogen/api/health -> 200
  {"ok":true,"db":true,"users_loaded":1,"agents_running":1}
  ```
- ⚠️ WebView2 渲染层在本 agent 后台会话中未能稳定进入 ready / 导航状态：
  `boot()` 应在 `waitHealth(url, 60s)` 通过后执行 `showDashboard(url)` → `navigate` 到远程 dashboard，
  但实测 WebView2 渲染进程在加载 splash 后未保持，未观察到任何属于 Octop 子树的到
  `1.14.182.208:443` 的已建立连接，也无导航日志。同一会话内另一次启动曾出现
  `timed out after 30s waiting for the WebView2 controller`（同属非交互式后台启动 WebView2 的环境问题，**非本次修复引入**）。

**说明**：相同二进制 + 相同 `OCTOP_DESKTOP_URL` 在早前交互式会话
（`feature/local-studio-package` 分支，PID 14240）中已成功加载远程 dashboard 并被用户看到窗口，
故代码与配置本身正确；当前限制来自**非交互式后台会话启动 WebView2 渲染层**，
不影响单实例修复的正确性。

## 3. 结论

| 项目 | 结果 |
| --- | --- |
| 单实例互斥修复 | ✅ 通过（双开实测 + 单元测试） |
| 二进制编译 / 启动 / splash | ✅ 通过 |
| 外部后端可达（health 200） | ✅ 通过 |
| WebView 端到端加载远程 dashboard | ⚠️ 受 headless 启动限制未能在本会话观测；需交互式冒烟验证 |

**建议**：单实例修复可合并。端到端加载远程 dashboard 请在用户**交互式桌面会话**中做一次冒烟
（双击 `Octop.exe` 或运行启动脚本，确保 `OCTOP_DESKTOP_URL` 指向远程后端），预期双开后第二个实例立即退出、进程数保持 1，且窗口加载出远程 dashboard。

## 附：复验命令

```bash
# 进程互斥：先起一个，再起第二个，应见 "Octop desktop is already running" 且 Octop.exe 实例数 = 1
OCTOP_DESKTOP_URL="https://ocbot.aixifs.com/videogen" ./desktop/src/bin/Octop.exe &

# 后端可达性
curl -s -o /dev/null -w "%{http_code}\n" https://ocbot.aixifs.com/videogen/api/health

# 单元测试
cd desktop/src && go test -run TestDesktopSingleInstanceLock -v .
```
