#requires -Version 5.1
<#
Octop 引导器 (Windows) —— 极轻量下载引导器

本体只有本文件 + bootstrap.conf（几十 KB），不携带 Python 运行时和应用包。
双击 Octop-Bootstrap.cmd 打开图形界面，按 5 个步骤把环境与应用分步下载到本地：

  1. 基础工具     下载 uv（已存在则复用）
  2. Python 环境  uv venv → 拉取 CPython
  3. Octop 主程序 本地 wheel（payload/ 或 ../dist/）优先，否则从 PyPI 下载
  4. 可选组件     Playwright Chromium（勾选才下载）
  5. 启动         后台拉起 octop run，就绪后自动打开浏览器

用法：
  .\Octop-Bootstrap.ps1                  # 图形界面（默认）
  .\Octop-Bootstrap.ps1 -NoGui           # 服务器 / 无窗口场景
  .\Octop-Bootstrap.ps1 -Mirror          # 使用国内镜像加速
  .\Octop-Bootstrap.ps1 -WithBrowser     # 同时下载浏览器组件
  .\Octop-Bootstrap.ps1 -InstallDir D:\octop
  .\Octop-Bootstrap.ps1 -Version 1.1.0
  .\Octop-Bootstrap.ps1 -Plan            # 只打印将要执行的计划

环境：OCTOP_HOME 覆盖默认安装目录（%USERPROFILE%\.octop）
#>
[CmdletBinding()]
param(
    [string]$InstallDir = "",
    [string]$Version = "",
    [switch]$Mirror,
    [switch]$WithBrowser,
    [switch]$NoLaunch,
    [switch]$NoGui,
    [switch]$Plan
)

$ErrorActionPreference = 'Stop'
# 脚本以 UTF-8 (BOM) 保存；控制台默认代码页会是 GBK，这里统一成 UTF-8 以免乱码。
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# ── 图形界面需要 STA；非 STA 时自举重启 ──────────────────────────────────────
if (-not $NoGui -and ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA')) {
    $psExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (-not (Test-Path $psExe)) { $psExe = 'powershell.exe' }
    $again = @('-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath)
    foreach ($entry in $PSBoundParameters.GetEnumerator()) {
        if ($entry.Value -is [System.Management.Automation.SwitchParameter]) {
            $again += "-$($entry.Key)"
        } else {
            $again += @("-$($entry.Key)", [string]$entry.Value)
        }
    }
    & $psExe @again
    exit $LASTEXITCODE
}

# ── 配置 ────────────────────────────────────────────────────────────────────
$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }

function Read-Conf {
    param([string]$Path)
    $conf = @{}
    if (Test-Path -LiteralPath $Path) {
        foreach ($line in Get-Content -LiteralPath $Path) {
            $t = $line.Trim()
            if (-not $t -or $t.StartsWith('#')) { continue }
            $i = $t.IndexOf('=')
            if ($i -lt 1) { continue }
            $conf[$t.Substring(0, $i).Trim()] = $t.Substring($i + 1).Trim()
        }
    }
    return $conf
}

$Conf = Read-Conf -Path (Join-Path $ScriptDir 'bootstrap.conf')

$UvVersion = if ($Conf['UV_VERSION']) { $Conf['UV_VERSION'] } else { '0.12.22' }
$PyVersion = if ($Conf['PYTHON_VERSION']) { $Conf['PYTHON_VERSION'] } else { '3.12' }
$Package = if ($Conf['PYPI_PACKAGE']) { $Conf['PYPI_PACKAGE'] } else { 'octop' }
$Port = if ($Conf['LAUNCH_PORT']) { [int]$Conf['LAUNCH_PORT'] } else { 8088 }
$UvMirrorBase = if ($Conf['UV_MIRROR_BASE']) { $Conf['UV_MIRROR_BASE'] } else { 'https://registry.npmmirror.com/-/binary/uv' }
$PipIndexUrl = if ($Conf['PIP_INDEX_URL']) { $Conf['PIP_INDEX_URL'] } else { '' }
$AppVersion = if ($Version) { $Version } elseif ($Conf['OCTOP_VERSION']) { $Conf['OCTOP_VERSION'] } else { '' }

