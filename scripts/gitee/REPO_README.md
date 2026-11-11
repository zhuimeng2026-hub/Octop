# Octop 客户端下载

Octop 是一个开源自托管的 AI 助手平台：多用户、多智能体，单进程部署，不需要额外的
队列或中间件。本仓库用于分发 **Octop 桌面客户端** 的发行产物。

> 源码不在本仓库。源码见 [GitHub](https://github.com/TencentCloud/Octop) /
> [CNB](https://cnb.cool/mengxa.com/Octop)，本仓库只放下载页与 Release 产物。

## 下载

全部发行版本见 [Releases](https://gitee.com/webheat/octop_client/releases)。

### 桌面客户端

| 客户端 | 体积 | 说明 |
|---|---|---|
| **远程版** | ~18 MB | 连接已部署好的 Octop 服务，本机不需要装 Python 运行时，装完即用 |
| **slim 本地版** | ~20 MB | 在本机跑完整运行时。**首次启动**会从 GitHub Release 下载约 290 MB 的运行时并解包到本地，之后离线可用 |

**本轮只提供 Windows 版**（64 位 / ARM64）。macOS 与 Linux 版本暂未发布。

### 其它产物

- `octop-*.whl` / `octop-*.tar.gz`：Python 包，服务端用 `pip install octop` 安装
- `Octop-fnos-docker-*.fpk`：fnOS（飞牛）NAS 的 Docker 版安装包

## 为什么有两种客户端

完整的桌面安装包把整套 Python 运行时嵌进去，体积 200–340 MB。Gitee 单个附件上限
100 MB，放不下，所以提供两个更小的形态：

- **远程版**面向"已经有 Octop 服务"的用户；
- **slim 本地版**面向"要自己跑一套"的用户，把运行时下载推迟到首次启动。

运行时本体（~290 MB）和完整离线安装包超过 Gitee 的附件上限，只在
[GitHub Release](https://github.com/zhuimeng2026-hub/Octop/releases) 上提供，
本页给出链接。

## 文档

- 使用文档与部署指南：<https://github.com/TencentCloud/Octop/tree/main/docs>
- API 参考：<https://github.com/TencentCloud/Octop/blob/main/docs/api.md>

## 许可

MIT，见源码仓库。
