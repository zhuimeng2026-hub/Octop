# Concat 引擎：Windows 便携包构建与发布

把上游 [Concat](https://github.com/jub0t/Concat) 的 Windows 安装包重组成**绿色便携 zip**，
生成客户端可读的引擎清单，并上传到 CDN 节点。服务于 [backlog.md B-008](../../docs/backlog.md)
（Concat 接入编辑界面）与 [concat-editor-integration.md §8](../../docs/concat-editor-integration.md)（分发口径定为「乙：客户端按需下载并校验」）。

## 为什么需要重组

上游 release 只发布 Inno Setup 安装包（`*-windows-x86_64-setup.exe` / `.msi`），**不发布便携 zip**；
而 Concat 的绿色模式是靠「`concat.exe` 同级存在名为 `portable` 的目录」触发的
（上游 `concat-host/src/dirs.rs` 的 `portable_root()`）。本脚本：

1. 读上游 `manifest.json` 取安装包地址与 sha256（信任锚是上游自己发布的清单）；
2. 下载并**校验 sha256 + 字节数**；
3. `innoextract` 解出 `{app}` 目录树；
4. 同级补一个空的 `portable/` 目录 + `便携版说明.txt`；
5. 打成 `Concat-<版本>-windows-x86_64-portable.zip`；
6. 生成 `manifest.json`（`schema: 2`，`parts[].urls/sha256/bytes` 与既有下载器同构，客户端可直接消费）；
7. `--upload` 时逐台 scp 到 CDN 节点并**逐台比对 sha256**，最后写一份「最新版本」清单。

## 依赖

```bash
apt-get install -y innoextract     # 唯一的额外依赖
# 其余：curl / jq / zip / sha256sum / scp / ssh（系统自带）
```

## 用法

```bash
# 只在本地构建（不发布任何东西）
./build-concat-portable.sh --version 0.2.13

# 构建 + 上传 + 逐台校验
./build-concat-portable.sh --version 0.2.13 --upload

# 只校验远端已发布产物
./build-concat-portable.sh --version 0.2.13 --verify-only
```

### 环境变量（都有默认值，cron 里不需要额外注入）

| 变量 | 默认 | 说明 |
|---|---|---|
| `CONCAT_ENGINE_VERSION` | 取上游最新 release | 锁定版本 |
| `CONCAT_ENGINE_OUT_DIR` | `dist/concat-engine` | 产物目录 |
| `CONCAT_ENGINE_BASE_URL` | `https://dw.mengxa.com/concat-engine` | 清单里的主 URL |
| `CONCAT_ENGINE_MIRROR` | `http://dw.mengxa.com/concat-engine` | 兜底 URL |
| `CONCAT_ENGINE_DEPLOY_HOSTS` | 175.178.192.87,1.14.182.208,175.178.33.107 | CDN 节点 |
| `CONCAT_ENGINE_DEPLOY_PORT` | 13122 | SSH 端口 |
| `CONCAT_ENGINE_DEPLOY_KEY` | `~/.ssh/id_ed25519` | SSH 私钥 |
| `CONCAT_ENGINE_WEB_ROOT` | `/opt/dw.mengxa.com` | 远端 Web 根目录 |

## 产物与远端布局

```
本地：dist/concat-engine/
      Concat-0.2.13-windows-x86_64-portable.zip
      manifest.json
      0.2.13/{zip, manifest.json}          ← 版本目录

远端（每台 CDN 节点）：
      /opt/dw.mengxa.com/concat-engine/0.2.13/Concat-0.2.13-windows-x86_64-portable.zip
      /opt/dw.mengxa.com/concat-engine/0.2.13/manifest.json
      /opt/dw.mengxa.com/concat-engine/manifest.json      ← 最新版本（客户端读它）
```

## 许可提醒（AGPL）

分发 Concat 二进制即触发 AGPL 的源码提供义务。脚本不改上游代码，因此义务是**提供对应源码的获取方式**：
清单的 `source` 字段带上了 `repo` + `tag` + `installerSha256`，客户端展示时必须把它呈现给用户。
若将来要改 Concat 的代码再分发，就必须在包里附带修改与源码。

## 边界

- **模型不随引擎分发**（Whisper / 抠像 / TTS 音色是 GB 级），首次使用相关功能时由 Concat 自己按需下载；
- 引擎包**不含** Octop 的任何东西，它就是上游二进制 + 一个 `portable/` 目录；
- 本脚本只负责 Win x86_64。macOS / Linux 形态暂不在范围内（Octop PC 客户端是 Windows 目标）。
