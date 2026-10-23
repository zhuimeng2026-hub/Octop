# 桌面端进程互斥（单实例）复核

- 复核日期：2026-10-23
- 分支：`feature/local-studio-package`
- 桌面壳技术栈：Wails v3（`github.com/wailsapp/wails/v3 v3.0.0-beta.13`）+ WebView2
- 结论：**当前恰好只有一个 `Octop.exe` 主进程，但代码层面并没有强制进程互斥；不做保护时再次启动会拉起第二个进程。**

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

## 4. 修复建议（待实施）

在 `desktop/src/main.go` 的 `application.New(...)` 中启用单实例，第二实例直接退出（或聚焦已有窗口）：

```go
app := application.New(application.Options{
    Name:        "Octop",
    Description: "Octop desktop",
    Services:    []application.Service{application.NewService(api)},
    // …既有字段…
    SingleInstance: &application.SingleInstanceOptions{
        UniqueID: "com.tencent.octop",
        OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
            api.showWindow() // 第二实例启动时，聚焦已存在的窗口
        },
        ExitCode: 0,
    },
})
```

这样无论便携模式还是远程后端模式，第二次启动都会立即退出并聚焦首个实例，满足"进程互斥、只有一个进程存在"。

> 注：本文仅记录复核结论与建议，未改动代码。如需实施，请另开修复提交。

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
