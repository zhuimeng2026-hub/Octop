# Octop 客户端下载

Octop 是一个开源自托管的 AI 助手平台：多用户、多智能体，单进程部署，不需要额外的
队列或中间件。本仓库用于分发 **Octop 桌面客户端** 的发行产物。

> 源码不在本仓库。源码见 [GitHub](https://github.com/TencentCloud/Octop) /
> [CNB](https://cnb.cool/mengxa.com/Octop)，本仓库只放下载页与 Release 产物。

## 我该装哪个

| 你的情况 | 装这个 |
|---|---|
| 使用我们已部署的 Octop 服务 | **远程版**（推荐，装完即用） |
| 要自己跑一套、要离线可用 | slim 本地版 |
| 要做产品视频 | 装完客户端后，**再装「视频制作组件」** |

## 桌面客户端

全部发行版本见 [Releases](https://gitee.com/webheat/octop_client/releases)。

| 客户端 | 体积 | 说明 |
|---|---|---|
| **远程版（Windows x64）** | ~6 MB | 连接已部署好的 Octop 服务，本机不装 Python 运行时，装完即用 |
| **远程版（Windows ARM64）** | ~5.5 MB | 同上，用于骁龙 X 等 ARM 设备 |
| **slim 本地版（Windows x64）** | ~6 MB | 在本机跑完整运行时。**首次启动**会下载约 213 MB 的运行时并解包到本地，之后离线可用 |

远程版打开后直连 <https://ocbot.aixifs.com/videogen>；登录、产品库、AI 分镜都在服务器，
客户端只负责界面和本机渲染。

**本轮只提供 Windows 版**。macOS 与 Linux 版本暂未发布；ARM64 只有远程版
（部分 Python 依赖尚未提供 win_arm64 轮子，slim 无法组装）。

## 视频制作组件（另需安装）

桌面客户端**不自带**视频渲染环境（Node + Remotion + 浏览器，解包后约 500 MB），
需要单独装一次。不装不影响登录、产品库和方案编辑，只是无法在本机出片。

| 组件 | 体积 | 下载 |
|---|---|---|
| **视频制作组件（Windows x64）** | ~72 MB | [下载](https://gitee.com/webheat/octop_client/releases/download/v1.4.0-gitee.1/Octop-video-components-windows-x64-1.4.0.exe) ｜ [GitHub 备用](https://github.com/zhuimeng2026-hub/Octop/releases/download/v1.4.0-gitee.1/Octop-video-components-windows-x64-1.4.0.exe) |

安装步骤：

1. 运行上面的组件安装包，全部用默认选项（装到 `%LOCALAPPDATA%\Octop\video-runtime`，
   不写系统 PATH、不需要管理员权限）。
2. 回到客户端「制作产品视频」页面，点 **重新检测**。
3. 客户端会跑一段几秒的本机测试视频，显示「本机制作已就绪」即可正式出片。

客户端里也有同样的下载按钮，地址取不到时才提示联系管理员。

## 其它产物

- `octop-*.whl` / `octop-*.tar.gz`：Python 包，服务端用 `pip install octop` 安装
- `Octop-fnos-docker-*.fpk`：fnOS（飞牛）NAS 的 Docker 版安装包

## 为什么这么分

完整的桌面安装包要把整套 Python 运行时嵌进去，体积 213 MB 起，Gitee 单个附件上限
100 MB 放不下，所以拆成两个更小的形态：

- **远程版**面向"已经有 Octop 服务"的用户，本机什么都不用装；
- **slim 本地版**面向"要自己跑一套"的用户，把运行时下载推迟到首次启动。

运行时本体（213 MB）和完整离线安装包超过 Gitee 附件上限，只在
[GitHub Release](https://github.com/zhuimeng2026-hub/Octop/releases) 上提供，
本页给出链接。视频组件压到 72 MB 后可以放进 Gitee，所以首选 Gitee 直连下载。

## 文档

- 使用文档与部署指南：<https://github.com/TencentCloud/Octop/tree/main/docs>
- API 参考：<https://github.com/TencentCloud/Octop/blob/main/docs/api.md>

## 许可

MIT，见源码仓库。
