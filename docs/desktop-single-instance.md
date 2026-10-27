# 桌面端进程互斥（单实例）复核

## 2026-10-27：Windows 在 Wails 初始化前拦截重复启动

针对重复启动后系统托盘出现残留图标的反馈，Windows 增加了入口级保护：

- `instance_lock_windows.go` 在 `main()` 开头原子创建命名自动重置事件
  `Local\com.octop.desktop.instance`。只有创建者可以继续初始化 Wails、窗口和托盘。
- 后续进程只发送事件通知并退出，不进入 `application.New`。事件会保留首实例
  尚未完成启动时收到的通知，多次点击会合并。
- 首实例在 `ApplicationStarted` 后开始监听，将恢复、显示和聚焦窗口的工作
  排入 UI 线程；退出时停止监听并关闭句柄，进程崩溃时由 Windows 释放句柄。
- 保留 Wails `SingleInstance`，以便与尚在运行的旧版 Windows exe 互斥；
  新版进程之间通过入口事件完成拦截和唤醒。macOS 与 Linux 的行为保持不变。

这项保护用于防止后续重复启动创建新托盘图标，不清理历史残留图标，也不替代
对其他崩溃原因的排查。下文为此前实现的复核记录，其中 Windows 仅依赖 Wails
的描述已由本节更新。

验证命令（在 `desktop/src`）：

```powershell
go test ./...
go test -count=10 -run TestWindowsInstance .
go test -tags production ./...
go vet ./...
```

Windows 回归测试覆盖跨进程并发拒绝、启动期间通知保留、就绪后再次唤醒、
正常关闭后重启，以及持锁进程异常退出后的自动释放。托盘外观仍需交互式桌面
验证：连续双击启动后仅一个主实例、一个托盘图标，并能唤起已有窗口。

本次验证：上述 Go 检查通过，生产构建成功。另以系统事件模拟已运行实例，
对实际新 exe 发起 10 次启动，均在 Wails 初始化前以退出码 0 返回，唤醒通知
保留，未创建测试用 `OCTOP_HOME`。这项进程测试不等同于托盘外观实测；当前
桌面控制返回“拒绝访问”，未完成交互式确认。初次 `make all` 因缺少 `make`
未能执行；提交检查已补齐工具并按 `uv.lock` 创建独立 Python 环境。中文 Windows
运行 Python 检查需设置 `PYTHONUTF8=1`，以 UTF-8 读取迁移 SQL 文件。

---

- 复核日期：2026-10-23
- 分支：`feature/local-studio-package`
- 桌面壳技术栈：Wails v3（`github.com/wailsapp/wails/v3 v3.0.0-beta.13`）+ WebView2
- 结论：**代码层面原本没有强制进程互斥（再次启动会拉起第二个进程）。已在 `desktop/src/main.go` 启用 Wails v3 的 `SingleInstance`，从代码层强制单实例。**

---

## 1. 当前进程状态（实测）

在 Windows 上用 PowerShell 复核：

```powershell
Get-Process -Name 'Octop*' | Select-Object Id,Name,StartTime,Path
# 仅 1 个：PID 14240  D:\Octop\desktop\src\bin\Octop.exe  （由 bash 20904 拉起，存活）
```

- `Octop.exe` 实例数：**1**（PID 14240）。
- 该进程**无任何子进程残留**（WebView2 子进程由 WebView2 运行时托管，不挂在其父进程树下显示）。

### 关于机器上那一堆 `msedgewebview2.exe`

复核时发现 12 个 `msedgewebview2.exe`，但父进程是 **`wetype_update.exe`（微信输入法更新进程）**，与 Octop 无关——是输入法在用 WebView2，不是桌面端泄漏。

> 说明：WebView2 每个宿主必然产生多个子进程（browser / renderer / GPU / network / utility 等），这是引擎内部架构，**不属于"多个 Octop 实例"**。判断是否单实例，只看 `Octop.exe` 主进程数量即可。

---

## 2. 代码层面结论：没有进程级互斥

逐一核查 `desktop/src`：

| 检查项 | 结果 |
|---|---|
| 跨进程命名 Mutex / 锁文件 | **无** |
| `application.New(application.Options{...})` 是否设 `SingleInstance` | **未设**（见 `main.go:353`） |
| 便携模式 `findRunningDashboard` / `octopAlreadyRunning`（`process.go`） | 仅做**后端端口级**复用：避免起第二个 octop **服务**，但**允许多个壳进程**；且当 `OCTOP_DESKTOP_URL` 已设（远程后端模式）时，`main.go` 的 `boot()` 走早返回分支（L173-181），**整段被绕过** |
| `sync.Mutex` 用法（`main.go` / `settings.go` / `filedrop.go` 等） | 全部是**进程内 goroutine 锁**，与跨进程互斥无关 |

`desktop_copy.go:42` 的 `"Octop is already running. Opening it…"` 也是便携模式下"复用已有 dashboard"的提示文案，**不是进程互斥**。

### 风险

