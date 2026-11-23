<#
.SYNOPSIS
    PC 端开发模式（Windows）：外壳直连远程后台，不启动本地 Python 运行时。

.DESCRIPTION
    两种模式，差别只在「界面从哪来」：

      默认（Vite）：界面是本地 dashboard 源码，改一行即热更新；API 走 Vite 代理
                    转发到远程后台。BASE_URL 给出子路径，VITE_API_TARGET 只给出
                    origin（子路径原样透传，远程后台正是挂在 /videogen 上）。
      -Direct     ：界面与 API 都来自远程后台，等价于「拿发行版的壳调试线上后台」。

    两种模式都设置 OCTOP_DESKTOP_DEV=1，桌面壳据此进入开发模式：跳过本地
    portable 运行时、打开开发者工具（Ctrl+Shift+D）、导航日志实时打到控制台。

.PARAMETER Remote
    远程后台地址，默认 https://ocbot.aixifs.com/videogen

.PARAMETER Direct
    前端也来自远程后台（不开本地 Vite dev server）

.EXAMPLE
    powershell -File desktop/package-dev-remote.ps1

.EXAMPLE
    powershell -File desktop/package-dev-remote.ps1 -Remote http://127.0.0.1:8088
#>
param(
    [string]$Remote = $(if ($env:OCTOP_DEV_REMOTE_URL) { $env:OCTOP_DEV_REMOTE_URL } else { "https://ocbot.aixifs.com/videogen" }),
    [int]$VitePort = $(if ($env:OCTOP_DEV_VITE_PORT) { [int]$env:OCTOP_DEV_VITE_PORT } else { 5173 }),
    [switch]$Direct
)

$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    throw "go is not installed (need Go 1.25+)."
}
if (-not (Get-Command wails3 -ErrorAction SilentlyContinue)) {
    throw "wails3 is not installed. go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.13"
}

# 远程地址拆成 origin 与子路径：
#   https://ocbot.aixifs.com/videogen -> origin=https://ocbot.aixifs.com, base=/videogen
#   https://example.com                -> origin=https://example.com,        base=""
$uri = [Uri]$Remote
$origin = $uri.GetLeftPart([UriPartial]::Authority)
$basePath = $uri.AbsolutePath.TrimEnd("/")

$target = $Remote
$vite = $null

if (-not $Direct) {
    $dashboard = Join-Path $Repo "dashboard"
    if (-not (Test-Path (Join-Path $dashboard "node_modules"))) {
        throw "dashboard/node_modules is missing - run 'cd dashboard && npm ci' first."
    }
    Write-Host "starting dashboard dev server (base=$basePath, proxy target=$origin)"
    $env:BASE_URL = $basePath
    $env:VITE_API_TARGET = $origin
    $env:VITE_DEV_PORT = "$VitePort"
    $vite = Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev" -WorkingDirectory $dashboard -PassThru -NoNewWindow

    $health = "http://127.0.0.1:$VitePort$basePath/api/health"
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        try {
            $response = Invoke-WebRequest -Uri $health -TimeoutSec 2 -UseBasicParsing
            if ($response.StatusCode -lt 500) { $ready = $true; break }
        } catch {
            if ($vite.HasExited) {
                throw "dashboard dev server exited before it became ready; see the output above."
            }
        }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) {
        throw "dashboard dev server did not become ready at $health within 30s. Check that the remote backend is reachable: $Remote/api/health"
    }
    # 尾部斜杠是必须的：Vite 的 public base 是 "<子路径>/"，访问 "<子路径>"
    # （无斜杠）会落到 404 —— "did you mean to visit <子路径>/<子路径>?"。
    $target = "http://127.0.0.1:$VitePort" + $(if ($basePath) { "$basePath/" } else { "/" })
}

Write-Host "desktop shell target: $target"
Write-Host "  (developer mode: no local Python runtime, remote backend drives the API)"

$env:OCTOP_DESKTOP_URL = $target
if ($Direct) {
    Remove-Item Env:OCTOP_DESKTOP_AUTH_URL -ErrorAction SilentlyContinue
} else {
    $env:OCTOP_DESKTOP_AUTH_URL = $Remote
}
$env:OCTOP_DESKTOP_DEV = "1"

try {
    Push-Location (Join-Path $Repo "desktop\src")
    & wails3 dev
} finally {
    Pop-Location
    if ($vite -and -not $vite.HasExited) {
        $vite.Kill()
    }
}
