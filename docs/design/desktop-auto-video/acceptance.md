# 自动制作视频 MVP 验收记录

日期：2026-10-25。低成本模型实现主要代码，主线程负责审查、集成修正和验收。已合入远端 `216742ad` 登录子路径修复及 `d7a2916a` 桌面导航日志，没有覆盖已有提交。

## 已通过

| 检查 | 结果 |
| --- | --- |
| 前端定向测试 | `brief.test.ts` 3 项、`index.test.tsx` 4 项、`DesktopVideoJobsContext.test.tsx` 2 项通过。覆盖确认启动、历史不自动启动、原生控制及账号切换。 |
| 生产构建 | `cd dashboard && npm run build` 通过，含 `tsc -b`；最终 Vite 构建 1m36s。现有 chunk/import 提示非致命。 |
| 原生定向测试 | `go test -run '^Test(VideoPipelineAgainstHTTPAndFakeWorker\|VideoPackageRejectsTraversalAndBadHash\|VideoBridgeJSParses\|SafeVideoNameAndSameFileCopy)$' -count=1 -v .`，4 个函数和 2 个路径子用例通过。 |
| Worker 基础测试 | `cd remotion && node --test test/desktop-worker.test.mjs`，2 项通过。 |
| Worker 真实渲染 | `node remotion/test/desktop-worker-smoke.mjs` 通过，24,566 字节 MP4；保持 stdin 打开仍正常退出，未执行项目内恶意源码。 |
| 原生完整链路 | 隔离 `OCTOP_HOME` 和 `OCTOP_VIDEO_SMOKE_*` 后，`go test -run '^TestVideoRealRuntimeSmoke$' -count=1 -v .`，92.93s 通过。模拟 HTTP 提供有效 ZIP，真实运行时生成 36,441 字节、3 秒、15fps、360×640 MP4；Range 请求 206。 |
| Windows 编译 | `go build -buildvcs=false -ldflags '-H windowsgui' -o bin/OctopVideoMVP.exe .` 通过；不含 production tag 的远程模式验证二进制。 |
| 运行时准备 | Windows x64 Node 24.14.0、锁定依赖、固定模板和 worker 已准备，并用于原生链路；Node ZIP SHA-256 校验通过。Windows 打包已接入运行时准备及 NSIS 复制。 |
| 页面 | 1487×1058 和 900×800：取消/重试、后台状态、完成提醒、实际视频播放通过。页面与桥接为测试夹具，非线上业务验收。 |

未运行 `make all`、Python 全量测试或全平台矩阵。子代理额外执行过桌面 Go 模块 `go test ./...` 并通过，随后只复跑本功能定向用例；未运行仓库全量测试。

## 入口和部署

- `/product-library/video-wizard`，历史项目加 `?project=<ID>`；产品库有“制作产品视频”和“继续制作”。
- 新客户端使用原生自动制作能力，普通浏览器保留制作包下载。
- 根目录运行时准备：`node remotion/build-desktop-runtime.mjs --target win-x64 --output desktop/src/video-runtime`。Windows `package` 任务会准备运行时并加入安装目录，仍需先准备原流程的 portable 包。
- 单独部署 Dashboard 不会升级旧客户端；正式分发需要包含同版本 `video-runtime` 的新桌面安装包。
- MVP 同时一个制作任务，没有并发队列或自动缓存清理界面。

## 未完成的验证

1. 自动审批拒绝启动新编译的 Windows GUI，未给出具体原因；未实测系统另存为对话框及托盘/退出交互。桥接和复制通过代码测试。
2. `-tags production` 编译缺少 `bundled/portable.zip`，本机没有 NSIS；没有生成或安装正式安装包，不能声称安装版已交付。
3. 未做线上 LLM、微信登录、真实服务端权限隔离及 HTTPS 远程 WebView 到本机视频流的联合验收。
4. macOS、Windows ARM64、大体积长视频未实测，当前优先 Windows x64 MVP。

独立 `C:\Octop` 的 `feat/m1-desktop-beta-readiness` 未改动。界面规范及截图在本目录，视觉报告见仓库根目录 `design-qa.md`。
