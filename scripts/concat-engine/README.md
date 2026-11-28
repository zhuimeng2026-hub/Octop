# Concat 引擎：Windows 便携包构建与发布

把上游 [Concat](https://github.com/jub0t/Concat) 的 Windows 安装包重组成**绿色便携 zip**，
生成客户端可读的引擎清单，并上传到 CDN 节点。服务于 [backlog.md B-008](../../docs/backlog.md)
（Concat 接入编辑界面）与 [concat-editor-integration.md §8](../../docs/concat-editor-integration.md)（分发口径定为「乙：客户端按需下载并校验」）。

## 为什么需要重组

上游 release 只发布 Windows 安装包（`*-windows-x86_64-setup.exe` / `.msi`），**不发布便携 zip**；
而 Concat 的绿色模式是靠「`concat.exe` 同级存在名为 `portable` 的目录」触发的
（上游 `concat-host/src/dirs.rs` 的 `portable_root()`）。本脚本：

1. 读上游 `manifest.json` 取 `.msi` 的地址与 sha256（信任锚是上游自己发布的清单）；
2. 下载并**校验 sha256 + 字节数**；
3. `msiextract` 解出 staged 目录树；
4. 同级补一个空的 `portable/` 目录 + `便携版说明.txt`；
5. 打成 `Concat-<版本>-windows-x86_64-portable.zip`；
6. 生成 `manifest.json`（`schema: 2`，part 字段与既有下载器
   `desktop/src/bootstrap` 同构：含 `urls` / `sha256` / `size` / `format` / `required` /
   `connections` / `stripRoot`，客户端可直接消费）；
7. `--upload` 时**并发** scp 到各 CDN 节点并逐台比对 sha256（远端已是同 sha256 就跳过），
   最后写一份「最新版本」清单。

## 为什么用 `.msi` 而不是 `setup.exe`

上游的 `setup.exe` 是 **Inno Setup 6.7.0**，而 `innoextract` 最高只认到 6.3.3
（发行版里的 1.8 只认到 6.0.2）——Inno 路线**解不开**，会报
`Unexpected setup loader revision: 2` / `Could not determine setup data version!`。

`.msi` 是标准 MSI 库，`msitools` 的 `msiextract` 能解；上游 `.wxs` 明说两个安装器
出自同一份 staged 目录（*"Built … from the staged folder the .exe is made of, so the two
installers ship the same files"*），所以内容等价。

唯一差别：上游的 `.iss` 会额外把 `assets/icons/concat.ico` 放进 `{app}`，`.msi` 不带。
脚本会从上游仓库把图标补回来，让便携包的目录与真实安装后一致。

## 分发拓扑：四个下载点里只有三台供文件

`dw.mengxa.com` 的 DNS 轮询到 4 个 IP，但它们的 HTTPS/HTTP 能力并不一致：

| IP | HTTPS | HTTP | 角色 | 要不要上传 |
|---|---|---|---|---|
| `1.14.182.208` | ✅ 200 | ✅ 206 | HTTPS 主源 + HTTP 兜底 | ✅ |
| `175.178.33.107` | ✅ 200 | 301→HTTPS（不供文件） | HTTPS 主源 | ✅ |
| `175.178.192.87` | ❌ SNI 不匹配 | ✅ 206 | **只服务 HTTP** | ✅ |
| `8.134.147.195` | ❌ 过期证书 | 403 拦截页 | **故意挂的故障节点** | ❌ |

- `8.134.147.195` 是容灾验证用的故障节点（返回别的站点的过期证书 + 拦截页）：
  **不要给它上传，也不要从 DNS 摘掉** —— 摘了这套容灾验证就没了。
- 客户端拿到 manifest 后按 `(host, scheme)` 分组、逐 IP 探测并避开坏节点，
  再把并行 Range 分片轮询到不同可达节点上。所以 manifest 写双 scheme
  （https + http）同域名就够了，**不要写 IP 直连地址**。

### ⚠️ 发布前必须先补 nginx 的 `location /concat-engine/`

三台机器的 `/opt/dw.mengxa.com/` 下都还没有 `concat-engine/` 目录，
nginx 也只有 `/video-components/` 和 `/runtime-shards/` 的 location 块：

| 节点 | 需要改什么 | 不改的后果 |
|---|---|---|
| `175.178.192.87` | **不用改**（`location /` + `.json`/`.zip` 正则已覆盖任意路径） | — |
| `1.14.182.208` | 80 与 443 两个 server 块各加一个 `location /concat-engine/` | HTTP 落到 `location /` → 301；HTTPS → 404 |
| `175.178.33.107` | 443 server 块加一个 `location /concat-engine/`（80 保持 301 跳 HTTPS 即可） | HTTPS → 404 |

**文件传上去 ≠ 下载得到**：不改 nginx 的话，客户端拿到 404/301，
多点并行直接退化成 0 个可用源。改完用 `--verify-http` 逐 IP 复核。

## 依赖

```bash
apt-get install -y msitools        # 唯一的额外依赖（提供 msiextract）
# 其余：curl / jq / zip / sha256sum / scp / ssh（系统自带）
```

## 用法

```bash
# 只在本地构建（不发布任何东西）
./build-concat-portable.sh --version 0.2.13

# 构建 + 上传 + 逐台校验（各节点并发）
./build-concat-portable.sh --version 0.2.13 --upload

# 只校验远端已发布产物（逐台 sha256）
./build-concat-portable.sh --version 0.2.13 --verify-only

# 逐 IP 探活 HTTP 可达性 + Range 支持（发布前后都该跑）
./build-concat-portable.sh --version 0.2.13 --no-build --verify-http
```

### 环境变量（都有默认值，cron 里不需要额外注入）

| 变量 | 默认 | 说明 |
|---|---|---|
| `CONCAT_ENGINE_VERSION` | 取上游最新 release | 锁定版本 |
| `CONCAT_ENGINE_OUT_DIR` | `dist/concat-engine` | 产物目录 |
| `CONCAT_ENGINE_BASE_URL` | `https://dw.mengxa.com` | 主 URL（**只写到域名**，路径由脚本拼） |
| `CONCAT_ENGINE_MIRRORS` | `http://dw.mengxa.com` | 镜像 URL，逗号分隔；`--mirror` 可追加 |
| `CONCAT_ENGINE_CONNECTIONS` | `4` | 单个 part 开几路并行 Range 下载 |
| `CONCAT_ENGINE_DEPLOY_HOSTS` | 175.178.192.87,1.14.182.208,175.178.33.107 | CDN 节点（**不含故障节点**） |
| `CONCAT_ENGINE_DEPLOY_PORT` | 13122 | SSH 端口 |
| `CONCAT_ENGINE_DEPLOY_KEY` | `~/.ssh/id_ed25519` | SSH 私钥 |
| `CONCAT_ENGINE_WEB_ROOT` | `/opt/dw.mengxa.com` | 远端 Web 根目录 |

## 产物与远端布局

```
本地：dist/concat-engine/
      Concat-0.2.13-windows-x86_64-portable.zip
      Concat-0.2.13-windows-x86_64-portable.zip.meta.json   ← 上游安装包 sha + 产物 sha（幂等判定用）
      manifest.json
      cache/Concat-0.2.13-windows-x86_64.msi                ← 上游安装包缓存（sha 命中就不再下载）
      0.2.13/{zip, manifest.json}          ← 版本目录

远端（每台 CDN 节点）：
      /opt/dw.mengxa.com/concat-engine/0.2.13/Concat-0.2.13-windows-x86_64-portable.zip
      /opt/dw.mengxa.com/concat-engine/0.2.13/manifest.json
      /opt/dw.mengxa.com/concat-engine/manifest.json      ← 最新版本（客户端读它）
```

## 客户端怎么并行下载

清单里每个 part 带三个决定并行与否的字段，缺一个就退化成单连接（≈600 KB/s）：

| 字段 | 作用 | 缺了会怎样 |
|---|---|---|
| `urls[]` | 多个镜像地址 | 只有一个源，坏节点即下载失败 |
| `size` | 字节数 | 客户端**没法切 Range 分片**（`bootstrap` 判定为「无 size，单连接下载」） |
| `connections` | 并行 Range 路数 | 只开 1 路 |

客户端侧的 `desktop/src/bootstrap` 负责：逐 IP 探测 → 维护可用节点池 → 把 `size`
切成 `connections` 段并发 Range 拉取 → 拼接后按 `sha256` 校验。
`urls[]` 里的 https 与 http 是同一个域名的两个 scheme，客户端按 `(host, scheme)`
分组探测，所以**不需要写 IP 直连地址**。

⚠️ 客户端下载器**尚未接线**（见 [backlog.md B-008](../../docs/backlog.md) 步骤 6）：
上面这套字段口径是照着 `desktop/src/bootstrap` 的既有契约定的，客户端实现时直接对齐即可。

## 夜间自动构建（系统 crond）

`nightly-build.sh` 是给 cron 用的入口：不依赖交互 shell、失败可查、不重叠、不会把盘写满。

```cron
# Concat 引擎便携包：每晚 3:00 构建并发布到 CDN。
0 3 * * * /opt/Octop/scripts/concat-engine/nightly-build.sh >> /var/log/octop-concat-engine/cron.log 2>&1
```

| 位置 | 内容 |
|---|---|
| 入口 | `scripts/concat-engine/nightly-build.sh`（本机已装 crontab，见 `crontab -l`） |
| cron 日志 | `/var/log/octop-concat-engine/cron.log`（每次两行摘要） |
| 详细日志 | `dist/concat-engine/logs/nightly.log`（超过 10MB 轮转一份 `.1`） |
| 缓存 | `dist/concat-engine/cache/`（上游 `.msi`，sha 命中就不再下载） |

行为：

- **自动跟版本**：每次取上游最新 release；上游出了新版就构建并发布。
- **幂等**：同一版本重复跑，远端已是同 sha256 就跳过上传，只做校验 —— 每天跑不会反复传 132MB。
  前提是包本身可复现：打包时固定了时间戳并按排序后的条目顺序写入，所以**同样的上游 `.msi`
  永远产出同样的 sha256**（`CONCAT_ENGINE_ZIP_EPOCH` 控制时间戳）。
- **防重叠**：`flock` 拿不到锁就直接退出，不排队。
- **失败可见**：非零退出 + 日志尾部回显到 cron 日志。

手工跑：

```bash
/opt/Octop/scripts/concat-engine/nightly-build.sh              # 构建 + 发布
/opt/Octop/scripts/concat-engine/nightly-build.sh --no-upload  # 只构建不发布
```

卸载：`crontab -l | grep -v 'concat-engine/nightly-build.sh' | crontab -`

## 许可提醒（AGPL）

分发 Concat 二进制即触发 AGPL 的源码提供义务。脚本不改上游代码，因此义务是**提供对应源码的获取方式**：
清单的 `source` 字段带上了 `repo` + `tag` + `installerSha256`，客户端展示时必须把它呈现给用户。
若将来要改 Concat 的代码再分发，就必须在包里附带修改与源码。

> 口径说明：本条按 AGPL 的「提供获取地址」写法（上游未修改的二进制，对应源码就是该 tag 的源码树，
> 地址写在清单里并由客户端展示）。若改为自行分发源码包或自行构建，需同步更新本节与
> `docs/concat-editor-integration.md` §8.1。

## 边界

- **模型不随引擎分发**（Whisper / 抠像 / TTS 音色是 GB 级），首次使用相关功能时由 Concat 自己按需下载；
- 引擎包**不含** Octop 的任何东西，它就是上游二进制 + 一个 `portable/` 目录；
- 本脚本只负责 Win x86_64。macOS / Linux 形态暂不在范围内（Octop PC 客户端是 Windows 目标）。
