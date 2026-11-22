# 桌面运行时分层下载 —— 待人工 / 待 Windows 真机完成事项

> 登记**本机（Linux）无法完成、必须在 Windows 真机或其它仓库完成**的事项。
> 合并分支：`feature/desktop-runtime-layered-download`（PR-0 / PR-1 / PR-3+PR-5 已合并）。
> 生成时间：2026-11-19。
>
> 每项写清四件事：**为什么本机做不了** / **具体操作步骤** / **验收标准** / **阻塞关系**。
> 本文件**不写任何未实际验证的「通过」结论** —— 下列各项在本机均未执行。

---

## 零、总览

| # | 类别 | 事项 | 阻塞关系 |
|---|---|---|---|
| 1 | Windows 真机 | 重打运行时 zip 并验收体积（246MB → ≤190MB） | 阻塞 PR-1 的全部体积结论、阻塞 PR-0 的瘦身收益确认 |
| 2 | Windows 真机 | 分片安装后的首启冒烟（素材库 / 浏览器 / 视频 / 聊天回归） | 阻塞 PR-1 端到端验收 |
| 3 | Windows 真机 | 下载器行为真机验证（多 part / 断点续传 / SHA256 / 多镜像 fallback） | 阻塞 PR-1 下载器验收 |
| 4 | Windows 真机 | 分片安装的长路径与杀软行为 | 不阻塞，但影响装机成功率 |
| 5 | 跨仓库 | PR-0b：`octop-harness` 提供 `[base]` extra | 阻塞「减重天花板」目标 |
| 6 | 跨仓库 | PR-0b：`octop-gateway` 解除 `lark-oapi` 硬依赖 | 阻塞裁剪飞书 SDK |
| 7 | 跨仓库 | 本仓库跟着升 `octop-harness` / `octop-gateway` 的版本与 pin | 依赖 #5 / #6 先行 |
| 8 | 部署侧 | Docker / fnos / 安装脚本补 `tencentcloud` extra | 阻塞云工作台在容器部署下可用 |
| 9 | 决策 | PR-3 进度面板落点（dashboard 顶条 vs 托盘气泡） | 阻塞 PR-3 实现 |
| 10 | 决策 | PR-5 是否新增 `FEATURE_DEPS_MISSING` 错误码 | 阻塞 PR-5 后端改动 |
| 11 | 决策 | PR-5 OCR / embedding 是否也走分片 | 阻塞 PR-5 触发矩阵定稿 |
| 12 | 决策 | 可选分片是否需要真正的「取消」 | 不阻塞第一版 |
| 13 | 决策 | `uv.exe` 是否随 PR-0 拆出 core | 阻塞 PR-0 的 extras 切分定稿 |

---

## 一、Windows 真机打包与验收

### 1.1 重打运行时 zip 并验收体积

**为什么本机做不了**

便携 CPython、Windows 轮子、Windows 上的 zip 压缩率都只能在 Windows 上真实测量。
本机（Linux）即使跑 `package.sh windows-amd64` 也无法产出可用的 Windows 运行时
（`desktop/portable/package.sh` 明确要求在目标平台或 CI 上执行），
Linux 轮子的体积不能代表 Windows 产物。

**具体操作步骤**

```powershell
# 1. 取分支
git fetch
git switch feature/desktop-runtime-layered-download

# 2. 确认导出已剔除 PR-0 移出的两个包（不依赖 extras）
uv export --frozen --no-dev --no-emit-project --no-hashes -o req.txt
Select-String -Path req.txt -Pattern 'playwright|tencentcloud'   # 应无输出

# 3. 重打便携运行时（需先准备便携 CPython）
bash desktop/portable/bootstrap-runtime.sh windows-amd64
bash desktop/portable/package.sh windows-amd64

# 4. 记录体积（改动前的基线是 246,105,871 字节）
Get-Item desktop/portable/release/Octop-portable-windows-amd64-*.zip |
  Select-Object Name, Length
```