$HomeDir = if ($InstallDir) { $InstallDir } elseif ($env:OCTOP_HOME) { $env:OCTOP_HOME } else { Join-Path $HOME '.octop' }
$VenvDir = Join-Path $HomeDir 'venv'
$VenvPython = Join-Path $VenvDir 'Scripts\python.exe'
$VenvOctop = Join-Path $VenvDir 'Scripts\octop.exe'
$ToolDir = Join-Path $env:LOCALAPPDATA 'octop\bootstrap\uv'
$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'aarch64' } else { 'x86_64' }

# ── 步骤清单（图形界面与 -NoGui 共用） ───────────────────────────────────────
$script:Steps = @(
    '基础工具 (uv)',
    "Python $PyVersion 运行环境",
    'Octop 主程序',
    '可选组件',
    '启动 Octop'
)
$script:StepNotes = @('', '', '', '', '')

# ── UI 句柄（无界面模式下保持 $null） ────────────────────────────────────────
$script:Form = $null
$script:LvSteps = $null
$script:ProgressBar = $null
$script:StatusLabel = $null
$script:LogBox = $null

function Write-Log {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date).ToString('HH:mm:ss'), $Message
    if ($script:LogBox) {
        $script:LogBox.AppendText($line + [Environment]::NewLine)
        [System.Windows.Forms.Application]::DoEvents()
    } else {
        Write-Host $line
    }
}

function Set-Progress {
    param([int]$Percent, [string]$Label = '')
    if ($Percent -lt 0) { $Percent = 0 }
    if ($Percent -gt 100) { $Percent = 100 }
    if ($script:ProgressBar) { $script:ProgressBar.Value = $Percent }
    if ($Label -and $script:StatusLabel) { $script:StatusLabel.Text = $Label }
    if ($script:Form) { [System.Windows.Forms.Application]::DoEvents() }
}

function Set-Step {
    param([int]$Index, [string]$State, [string]$Note = '')
    if ($Note) { $script:StepNotes[$Index] = $Note }
    $text = @{ 'pending' = '等待中'; 'running' = '进行中'; 'done' = '已完成'; 'failed' = '失败'; 'skipped' = '已跳过' }
    if ($script:LvSteps -and $script:LvSteps.Items.Count -gt $Index) {
        $item = $script:LvSteps.Items[$Index]
        $item.SubItems[1].Text = $text[$State]
        $item.SubItems[2].Text = $script:StepNotes[$Index]
        [System.Windows.Forms.Application]::DoEvents()
    } else {
        Write-Log ('  [{0}] {1}' -f $text[$State], $script:Steps[$Index])
    }
}

# ── 下载：分块读取，实时回报进度 ─────────────────────────────────────────────
function Copy-Url {
    param(
        [string]$Url,
        [string]$Dest,
        [string]$Label = '',
        [int]$ProgressBase = 0,
        [int]$ProgressSpan = 100
    )
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Write-Log "下载 $Url"
    $req = [System.Net.HttpWebRequest]::Create($Url)
    $req.Method = 'GET'
    $req.AllowAutoRedirect = $true
    $req.Timeout = 60000
    $req.ReadWriteTimeout = 60000
    $resp = $req.GetResponse()
    try {
        $total = [double]$resp.ContentLength
        $in = $resp.GetResponseStream()
        $out = [System.IO.File]::Create($Dest)
        try {
            $buf = New-Object byte[] 1048576
            $done = [double]0
            while (($n = $in.Read($buf, 0, $buf.Length)) -gt 0) {
                $out.Write($buf, 0, $n)
                $done += $n
                if ($total -gt 0) {
                    $pct = $ProgressBase + [int](($done / $total) * $ProgressSpan)
                    Set-Progress -Percent $pct -Label ("{0}  {1:N1} / {2:N1} MB" -f $Label, ($done / 1MB), ($total / 1MB))
                }
            }
        } finally { $out.Dispose() }
    } finally { $resp.Dispose() }
}

# ── 外部进程：uv 等，输出实时进日志，返回退出码 ──────────────────────────────
function Invoke-Tool {
    param([string]$Exe, [string[]]$Arguments)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Exe
    $psi.Arguments = (($Arguments | ForEach-Object { '"' + ($_ -replace '"', '\"') + '"' }) -join ' ')
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $p = New-Object System.Diagnostics.Process
    $p.StartInfo = $psi
    [void]$p.Start()
    $outTask = $p.StandardOutput.ReadToEndAsync()
    $errTask = $p.StandardError.ReadToEndAsync()
    $p.WaitForExit()
    $out = $outTask.Result
    $err = $errTask.Result
    foreach ($l in ($out -split "`r?`n")) { if ($l.Trim()) { Write-Log ('  | ' + $l.Trim()) } }
    foreach ($l in ($err -split "`r?`n")) { if ($l.Trim()) { Write-Log ('  ! ' + $l.Trim()) } }
    return $p.ExitCode
}

