# 轻量客户端与手动制作组件：本轮验收

日期：2026-10-25。验收的是本地 mock API、工作区中的独立 Windows runtime 和隔离用户缓存。未启动桌面 GUI，也未安装主客户端或组件安装包。

## Native 定向测试

在 `desktop/src` 执行：

```powershell
go test -run 'Test(VideoEnvironmentCheckAndVerifyUseTrustedWorker|VideoEnvironmentMissingRuntimeRequestsComponents|VideoStartRequiresVerifiedEnvironment|VideoInstallerURLIsHTTPOnly|VideoBridgeJSParses|VideoPipelineAgainstHTTPAndFakeWorker|VideoPackageRejectsTraversalAndBadHash|SafeVideoNameAndSameFileCopy)' -v .
```

8 个测试函数通过；ZIP traversal 测试含 2 个路径子用例。覆盖认证环境状态、异步 check/verify、Worker 退出成功前不报告 ready、手动安装 URL 白名单、未验证时禁止开始渲染、视频包校验、worker 管线及 MP4 Range 流。opt-in 真实 runtime 渲染另见下节。

Windows amd64 测试编译通过：

```powershell
$env:GOOS='windows'; $env:GOARCH='amd64'
go test -c -o "$env:TEMP\octop-desktop-video-env.test.exe" .
go test -c -tags production,thin -o "$env:TEMP\octop-desktop-video-thin.test.exe" .
```

输出分别为 `octop-desktop-video-env.test.exe` 和 `octop-desktop-video-thin.test.exe`；它们是测试 runner，不是客户安装程序。

## Thin 应用二进制

在 `desktop/src` 按生产 thin 标签构建真实 Windows 应用：

```powershell
go build -tags production,thin -trimpath -ldflags '-w -s -H windowsgui -X main.defaultServerURL=https://ocbot.aixifs.com/videogen' -o bin/Octop.exe .
```

结果：`desktop/src/bin/Octop.exe`，12,765,184 字节。该文件用于 installer 组装；本轮没有执行 installer，也没有打开 GUI。

## Native 环境检查到真实 MP4

使用 `TestVideoRealRuntimeSmoke`；其测试代码为 `OCTOP_HOME` 创建临时隔离目录。PowerShell 环境设置清空浏览器覆盖和系统浏览器发现目录；runtime 通过显式路径指向独立组件 staging：

```powershell
$env:OCTOP_VIDEO_SMOKE_BASE='http://127.0.0.1:18088'
$env:OCTOP_VIDEO_SMOKE_TOKEN='<local mock fixture token>'
$env:OCTOP_VIDEO_SMOKE_PROJECT='V0C4BDB7C'
$env:OCTOP_DESKTOP_VIDEO_RUNTIME=(Resolve-Path '.\video-runtime').Path
$env:REMOTION_BROWSER_EXECUTABLE=''
$emptyLocalAppData=Join-Path $env:TEMP 'octop-empty-browser-localappdata'
New-Item -ItemType Directory -Force $emptyLocalAppData | Out-Null
$env:LOCALAPPDATA=$emptyLocalAppData
$env:ProgramFiles=''; ${env:ProgramFiles(x86)}=''
go test -run '^TestVideoRealRuntimeSmoke$' -count=1 -v .
```

结果：36.31 秒通过。状态顺序为 `checking` → `needs_setup` → `verifying`（components、browser、render_test）→ `ready`；随后通过认证读取已确认分镜 ZIP、调用可信本地 worker、完成渲染并访问 loopback MP4。Range 返回 206，响应头为 MP4 `ftyp`，本轮产物为 36,744 字节。Bundled Headless Shell 路径存在且 `detectBrowser()` 优先选择它；`REMOTION_BROWSER_EXECUTABLE` 为空，LocalAppData 是新建空目录，Program Files 浏览器路径不可见，因此没有依赖宿主 Chrome/Edge。

本轮独立组件 staging 包含 Node 24.14.0、锁定的 Remotion 4.0.537 和 Windows x64 Headless Shell 157。此 smoke 使用工作区 staging，不代表用户安装体验；组件包仅编译和核对了文件本身，没有执行安装器。

## 本地验证安装器与 worker 证据

本地 NSIS 编译器生成了两个未签名验证包；检查过文件大小及 SHA-256，但没有运行安装器：

| 包 | 文件大小 | SHA-256 |
| --- | ---: | --- |
| `Octop-desktop-windows-amd64-0.9.31.exe` | 6,239,543 字节 | `3A0DE97E5412482982680A8A18389D75AFB1DE5FA94DF8D874885695212085E9` |
| `Octop-video-components-windows-x64-0.9.31.exe` | 153,255,764 字节 | `1D46EF4085E9E3ED7F388C0911490D5F99007B15A1207756C30DEAA36DBF0A7C` |

Worker 独立 smoke 的源 worker 输出 24,566 字节 MP4；独立组件 runtime 在空 PATH、无宿主浏览器的 staging 条件下输出 24,357 字节 MP4。上节 native HTTP→ZIP→MP4 smoke 则输出 36,744 字节；三次产物分别标注，不作为字节一致性测试。主 thin 客户端为 6,239,543 字节，组件包为 153,255,764 字节；两者均是未签名本地验证文件，未正式发布。

## 尚未验证

- 未启动桌面 GUI；Wails 对话框、窗口导航和页面视觉未在本轮验收。
- 新环境卡的浏览器截图因当前 Windows 浏览器 URL 策略限制而受阻；IAB 浏览器列表为空，自动化停止。详见 [环境卡视觉验收状态](environment-design-qa.md)。前端测试和构建通过不替代截图审查。
- 未安装组件 NSIS 安装包，未在干净 Windows 主机上验证安装/卸载/升级。
- 未配置正式组件下载 URL；UI 应提示联系管理员获取安装包。
- 未运行 Go 模块或仓库全量测试，也未运行全平台打包矩阵。