**验收标准**

- `Octop-portable-windows-amd64-*.zip` 的 `Length` **≤ 190MB**
  （约 199,229,440 字节）。
- zip 内不再包含两个包目录：

  ```powershell
  tar -tf desktop/portable/release/Octop-portable-windows-amd64-*.zip |
    Select-String 'packages/(playwright|tencentcloud)/'   # 应无输出
  ```

- 对照基线：`246,105,871` 字节 → 目标 ≤ `199,229,440` 字节，
  即至少减少 **46,876,431 字节（≈44.7MB）**。

**阻塞关系**

- 阻塞 PR-1 的全部体积结论（分片收益是否成立）。
- 阻塞 PR-0 的瘦身收益确认（`playwright` + `tencentcloud-sdk-python` 是否真的
  从 Windows 产物中消失）。
- 不阻塞本仓库代码合入 —— 代码层面已由 `uv export` + `uv lock --check` 验证。

---

### 1.2 分片安装后的首启与核心功能回归

**为什么本机做不了**

需要 Windows 真机（WebView2、长路径、Defender 实时防护、文件锁），
Linux 上跑不了 Wails 壳，也装不了 Windows 便携 CPython。

**具体操作步骤**

```powershell
# 1. 生成带 manifest 的 slim 安装包
#    PORTABLE_RUNTIME_MANIFEST_URL 指向分片 manifest 的可访问地址
cd desktop/src
wails3 task package ARCH=amd64 VERSION=<ver> PORTABLE_RUNTIME_MANIFEST_URL=https://<host>/<plat>/manifest.json

# 2. 安装并首启，观察落盘结构
#    %LOCALAPPDATA%\Octop\... 或 ~/.octop/portable 下应出现：
#      runtime/                     ← runtime part（根 part）
#      packages/                    ← deps-core part（拥有该目录）
#      packages/octop/              ← app part（append 进来）
#      packages/octop-<ver>.dist-info/
#      launch.py / start.bat / VERSION.txt

# 3. 核心功能回归清单（逐项打勾）
```

**验收标准 —— 核心功能回归清单**

| # | 功能 | 验收点 |
|---|---|---|
| 1 | 素材库 | 目录浏览、图片识别与归档正常；`packages/octop/` 下模块可导入 |
| 2 | 浏览器 | 浏览器环境页正常；`POST /api/browser/install` 仍能按需装 Chromium（Chromium 本体不在分片里） |
| 3 | 视频 | 视频环境诊断页正常；视频组件走**另一条** manifest 路径（`video_install.go`），确认未被分片改动波及 |
| 4 | 聊天 | 首启后能正常进入 Dashboard，发消息不报 `ModuleNotFoundError` |
| 5 | 版本识别 | `packages/octop-<ver>.dist-info/METADATA` 存在，`portableVersion()` 能读出版本号 |
| 6 | import | `site.addsitedir(packages)` 后 `import octop` 成功（`launch.py` 只认扁平 `packages/` 布局） |

**阻塞关系**

- 阻塞 PR-1 端到端验收。
- 第 5、6 项直接验证「方案 B（共享 `packages/` + `append`）」这一 target 布局决策
  在真机上成立 —— 详见 `docs/desktop-runtime-layered-download-pr3-pr5.md` §3.3。

---

### 1.3 下载器行为真机验证

**为什么本机做不了**

多镜像 fallback 依赖真实 CDN / COS 域名与 DNS 轮转；断点续传依赖真实服务端对
`Range` 请求的行为差异；这两点在 Linux 上只能用 mock 覆盖（`bootstrap` 包的
单测已覆盖 mock 路径），真机才能覆盖真实服务端。

**具体操作步骤**