# ── 步骤 1：基础工具 uv ─────────────────────────────────────────────────────
function Resolve-Uv {
    $cmd = Get-Command uv -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($c in @(
        (Join-Path $HOME '.local\bin\uv.exe'),
        (Join-Path $HOME '.cargo\bin\uv.exe'),
        (Join-Path $env:LOCALAPPDATA 'uv\uv.exe'),
        (Join-Path $ToolDir 'uv.exe')
    )) {
        if (Test-Path -LiteralPath $c) { return $c }
    }
    return $null
}

function Get-Uv {
    $existing = Resolve-Uv
    if ($existing) {
        Write-Log "复用已安装的 uv：$existing"
        $env:PATH = "$(Split-Path $existing -Parent);$env:PATH"
        return $existing
    }
    $file = "uv-$Arch-pc-windows-msvc.zip"
    $primary = "https://github.com/astral-sh/uv/releases/download/$UvVersion/$file"
    $fallback = "$UvMirrorBase/$UvVersion/$file"
    $urls = if ($Mirror) { @($fallback, $primary) } else { @($primary, $fallback) }

    New-Item -ItemType Directory -Path $ToolDir -Force | Out-Null
    $zip = Join-Path $env:TEMP $file
    $ok = $false
    foreach ($u in $urls) {
        try {
            Copy-Url -Url $u -Dest $zip -Label 'uv' -ProgressBase 0 -ProgressSpan 20
            $ok = $true
            break
        } catch {
            Write-Log "  下载失败：$u —— $($_.Exception.Message)"
        }
    }
    if (-not $ok) { throw '无法下载 uv，请检查网络后重试。' }
    Expand-Archive -LiteralPath $zip -DestinationPath $ToolDir -Force
    Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
    $exe = Join-Path $ToolDir 'uv.exe'
    if (-not (Test-Path -LiteralPath $exe)) { throw 'uv 解压失败。' }
    $env:PATH = "$ToolDir;$env:PATH"
    Write-Log "uv 就绪：$exe"
    return $exe
}