- **远程后端模式（`OCTOP_DESKTOP_URL` 已设）**：再次双击 `Octop.exe` 会直接拉起**第二个 `Octop.exe`**（各自独立 WebView2、各自托盘图标），都指向同一远程后端 → 两个窗口/两个托盘并存，无互斥。
- **便携模式（未设 `OCTOP_DESKTOP_URL`）**：第二个壳进程会被 `findRunningDashboard` 引导去复用第一个壳起的后端，**不会起第二个后端**，但仍存在两个壳进程。

---

## 3. Wails v3 自带单实例能力（当前未启用）

Wails v3 的 `application.Options` 已内置单实例支持，源码位于
`pkg/application/application.go:207`：

```go
if appOptions.SingleInstance != nil {
    manager, err := newSingleInstanceManager(result, appOptions.SingleInstance)
    ...
    os.Exit(appOptions.SingleInstance.ExitCode) // 第二个实例直接退出
}
```

选项结构体（`pkg/application/single_instance.go:28`）：

```go
type SingleInstanceOptions struct {
    UniqueID           string                    // 应用唯一标识，如 "com.tencent.octop"
    OnSecondInstanceLaunch func(data SecondInstanceData) // 第二实例启动时回调（可聚焦已有窗口）
    AdditionalData     map[string]string
    ExitCode           int                       // 第二实例退出码
    EncryptionKey      [32]byte                  // 实例间通信加密密钥（可选）
}
```

当前 `main.go` 的 `application.New(application.Options{...})` **没有填这个字段**，因此该能力完全未生效。

---

## 4. 修复已实施（按平台分工）

单实例按平台分两套实现，入口统一在 `desktop/src/main.go`：

```go
app := application.New(application.Options{
    Name:        "Octop",
    Description: "Octop desktop",
    Services:    []application.Service{application.NewService(api)},
    // …既有字段…
    SingleInstance: singleInstanceOptions(api),
})
```

`singleInstanceOptions(api)` 定义在平台专用文件里：

| 平台 | 文件 | 机制 | 第二实例行为 |
|---|---|---|---|
| Windows / macOS | `desktop/src/singleinstance_wails.go` | Wails `SingleInstance`（Windows 命名 Mutex + 隐藏消息窗口，macOS 临时目录锁文件 + 分布式通知） | 退出前把启动参数通知首实例，首实例**聚焦已有窗口** |
| Linux | `desktop/src/singleinstance_linux.go`（返回 `nil`）+ `desktop/src/instance_lock_linux.go` | `flock(LOCK_EX\|LOCK_NB)` 锁 `{octopHome}/desktop-instance.lock` | 直接退出，不拉起第二个壳 |

> **为什么 Linux 不用 Wails 的 `SingleInstance`**：Wails v3 的 Linux 实现建立在 **D-Bus session bus** 之上（`single_instance_linux.go` 里 `dbus.ConnectSessionBus()`）。总线不存在时 `acquire` 返回错误，Wails 走 `result.fatal("failed to initialize single instance manager")`——不是降级，而是**整个桌面壳启动即失败**。无头主机、容器、纯 SSH 会话都可能没有 session bus。Linux 因此改用不依赖 D-Bus 的 flock 文件锁。

> **为什么不两套同时用**：文件锁在 `main()` 最前面获取，第二个实例会在那里直接退出，Wails 的 `OnSecondInstanceLaunch` 回调永远不会被触发（聚焦已有窗口的 UX 失效）。所以两者按平台二选一，而不是叠加。

- `UniqueID` 用 `com.octop.desktop`（应用级唯一标识，平台相关锁基于此）。
- Windows/macOS：第二个实例在 `application.go:215` 处 `os.Exit(ExitCode)` 直接退出，**不会**再创建 WebView2 / 托盘；通过 `OnSecondInstanceLaunch` 回调把首实例窗口提到前台——双击图标重开、或命令行再次启动时应聚焦而非多开。
- Linux：文件锁在 `main()` 开头获取，早于窗口构造与 Python 子进程启动，因此第二个实例既不会开窗口也不会起第二个后端。锁随进程退出自动释放（`flock` 随 fd 关闭）。
- 无论便携模式还是远程后端模式（`OCTOP_DESKTOP_URL` 已设），第二次启动都会被拦下。
- 编译已验证：`go build`（Linux）、`GOOS=windows go build` 通过；`go test -race ./...` 通过（Linux 锁测试 `instance_lock_test.go` 仅在 Linux 构建）。

---

## 5. 复核命令（供复验）

```powershell
# 1) Octop 主进程数量（应为 1）
Get-Process -Name 'Octop*' | Measure-Object | Select-Object -ExpandProperty Count

# 2) 区分 WebView2 归属（排除微信输入法等无关进程）
Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
  Select-Object ProcessId, @{N='Parent';E={(Get-CimInstance Win32_Process -Filter "ProcessId=$($_.ParentProcessId)").Name}}

# 3) 确认单实例开关是否启用
Select-String -Path desktop/src/main.go -Pattern 'SingleInstance'
```