| # | 场景 | 操作 | 期望 |
|---|---|---|---|
| 1 | 多 part 下载 | 用 §1.2 生成的 manifest 首次首启 | 进度条显示 `runtime` → `deps-core` → `app` 依次推进；三片都落盘 |
| 2 | 断点续传 | 下载到 50% 时杀进程 → 重开 | 从断点继续，**不重新下载**已完成的字节；`state.json` 记录已下载 part |
| 3 | SHA256 校验 | 把某个 part 的 `sha256` 改错后重试 | 报 `PACKAGE_INVALID` / 校验失败，**不落盘**，自动换下一个镜像 |
| 4 | 多镜像 fallback | manifest 里第一个 URL 指向 404 或不可达域名 | 自动切到第二个镜像并完成下载，最终 sha256 校验通过 |
| 5 | 全部镜像失败 | 所有 URL 都 404 | 给出可读错误，不落盘半成品；重试后仍可继续 |
| 6 | 平台校验 | 用 `platform: windows-arm64` 的 manifest 在 amd64 机器上启动 | 报「平台不匹配」，**不落盘**（`download.go` 已加该校验） |

**验收标准**

- 上表 6 项全部符合「期望」列。
- 第 2 项需在 `%LOCALAPPDATA%\Octop\portable-cache\parts\` 下确认 `.part`
  半成品文件存在且大小 > 0。
- 第 4 项需在 `navlog` 中确认出现镜像切换记录。

**阻塞关系**

- 阻塞 PR-1 下载器在真实服务端上的验收。
- 不阻塞本仓库代码合入 —— `bootstrap` 包单测已覆盖 mock 路径
  （`TestFetchResumesAfterTheConnectionDrops` /
  `TestFetchSwitchesToTheNextMirrorOnAChecksumMismatch` 等，本机实跑通过）。

---

### 1.4 分片安装的长路径与杀软行为

**为什么本机做不了**

`MAX_PATH` 260 限制与 Defender 实时扫描对大量小文件解压的行为是 Windows 特有的。

**具体操作步骤**

1. 在默认短路径（`C:\Users\<user>\AppData\Local\...`）完成 §1.2 的安装。
2. 在很深的用户目录（如 `C:\Users\<longusername>\AppData\Local\...`）重复一次。
3. 记录 Defender 实时防护开启 / 关闭两种情况下的安装耗时。
4. 确认是否需要给安装目录加排除项。

**验收标准**

- 解压无 `path too long` 报错。
- `packages/` 内最长的 `.dist-info` 路径可正常创建。
- 杀软开启时安装耗时可接受；若有误报，给出排除项建议。

**阻塞关系**

- 不阻塞代码合入，影响装机成功率与体验。

---

## 二、PR-0b 跨仓库事项（其它仓库完成）

### 2.1 `octop-harness` 提供收窄的 `[base]` extra

**为什么本机做不了**

`octop-harness` 是独立仓库（`octop-harness`），其 `pyproject.toml` 不在本仓库，
本仓库无法单方面把 `octop-harness[all]` 改成 `octop-harness[base]`。

**具体操作步骤（octop-harness 仓库）**

1. 在 `octop-harness/pyproject.toml` 中新增 `[base]` extra，
   只保留 Octop 核心真正 import 的依赖。
2. 把 `google-api-python-client`（约 14.8MB）与 `boto3` / `botocore`
   （约 13MB）移出默认依赖，改由可选 extra 提供。
3. 发布新版本。

**验收标准**

- `pip install octop-harness[base]` 后，`octop` 核心功能全部可用。
- `google-api-python-client` / `boto3` 不再被默认拉入。

---

### 2.2 `octop-gateway` 解除 `lark-oapi` 硬依赖

**为什么本机做不了**

`octop-gateway` 是独立仓库，其依赖定义不在本仓库。

**具体操作步骤（octop-gateway 仓库）**

1. 把 `lark-oapi` 从默认依赖移出，改由可选 extra 或运行时按需安装提供。
2. 若裁剪飞书，需确认飞书渠道的导入路径不因缺少 `lark-oapi` 而在启动期报错。
3. 发布新版本。

**验收标准**

- 不安装 `lark-oapi` 时，除飞书渠道外的功能全部正常。
- 飞书渠道在缺少 SDK 时给出可读提示（而非启动崩溃）。

---

### 2.3 本仓库需要跟着升的版本与 pin

**为什么本机做不了**

依赖 2.1 / 2.2 的新版本先发布，本仓库才能 pin 到它。

**具体操作步骤（本仓库）**

1. 在 `pyproject.toml` 把 `octop-harness[all]` 改为 pin 到提供 `[base]` 的版本，
   同样处理 `octop-gateway`。
2. 重跑 `uv lock`，确认 diff 只涉及这两个包及其传递依赖。
3. 跑 `uv run pytest -m "not live"` 与 `uv run mypy src/octop`。

**验收标准**

- `uv export --no-dev` 的产物中**不再出现**
  `google-api-python-client` 与 `boto3`。
- 全量测试保持绿（除本仓库已知的既有失败，见 §五）。
- 重打 zip 后体积继续下降，且核心功能不回归（需重跑 §1.1 / §1.2）。

**阻塞关系**

- 依赖 §2.1 / §2.2 先行。
- 是「减重天花板」目标 —— 做到这里体积才可能稳定压到 190MB 以下。

---

## 三、PR-3 / PR-5 待人类决策或需真机确认的点

> 来源：`REPORT-pr35.md` §3「仍需人类决策」与
> `docs/desktop-runtime-layered-download-pr3-pr5.md` §10。

### 3.1 PR-1 的 target 方案（A / B）—— 已定为 B，需真机确认残留风险

**状态**：**已决策**。PR-1 落地**方案 B**（多个 part 共享 `packages/`，
第一个 part 拥有该目录、其余带 `append:true` 只追加文件），
理由见 §1.2 第 6 项与设计文档 §3.3 的「决议」。

**仍需真机确认的点**

- 方案 B 的已知缺点一：**旧文件不会被清理**，升级时可能残留上一版本的文件。
  → 真机需验证：升级到新版本后，`packages/` 下是否残留旧版独有文件，
  是否有副作用。
- 方案 B 的已知缺点二：Windows 上若目标 DLL 正被运行中的 Python 加载，
  `RemoveAll` / 覆盖会失败。
  → 真机需验证：运行中的客户端触发升级时，`packages/` 覆盖是否失败。

**合并时新发现的一处跨分支交互（需真机确认）**

方案 B 下 `deps-core` 是 `packages/` 的 owner（`append:false`），
`bootstrap.Run()` 解包它时会**清空** `packages/`。
`Run()` 每次被调用都会重新解包 required part（缓存命中也会重解），
因此一次 `Run()` 会把 `packages/` 重置为「deps-core + app」，
**此前按需装上的可选分片（`deps-tencent` 等）会随之消失**。

- 现状下这不构成 bug：`Run()` 只在**首装或升级**时触发
  （`download.go:ensurePortable` 在运行时版本匹配时直接返回，不走 `Run()`），
  升级时 `replacePortable` 整体换目录，可选分片本就要重下；
  `state.json` 按版本作废（`bootstrap.go:147-154`）也会清掉缓存。
- 但 PR-5 落地「运行中按需补装」后，**升级流程必须在根 part 装完之后
  再按需补可选 part**，不能沿用旧目录 —— 与设计文档 §3.4 的结论一致。
- 真机需验证：装好可选分片 → 触发升级 → 确认可选分片被正确重装（而非永久消失）。

**验收标准**

- 升级后 `packages/` 无上一版本残留的独有文件。
- 客户端运行中触发升级不产生半损坏的 `packages/` 树。

**阻塞关系**

- 阻塞 PR-5「运行中按需补装可选 part」的最终形态 —— 若方案 B 的上述缺点在真机上
  不可接受，需回头评估方案 A（`_parts/<id>` + `.pth`），
  届时要改 `launch.py` 的 `sys.path` 处理与 `pack_portable_shards.py` 的分组逻辑。

---

### 3.2 PR-3 进度面板的落点

**为什么需要决策**

顶部提示条要改 dashboard 前端；托盘气泡只改 Go 壳。两者工作量与可见性差别很大。

**具体操作步骤**

1. 决策后按
   `docs/desktop-runtime-layered-download-pr3-pr5.md` §5.2 / §5.4 / §6 实现：
   新增 `desktop:progress` 事件、事件缓存与 `GetProgressSnapshot`、
   `RetryBootstrap`、`window.octopDesktopRuntime` 桥。
2. 壳 loading 面板接真实进度（替换现在的 CSS 无限滑动动画）。

**验收标准**

- 下载中显示真实百分比。
- 页面刷新后能通过快照恢复到当前进度（`go api.boot()` 早于页面 `Events.On`
  注册，早期事件会丢 —— 见设计文档 §2.3）。
- 可选 part 安装不影响主流程。

**阻塞关系**

- 阻塞 PR-3 的实现本身。

---

### 3.3 PR-5 是否新增 `FEATURE_DEPS_MISSING` 错误码

**为什么需要决策**

新增更清晰，但要动 `src/octop/infra/errors.py` 与 `src/octop/i18n/*.json`
（后端 + dashboard 双侧 key 对齐）；复用现有 `*_DEPS_FAILED` + `details.part`
则改动小，但语义不够明确。

**具体操作步骤**

若选「新增」：

1. 在 `src/octop/infra/errors.py` 加 `ErrorCode.FEATURE_DEPS_MISSING`。
2. 在 `src/octop/i18n/{en,zh}.json` 加 `errors.FEATURE_DEPS_MISSING`。
3. 在 dashboard `src/locales/{en,zh}.json` 加同名 `apiErrors` 条目。
4. 跑 `uv run pytest tests/unit/i18n -q` 确认两侧 key 对齐。

若选「复用」：在现有 `*_DEPS_FAILED` 的错误里带 `details.part`。

**验收标准**

- `uv run pytest tests/unit/i18n -q` 绿。
- 单测覆盖「依赖缺失 → 抛错带 part」与「安装后重试成功」。

**阻塞关系**

- 阻塞 PR-5 的后端改动与 dashboard 联动。

---

### 3.4 OCR / embedding 是否也走分片

**为什么需要决策**

当前第一版建议 OCR / embedding 继续走既有的
`src/octop/infra/utils/runtime_packages.py:install_packages()`（pip 路径），
只对 browser / feishu / tencent 启用分片，
避免壳下载器与 pip 抢着装同一个包。

**具体操作步骤**

1. 定稿触发矩阵（设计文档 §4.1）。
2. 若确定走分片，需在 `pack_portable_shards.py` 的 `OPTIONAL_GROUPS` 里加组，
   并在 `pyproject.toml` 把对应依赖 extras 化（依赖 PR-0 的 extras 切分）。

**验收标准**

- 每个可选组装完可独立 `import` 其主包（`tencentcloud` / `googleapiclient` /
  `boto3` / `lark_oapi`）。
- 不装可选组时核心启动无 `ImportError`。

**阻塞关系**

- 阻塞 PR-5 触发矩阵定稿。

---

### 3.5 可选分片是否需要真正的「取消」

**为什么需要决策**

当前 `bootstrap.Options` 没有 `context`，取消需要给 `Options` 加 `context`。
第一版建议只提供启动前「稍后」。

**具体操作步骤**

若确定需要取消：

1. 给 `bootstrap.Options` 加 `context.Context`。
2. 在 `fetcher.fetch` 的重试循环里检查 `ctx.Done()`。
3. 壳侧接「取消」按钮。

**验收标准**

- 取消后 `.part` 半成品保留，可下次续传。

**阻塞关系**

- 不阻塞第一版。

---

### 3.6 `uv.exe` 是否随 PR-0 拆出 core

**为什么需要决策**

若把 `uv.exe` 拆到可选 part，必须同步
`src/octop/infra/utils/runtime_packages.py:42-79` 与
`src/octop/infra/setup/self_update.py:111-141` 的查找路径，
否则装包与自更新会退回 `pip`（可能不存在）。

**具体操作步骤**

1. 决策后（若拆）同步上述两处查找逻辑。
2. 验证 `runtime_packages.install_packages()` 与 `self_update` 在无 `uv` 时的回退路径。

**验收标准**

- 拆出后装包与自更新仍能找到 `uv`，或在缺失时给出可读提示。

**阻塞关系**

- 阻塞 PR-0 的 extras 切分定稿。

---

## 四、部署侧补齐 `tencentcloud` extra（PR-0 的连带项）

**为什么本机做不了**

这是本仓库的改动，但需要在真实 Docker / fnos 构建环境验证镜像内容，
本机没有对应构建环境。

**具体操作步骤**

`tencentcloud-sdk-python` 已不再是核心依赖，下列入口没有显式安装该 extra：

| 入口 | 现状 | 需要改成 |
|---|---|---|
| `deploy/docker/Dockerfile` | lite/full 均只有 `browser` 等 extras | 追加 `--extra tencentcloud` |
| `fnos/docker/Dockerfile` | lite 为 `.[browser]`，full 为 `.[desktop,local-embedding,knowledge-ocr]` | 追加 `[tencentcloud]`（顺带：full 还缺 `browser`，此前靠核心依赖获得 playwright） |
| `scripts/install.sh` / `scripts/install-octop.sh` | 默认只合并 `browser` | 追加 `tencentcloud` |
| `bootstrap/bootstrap.sh` | 安装裸 `octop` | 视需要追加 |

同时更新「playwright 是核心依赖」的过时注释。

**验收标准**

- 对应镜像 / 安装产物中 `python -c "import tencentcloud"` 成功，云工作台可用。
- fnos full 镜像中 `python -c "import playwright"` 成功。

**阻塞关系**

- 阻塞云工作台在容器部署下可用。
- 不阻塞桌面端运行时下载路径。

---

## 五、本机已验证与未验证的边界

### 5.1 本机已实际执行并通过（原文见 `REPORT-layered-download.md`）

- `uv lock --check`（内部镜像源）→ `Resolved 256 packages in 1ms`
- `uv run ruff check src tests` → `All checks passed!`
- `uv run ruff format --check src tests` → `1344 files already formatted`
- `uv run mypy src/octop` → `Success: no issues found in 697 source files`
- `cd desktop/src && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build ./...` → 通过
- `cd desktop/src && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go vet ./...` → 通过
- `cd desktop/src && go test ./bootstrap/ -count=1` → `ok octop.desktop/bootstrap`
- `desktop/portable/pack_portable_shards.py` 合成树干跑 → 产出
  `runtime` / `deps-core` / `app` 三片与 manifest.json

### 5.2 本机**无法**验证的（本文件登记的全部内容）

- Windows 真机的任何行为（体积、装包、下载、杀软、长路径）。
- 任何需要真实 LLM / 外部服务的功能（`-m live`）。
- 其它仓库（`octop-harness` / `octop-gateway`）的改动。

### 5.3 已知与本任务无关的既有失败

`uv run pytest -m "not live"` 中以下 6 个失败**在合并前的基线提交
`affc8623` 上同样存在**，且三个分支均未触及相关文件：

| 失败测试 | 原因 |
|---|---|
| `tests/unit/test_portable_prune.py`（3 例） | 测试加载 `desktop/portable/prune_packages.py`，该文件在基线上就不存在 |
| `tests/unit/test_fnos_docker_persist.py`（3 例） | 测试期望 compose 镜像 tag `0.0.0`，基线上的实际文件是 `1.5.0` |

**这 6 个失败与本次分层下载改动无关，未做修改**（不做删测试 / 改断言来凑绿）。