# ── 步骤 3：定位本地 wheel（构建产物优先，其次 PyPI） ────────────────────────
function Resolve-Wheel {
    foreach ($dir in @((Join-Path $ScriptDir 'payload'), $ScriptDir, (Join-Path (Split-Path $ScriptDir -Parent) 'dist'))) {
        if (-not (Test-Path -LiteralPath $dir)) { continue }
        $hit = Get-ChildItem -LiteralPath $dir -Filter "$Package-*.whl" -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    return $null
}

# ── 主流程 ──────────────────────────────────────────────────────────────────
function Invoke-Bootstrap {
    param([switch]$UseMirror, [switch]$Browser, [switch]$SkipLaunch)

    New-Item -ItemType Directory -Path $HomeDir -Force | Out-Null

    # 1 ── uv
    Set-Step -Index 0 -State 'running' -Note '检查 / 下载 uv'
    Set-Progress -Percent 0 -Label '准备基础工具…'
    $uv = Get-Uv
    Set-Step -Index 0 -State 'done' -Note (Split-Path $uv -Leaf)

    # 2 ── Python 运行环境
    Set-Step -Index 1 -State 'running' -Note "创建 $VenvDir"
    Set-Progress -Percent 20 -Label "准备 Python $PyVersion 运行环境…"
    $code = Invoke-Tool -Exe $uv -Arguments @('venv', $VenvDir, '--python', $PyVersion, '--quiet')
    if ($code -ne 0) { Set-Step -Index 1 -State 'failed'; throw 'Python 运行环境创建失败。' }
    if (-not (Test-Path -LiteralPath $VenvPython)) { Set-Step -Index 1 -State 'failed'; throw '未找到 venv 中的 python.exe。' }
    Set-Step -Index 1 -State 'done' -Note "Python $PyVersion"
    Set-Progress -Percent 40 -Label '运行环境就绪'

    # 3 ── Octop 主程序
    Set-Step -Index 2 -State 'running'
    Set-Progress -Percent 40 -Label '下载 Octop 主程序与依赖…'
    $wheel = Resolve-Wheel
    $args = @('pip', 'install', '--python', $VenvPython)
    if ($UseMirror -and $PipIndexUrl) { $args += @('--index-url', $PipIndexUrl) }
    if ($wheel) {
        Write-Log "使用本地构建产物：$wheel"
        $args += $wheel
        Set-Step -Index 2 -State 'running' -Note (Split-Path $wheel -Leaf)
    } else {
        $spec = if ($AppVersion) { "$Package==$AppVersion" } else { $Package }
        Write-Log "从 PyPI 下载：$spec"
        $args += $spec
        Set-Step -Index 2 -State 'running' -Note $spec
    }
    $code = Invoke-Tool -Exe $uv -Arguments $args
    if ($code -ne 0) { Set-Step -Index 2 -State 'failed'; throw 'Octop 安装失败。' }
    if (-not (Test-Path -LiteralPath $VenvOctop)) { Set-Step -Index 2 -State 'failed'; throw '安装完成但未找到 octop 可执行文件。' }
    Set-Step -Index 2 -State 'done'
    Set-Progress -Percent 70 -Label '主程序安装完成'

    # 4 ── 可选组件
    if ($Browser) {
        Set-Step -Index 3 -State 'running' -Note 'Playwright Chromium'
        Set-Progress -Percent 70 -Label '下载浏览器组件（约 150 MB）…'
        $code = Invoke-Tool -Exe $VenvPython -Arguments @('-m', 'playwright', 'install', 'chromium')
        if ($code -ne 0) { Set-Step -Index 3 -State 'failed'; Write-Log '浏览器组件下载失败，可稍后在控制台重试。' }
        else { Set-Step -Index 3 -State 'done' -Note 'Chromium' }
    } else {
        Set-Step -Index 3 -State 'skipped' -Note '稍后可在控制台按需安装'
    }
    Set-Progress -Percent 85 -Label '可选组件完成'

    # 5 ── 启动
    if ($SkipLaunch) {
        Set-Step -Index 4 -State 'skipped' -Note '已跳过启动'
    } else {
        Set-Step -Index 4 -State 'running' -Note "http://127.0.0.1:$Port"
        Start-Octop
        Set-Step -Index 4 -State 'done' -Note "http://127.0.0.1:$Port"
    }
    Set-Progress -Percent 100 -Label '全部完成'
    return $true
}

function Start-Octop {
    if (-not (Test-Path -LiteralPath $VenvOctop)) { throw 'Octop 尚未安装，无法启动。' }
    Set-Progress -Percent 90 -Label '启动 Octop 服务…'
    New-Item -ItemType Directory -Path $HomeDir -Force | Out-Null
    Start-Process -FilePath $VenvOctop -ArgumentList 'run' -WorkingDirectory $HomeDir -WindowStyle Minimized
    Write-Log "已启动 octop run，等待 $Port 端口就绪…"
    $ready = $false
    for ($i = 0; $i -lt 90; $i++) {
        Start-Sleep -Seconds 1
        if ($script:Form) { [System.Windows.Forms.Application]::DoEvents() }
        $tcp = New-Object System.Net.Sockets.TcpClient
        try {
            $task = $tcp.ConnectAsync('127.0.0.1', $Port)
            if ($task.Wait(800)) { $ready = $true }
        } catch { $ready = $false }
        $tcp.Dispose()
        if ($ready) { break }
        Set-Progress -Percent 90 -Label "等待服务就绪… ($i s)"
    }
    if (-not $ready) {
        Write-Log "服务在 90 秒内未就绪，请稍后手动打开 http://127.0.0.1:$Port"
        return
    }
    Write-Log '服务就绪，打开浏览器。'
    Start-Process "http://127.0.0.1:$Port"
}

# ── 图形界面 ────────────────────────────────────────────────────────────────
function Show-BootstrapForm {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    $font = New-Object System.Drawing.Font('Segoe UI', 9)
    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'Octop · 安装引导器'
    $form.Size = New-Object System.Drawing.Size(680, 560)
    $form.MinimumSize = $form.Size
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.BackColor = [System.Drawing.Color]::White
    $form.Font = $font
    $script:Form = $form

    $title = New-Object System.Windows.Forms.Label
    $title.Location = New-Object System.Drawing.Point(20, 16)
    $title.Size = New-Object System.Drawing.Size(420, 30)
    $title.Font = New-Object System.Drawing.Font('Segoe UI', 15, [System.Drawing.FontStyle]::Bold)
    $title.Text = 'Octop 安装引导器'
    $form.Controls.Add($title)

    $sub = New-Object System.Windows.Forms.Label
    $sub.Location = New-Object System.Drawing.Point(22, 50)
    $sub.Size = New-Object System.Drawing.Size(620, 20)
    $sub.ForeColor = [System.Drawing.Color]::DimGray
    $sub.Text = if ($AppVersion) { "版本 $AppVersion · 分步下载基础环境与应用" } else { '最新版本 · 分步下载基础环境与应用' }
    $form.Controls.Add($sub)

    $lv = New-Object System.Windows.Forms.ListView
    $lv.Location = New-Object System.Drawing.Point(20, 78)
    $lv.Size = New-Object System.Drawing.Size(624, 150)
    $lv.View = 'Details'
    $lv.FullRowSelect = $true
    $lv.GridLines = $true
    $lv.MultiSelect = $false
    $lv.HeaderStyle = 'Nonclickable'
    [void]$lv.Columns.Add('步骤', 330)
    [void]$lv.Columns.Add('状态', 90)
    [void]$lv.Columns.Add('说明', 180)
    for ($i = 0; $i -lt $script:Steps.Count; $i++) {
        $item = New-Object System.Windows.Forms.ListViewItem($script:Steps[$i])
        [void]$item.SubItems.Add('等待中')
        [void]$item.SubItems.Add('')
        [void]$lv.Items.Add($item)
    }
    $form.Controls.Add($lv)
    $script:LvSteps = $lv

    $bar = New-Object System.Windows.Forms.ProgressBar
    $bar.Location = New-Object System.Drawing.Point(20, 240)
    $bar.Size = New-Object System.Drawing.Size(624, 22)
    $bar.Style = 'Blocks'
    $form.Controls.Add($bar)
    $script:ProgressBar = $bar

    $status = New-Object System.Windows.Forms.Label
    $status.Location = New-Object System.Drawing.Point(20, 268)
    $status.Size = New-Object System.Drawing.Size(624, 20)
    $status.Text = '准备就绪，点击「开始安装」。'
    $form.Controls.Add($status)
    $script:StatusLabel = $status

    $chkMirror = New-Object System.Windows.Forms.CheckBox
    $chkMirror.Location = New-Object System.Drawing.Point(20, 296)
    $chkMirror.Size = New-Object System.Drawing.Size(220, 22)
    $chkMirror.Text = '使用国内镜像加速'
    $chkMirror.Checked = [bool]$Mirror
    $form.Controls.Add($chkMirror)

    $chkBrowser = New-Object System.Windows.Forms.CheckBox
    $chkBrowser.Location = New-Object System.Drawing.Point(250, 296)
    $chkBrowser.Size = New-Object System.Drawing.Size(300, 22)
    $chkBrowser.Text = '同时下载浏览器组件 (Chromium)'
    $chkBrowser.Checked = [bool]$WithBrowser
    $form.Controls.Add($chkBrowser)

    $lblDir = New-Object System.Windows.Forms.Label
    $lblDir.Location = New-Object System.Drawing.Point(20, 328)
    $lblDir.Size = New-Object System.Drawing.Size(70, 22)
    $lblDir.Text = '安装目录'
    $form.Controls.Add($lblDir)

    $txtDir = New-Object System.Windows.Forms.TextBox
    $txtDir.Location = New-Object System.Drawing.Point(92, 325)
    $txtDir.Size = New-Object System.Drawing.Size(440, 22)
    $txtDir.Text = $HomeDir
    $form.Controls.Add($txtDir)

    $btnDir = New-Object System.Windows.Forms.Button
    $btnDir.Location = New-Object System.Drawing.Point(542, 323)
    $btnDir.Size = New-Object System.Drawing.Size(100, 26)
    $btnDir.Text = '浏览…'
    $btnDir.Add_Click({
        $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
        $dlg.SelectedPath = $txtDir.Text
        if ($dlg.ShowDialog() -eq 'OK') { $txtDir.Text = $dlg.SelectedPath }
    })
    $form.Controls.Add($btnDir)

    $log = New-Object System.Windows.Forms.TextBox
    $log.Location = New-Object System.Drawing.Point(20, 356)
    $log.Size = New-Object System.Drawing.Size(624, 108)
    $log.Multiline = $true
    $log.ReadOnly = $true
    $log.ScrollBars = 'Vertical'
    $log.WordWrap = $false
    $log.Font = New-Object System.Drawing.Font('Consolas', 9)
    $form.Controls.Add($log)
    $script:LogBox = $log

    $btnStart = New-Object System.Windows.Forms.Button
    $btnStart.Location = New-Object System.Drawing.Point(340, 476)
    $btnStart.Size = New-Object System.Drawing.Size(110, 32)
    $btnStart.Text = '开始安装'
    $form.Controls.Add($btnStart)

    $btnLaunch = New-Object System.Windows.Forms.Button
    $btnLaunch.Location = New-Object System.Drawing.Point(460, 476)
    $btnLaunch.Size = New-Object System.Drawing.Size(100, 32)
    $btnLaunch.Text = '启动 Octop'
    $btnLaunch.Enabled = $false
    $form.Controls.Add($btnLaunch)

    $btnExit = New-Object System.Windows.Forms.Button
    $btnExit.Location = New-Object System.Drawing.Point(570, 476)
    $btnExit.Size = New-Object System.Drawing.Size(74, 32)
    $btnExit.Text = '退出'
    $form.Controls.Add($btnExit)

    $btnStart.Add_Click({
        $HomeDir2 = $txtDir.Text.Trim()
        if (-not $HomeDir2) {
            [System.Windows.Forms.MessageBox]::Show($form, '请填写安装目录。', 'Octop', 'OK', 'Warning')
            return
        }
        $script:HomeDir = $HomeDir2
        $script:VenvDir = Join-Path $HomeDir2 'venv'
        $script:VenvPython = Join-Path $script:VenvDir 'Scripts\python.exe'
        $script:VenvOctop = Join-Path $script:VenvDir 'Scripts\octop.exe'

        $btnStart.Enabled = $false
        $chkMirror.Enabled = $false
        $chkBrowser.Enabled = $false
        $txtDir.Enabled = $false
        $btnDir.Enabled = $false
        try {
            Invoke-Bootstrap -UseMirror:$chkMirror.Checked -Browser:$chkBrowser.Checked -SkipLaunch:$NoLaunch
            $btnLaunch.Enabled = $true
            $status.Text = '安装完成。'
        } catch {
            $status.Text = '安装失败，请查看日志。'
            Write-Log "错误：$($_.Exception.Message)"
            [System.Windows.Forms.MessageBox]::Show($form, $_.Exception.Message, '安装失败', 'OK', 'Error')
        }
    })

    $btnLaunch.Add_Click({
        try { Start-Octop } catch {
            Write-Log "启动失败：$($_.Exception.Message)"
            [System.Windows.Forms.MessageBox]::Show($form, $_.Exception.Message, '启动失败', 'OK', 'Error')
        }
    })

    $btnExit.Add_Click({ $form.Close() })

    [void]$form.ShowDialog()
}

# ── 入口 ────────────────────────────────────────────────────────────────────
if ($Plan) {
    $wheel = Resolve-Wheel
    Write-Host 'Octop 引导器 · 执行计划'
    Write-Host "  安装目录     $HomeDir"
    Write-Host "  应用版本     $(if ($AppVersion) { $AppVersion } else { '最新稳定版' })"
    Write-Host "  基础工具     uv $UvVersion ($Arch)"
    Write-Host "  Python       $PyVersion"
    Write-Host "  应用来源     $(if ($wheel) { "本地构建产物 $wheel" } else { "PyPI $Package" })"
    Write-Host "  镜像加速     $(if ($Mirror) { $PipIndexUrl } else { '关闭' })"
    Write-Host "  浏览器组件   $(if ($WithBrowser) { '下载' } else { '跳过' })"
    Write-Host "  启动端口     $Port"
    exit 0
}

if ($NoGui) {
    try {
        [void](Invoke-Bootstrap -UseMirror:$Mirror -Browser:$WithBrowser -SkipLaunch:$NoLaunch)
        exit 0
    } catch {
        Write-Log "错误：$($_.Exception.Message)"
        exit 1
    }
}

Show-BootstrapForm
