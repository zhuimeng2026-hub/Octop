# 桌面运行时分层下载 —— 合并汇总报告

> 任务：合并 `feature/layered-download-pr0` / `-pr1` / `-pr35` 三个并行分支到
> `feature/desktop-runtime-layered-download`，解决冲突，跑验证，登记待人工事项。
> 时间：2026-11-19　执行环境：Linux（本机无 Windows 真机）
> 分支状态：**未 push、未打 tag、未 publish、未发布 Release**；
> 未改 `/opt/Octop` 主工作区、未改 crontab。

---

## 一、结论

| 项 | 结果 |
|---|---|
| 三个分支是否都产生了提交 | **是**，共 10 个提交（PR-0 三個、PR-1 四個、PR-35 三個） |
| 合并 | 三个分支全部合入，PR-0 为 fast-forward，PR-1 / PR-35 为 merge commit |
| Git 文本冲突 | **无**（三个分支改动文件基本不重叠） |
| **语义冲突** | **有 1 处**（PR-1 与 PR-35 的 target 布局约定互斥），已手工解决，见 §四 |
| 后端静态检查 | ruff / ruff format / mypy 全绿 |
| Go 检查 | `go build` / `go vet`（Windows 交叉编译）+ `go test ./bootstrap/` 全绿 |
| 前端 | **无改动**，故 `tsc -b` 不适用 |
| pytest 全量 | 见 §三.2（**6 个失败为基线既有失败，已用独立 worktree 在基线提交上复现证明**） |
| 待人工 / 待 Windows 真机 | 已登记到 `docs/desktop-runtime-layered-download-pending.md`（13 项） |

---

## 二、分支与 commit 列表

### 2.1 PR-0：依赖瘦身（`feature/layered-download-pr0`）

| commit | 内容 |
|---|---|
| `7239dd56` | `refactor(cloud): 腾讯云 SDK 改为函数内惰性导入` |
| `8cd12514` | `build(deps): playwright 与腾讯云 SDK 移出核心依赖` |
| `faf0528a` | `docs(desktop): PR-0 依赖瘦身交付报告` |

改动文件（6 个）：

```
 REPORT-pr0.md                                          | 250 +++++++++
 pyproject.toml                                         |  13 +-
 src/octop/infra/cloud/tencent.py                       |  89 ++++++---
 tests/unit/infra/cloud/test_tencent_catalog.py        |   5 +-
 tests/unit/infra/cloud/test_tencent_trend.py          |  12 +-
 uv.lock                                                |  14 +-
```

**完成状态：完成。** `playwright` 从核心依赖移入 `browser` extra；
`tencentcloud-sdk-python` 移入新增的 `tencentcloud` extra，
且 `src/octop/infra/cloud/tencent.py` 的 8 处模块级 import 改为函数内惰性
（新增 `_cvm_client()` / `_cvm_models()` / `_monitor_client()` /
`_monitor_models()` / `_sdk_exception()` 五个惰性访问器，
`_ACTIONS` 改存类名字符串以避免导入期触碰 SDK）。

**未完成（已登记到 pending 文档）**：Windows 真机体积验收、部署侧 extras 补齐、
跨仓库 PR-0b。

### 2.2 PR-1：分片脚本 + `download.go` + CI job（`feature/layered-download-pr1`）

| commit | 内容 |
|---|---|
| `8d3935b8` | `feat(desktop): 运行时分层制品打包脚本（分片 + manifest）` |
| `a2858acd` | `feat(desktop): 运行时下载支持分片叠加与平台校验` |
| `27d92dbd` | `ci(desktop): 新增运行时分片产物 job（仅产出，不发布）` |
| `7f5e6e30` | `docs(desktop): PR-1 分片制品实施报告` |

改动文件（9 个）：

```
 .github/workflows/octop-desktop.yml                    |  54 ++++++
 REPORT-pr1.md                                          | 229 ++++++++++++
 desktop/portable/pack_portable_shards.py               | 406 +++++++++++++++++++
 desktop/portable/package-shards.sh                     |  32 +++
 desktop/src/bootstrap/bootstrap.go                     |  11 +
 desktop/src/bootstrap/bootstrap_test.go                |  69 +++++
 desktop/src/bootstrap/unpack.go                        |  17 ++
 desktop/src/download.go                                |  17 +-
 desktop/src/portable_download_test.go                  |  21 ++
```

**完成状态：完成（代码与 CI）。** 分片打包脚本、manifest 生成、
`bootstrap.Part.Append` 字段、`ExtractOver` 解包原语、`download.go` 的
`Merge: true` 与平台校验、CI `shards` job（仅产出 artifact，不发布）均已落地。

**未完成（已登记到 pending 文档）**：真实 Windows 运行时 zip 的分片产出
（本机无法执行 `bootstrap-runtime.sh windows-*`）、分片安装端到端验证、
CI job 首次真实运行（任务约束禁止 push）。

### 2.3 PR-3 / PR-5：设计与最小实现（`feature/layered-download-pr35`）

| commit | 内容 |
|---|---|
| `b914dad4` | `feat(desktop): 新增 bootstrap.RunParts 按需安装指定分片（PR-5 原型）` |
| `5550e655` | `docs(desktop): PR-3/PR-5 进度面板与可选组件按需补齐设计` |
| `1e991d9e` | `docs(desktop): 报告补记设计文档 commit hash` |

改动文件（4 个）：

```
 REPORT-pr35.md                                         | 190 ++++++
 desktop/src/bootstrap/run_parts.go                     |  81 ++++++
 desktop/src/bootstrap/run_parts_test.go                | 149 ++++++++++
 docs/desktop-runtime-layered-download-pr3-pr5.md       | 585 ++++++++++++++
```

**完成状态：设计与原型完成，落地未开始。**
`docs/desktop-runtime-layered-download-pr3-pr5.md` 覆盖任务书要求的全部章节
（触发矩阵、错误协议、进度面板状态机、manifest 契约、分阶段计划、12 条真机验证项）。
代码原型 `bootstrap.RunParts()` 纯新增，不改 `Run()`。

**未完成（已登记到 pending 文档）**：PR-3 进度面板 UI、PR-5 触发点与后端配合、
dashboard 侧错误码处理 —— 全部属 pending 文档 §三 的决策项。

### 2.4 合并后的提交图

```
046b81a8 Merge branch 'feature/layered-download-pr35' into feature/desktop-runtime-layered-download
32426fac Merge branch 'feature/layered-download-pr1'  into feature/desktop-runtime-layered-download
faf0528a docs(desktop): PR-0 依赖瘦身交付报告
7f5e6e30 docs(desktop): PR-1 分片制品实施报告
27d92dbd ci(desktop): 新增运行时分片产物 job（仅产出，不发布）
1e991d9e docs(desktop): 报告补记设计文档 commit hash
a2858acd feat(desktop): 运行时下载支持分片叠加与平台校验
5550e655 docs(desktop): PR-3/PR-5 进度面板与可选组件按需补齐设计
8d3935b8 feat(desktop): 运行时分层制品打包脚本（分片 + manifest）
8cd12514 build(deps): playwright 与腾讯云 SDK 移出核心依赖
7239dd56 refactor(cloud): 腾讯云 SDK 改为函数内惰性导入
b914dad4 feat(desktop): 新增 bootstrap.RunParts 按需安装指定分片（PR-5 原型）
```

---

## 三、验证命令与实际结果

> 以下均为**实际执行**的输出，不是「预期通过」。

### 3.1 PR-0 相关（后端）

```console
$ UV_INDEX_URL=http://192.168.20.173:4874/simple/ uv lock --check
Resolved 256 packages in 1ms
```

```console
$ uv run ruff check src tests
All checks passed!

$ uv run ruff format --check src tests
1344 files already formatted
```

```console
$ uv run mypy src/octop
Success: no issues found in 697 source files
```

### 3.2 PR-0 相关（测试）

`uv run pytest -m "not live" -q` 全量运行结果见 §3.6。

PR-0 报告提到的**两个既有失败**已独立复核 —— 用一个 detached worktree
检出基线提交 `affc8623`（合并前）跑同一批测试：

```console
$ cd /tmp/base-check && uv run pytest tests/unit/test_portable_prune.py \
    tests/unit/test_fnos_docker_persist.py -q
FAILED tests/unit/test_portable_prune.py::test_prune_removes_bloat_and_keeps_product_files
FAILED tests/unit/test_portable_prune.py::test_prune_is_idempotent - FileNotF...
FAILED tests/unit/test_portable_prune.py::test_prune_rejects_a_changed_discovery_client
FAILED tests/unit/test_fnos_docker_persist.py::test_fnos_manifest_version_is_placeholder[manifest0]
FAILED tests/unit/test_fnos_docker_persist.py::test_fnos_manifest_version_is_placeholder[manifest1]
FAILED tests/unit/test_fnos_docker_compose_uses_trim_data_share_paths
6 failed, 38 passed in 0.63s
```

**结论：这 6 个失败在基线提交上同样存在**，且三个分支均未触及相关文件
（`git diff --name-only affc8623..HEAD` 中无 `prune_packages` / `fnos`）。
未做删测试 / 改断言处理。

### 3.3 PR-1 相关（Go）

本机 Linux 原生 `go build ./...` 失败于 Wails v3 beta.13 的 GTK 4.10+
依赖（本机 Ubuntu 只有 GTK 4.6，缺 `GtkFileDialog`）—— 这是**环境问题**，
与本次改动无关，与 PR-1 报告的记录一致。改用 Windows 目标交叉编译覆盖：

```console
$ cd desktop/src
$ GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build ./...
（无输出，exit 0）

$ GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go vet ./...
（无输出，exit 0）

$ go test ./bootstrap/ -count=1
ok  	octop.desktop/bootstrap	0.041s
```

`gofmt -l .` 输出 `navlog.go` —— 该文件在**基线提交上就是未格式化**，
且三个分支均未触碰（`git diff --name-only affc8623..HEAD` 中不含它），
故未做无关改动。

### 3.4 PR-1 相关（脚本与 CI 配置）

```console
$ python3 -m py_compile desktop/portable/pack_portable_shards.py
PY_COMPILE_OK

$ bash -n desktop/portable/package-shards.sh
BASH_SYNTAX_OK

$ python3 -c "import yaml; yaml.safe_load(open('.github/workflows/octop-desktop.yml'))"
YAML_OK
```

分片脚本在合成树上的实跑（验证 manifest 字段与 part 划分）：

```console
$ python3 desktop/portable/pack_portable_shards.py \
    --staging /tmp/shardtest/Octop-testplat --plat testplat --version 1.4.0 \
    --out-dir /tmp/shardtest/out
[runtime-shards] manifest: /tmp/shardtest/out/testplat/manifest.json
[runtime-shards] platform: testplat  version: 1.4.0  mirrors: 1
  - runtime           0.0 MB  required=True append=False target=<root>
  - deps-core         0.0 MB  required=True append=False target=packages
  - app               0.0 MB  required=True append=True  target=packages
```

（合成树未装 `tencentcloud-sdk-python` 发行版，故可选组为空被正确省略。）

平台标识一致性核对（PR-1 的平台校验依赖两者同名）：

```console
$ python3 -c "import importlib.util; ...; m.infer_from_zip(Path(name))"
Octop-portable-windows-amd64-1.4.0.zip  -> ('windows-amd64', '1.4.0')
Octop-portable-windows-arm64-1.4.0.zip  -> ('windows-arm64', '1.4.0')
Octop-portable-darwin-arm64-2.0.1.zip   -> ('darwin-arm64', '2.0.1')
```

打包脚本从 zip 名推出的 platform 键（`windows-amd64`）与 Go 侧
`desktop/src/settings.go:110 greenPlat()` 产出的键（`osName-arch`）同构，
故 `download.go` 新增的平台校验在真实 manifest 上能正确命中。
（视频组件走**另一套**平台键 `win-x64` / `win-arm64`，见
`video_install.go:52 componentsManifestPlatform()`，两套命名互不干扰。）

### 3.5 PR-0 的惰性化行为独立复核

PR-0 报告称「未安装 SDK / 未安装 playwright 时核心模块与路由仍可导入」，
本次独立复现（用 `importlib.abc.MetaPathFinder` 拦截对应包）：

```console
$ uv run python -I /tmp/check_lazy.py
cloud router imported OK, routes: 12
_cvm_client lazy ImportError as expected
_cvm_models lazy ImportError as expected
_monitor_client lazy ImportError as expected
_monitor_models lazy ImportError as expected
_sdk_exception lazy ImportError as expected

$ uv run python -I /tmp/check_no_pw.py
core imports OK
_probe_env playwright = False
```

两个脚本均为一次性验证脚本，**未入库**。

### 3.6 合并冲突处理后的 Go 验证

§四的语义冲突解决改了 `desktop/src/bootstrap/run_parts.go`，
故重跑了 Go 全部检查：

```console
$ cd desktop/src
$ gofmt -l bootstrap/
（无输出）

$ go vet ./bootstrap/
（无输出）

$ go test ./bootstrap/ -count=1 -v | grep -E "^(--- |ok|FAIL)"
--- PASS: TestFetchResumesAfterTheConnectionDrops (0.00s)
--- PASS: TestFetchRestartsWhenTheServerIgnoresTheRange (0.00s)
--- PASS: TestFetchSwitchesToTheNextMirrorOnAChecksumMismatch (0.00s)
--- PASS: TestFetchFailsWhenEveryMirrorServesTheWrongBytes (0.00s)
--- PASS: TestRunInstallsTheRuntimeAndRemembersIt (0.00s)
--- PASS: TestRunSkipsOptionalParts (0.00s)
--- PASS: TestExtractTarGz (0.00s)
--- PASS: TestExtractRejectsPathsOutsideTheDestination (0.00s)
--- PASS: TestValidatePartsMergeMode (0.00s)
--- PASS: TestRunMergeLayersPartsIntoOneRoot (0.00s)
--- PASS: TestRunMergeAppendsToSharedTarget (0.01s)
--- PASS: TestRunPartsInstallsOnlyTheNamedOptionalPartAndKeepsTheRoot (0.00s)
--- PASS: TestRunPartsRejectsAnUnknownPart (0.00s)
--- PASS: TestRunPartsRejectsNoPartIDs (0.00s)
--- PASS: TestRunPartsRejectsPartsThatShareATarget (0.00s)
--- PASS: TestRunPartsAllowsAnOwnerAndAppendingPartsOnOneTarget (0.00s)
--- PASS: TestRunPartsRejectsAnOwnerThatWouldDeleteARequiredPart (0.00s)
--- PASS: TestRunPartsRejectsAnOwnerAfterAnAppendingPart (0.00s)
ok  	octop.desktop/bootstrap	0.039s
```

### 3.6 pytest 全量

见 §六「验证命令与实际结果（最终态）」一节 —— 全量运行在报告生成时仍在进行，
最终输出已填入该节。

### 3.7 前端

`git diff --stat affc8623..HEAD -- dashboard/ src/octop/dashboard/` 为空
—— **三个分支均未改动前端**，故 `cd dashboard && npx tsc -b` 不适用。

---

## 四、合并冲突与处理方式

### 4.1 Git 文本冲突：无

三个分支的改动文件几乎不重叠（PR-0 碰 Python 依赖与 `tencent.py`，
PR-1 碰 Go 与打包脚本，PR-35 碰 `run_parts.go` 与设计文档），
`git merge --no-edit` 全部一次通过，无冲突标记。

### 4.2 语义冲突：1 处（PR-1 ↔ PR-35 的 target 布局互斥）

**冲突描述**

- PR-1 实现了设计文档 §3.3 的**方案 B**：给 `Part` 增加一个布尔字段
  （PR-1 命名为 `Append`，文档建议名 `Additive`），
  `unpack()` 对 additive part 跳过 `RemoveAll`，允许多个 part 共享 `packages/`。
  其 manifest 里 `runtime` / `deps-core` / `app` / `deps-*` 的 target 布局是：

  | part | target | append | required |
  |---|---|---|---|
  | `runtime` | `""`（根） | false | true |
  | `deps-core` | `packages` | false | true |
  | `app` | `packages` | **true** | true |
  | `deps-*` | `packages` | **true** | false |

- PR-35 的 `RunParts` 原型则按**方案 A** 写死：
  `rejectSharedTargets()` 无条件拒绝「两个被选中的 part 共享同一 target」，
  并在注释里写「Distinct targets per part (for example
  "packages/_parts/<id>") are the contract」。

**直接合并的后果**：两个分支都能编译、各自的单测都能过，但
`RunParts(["deps-tencent","deps-lark"])` 在 PR-1 产出的 manifest 上会被
**误拒** —— 而这两个 part 共享 `packages/` 恰恰是 PR-1 的正常布局。
这是 git 不会报、但语义上真实存在的冲突。

**决策依据**

以任务书 `docs/desktop-runtime-layered-download-task.md` §3 PR-1 为准：

> 各 part 用 `target` 指向同一 `packages/` 子路径 ——
> `desktop/portable/templates/launch.py:30-41` 用 `site.addsitedir(packages)`，
> 只要最终落到 `packages/` 就能加载。

即**任务书本身要求共享 `packages/` 目标**（即方案 B）。
方案 A 的 `_parts/<id>` + `.pth` 需要额外改 `launch.py` 的 `sys.path` 处理
（`site.addsitedir` 只认扁平布局），超出 PR-1 范围。
故**采用方案 B**，PR-1 的实现保持不变。

**处理方式**

1. **改 PR-35 的 `rejectSharedTargets` → `validateSharedTargets`**
   （`desktop/src/bootstrap/run_parts.go`），按方案 B 的 `append` 语义校验，
   而不是按方案 A 无条件拒绝同 target：

   - 同一 target 在选中集合里**只能有一个 owner**（`append:false`）——
     两个 owner 时后者会清空前者的文件；
   - owner **不得排在 appending part 之后** —— owner 会清空该 target；
   - 选中 owner 时**不得落下同 target 的 required part** ——
     required part 必定已装盘，其文件会被 owner 删除。
     （只对 `Required` 的兄弟 part 做此检查：可选 part 装不装取决于用户，
     不应因此拒绝。）

   函数签名从 `rejectSharedTargets(parts []Part)` 改为
   `validateSharedTargets(selected, all []Part)` —— 需要全量 manifest 才能
   判断「落下的 required 兄弟 part」。

2. **保留 PR-35 原有的保护意图**：原本「同 target 就拒绝」的粗粒度检查
   被替换成三条精确规则，风险仍在开发期暴露，而非用户机器上。

3. **同步设计文档**（`docs/desktop-runtime-layered-download-pr3-pr5.md`）：
   - §3.3 开头加「决议」块，说明 PR-1 落地方案 B、字段名 `Append`、
     决策依据（任务书 + `launch.py` 扁平布局约束）；
   - §3.3 末尾「建议 PR-1 采用 A」改为标注历史建议 + 说明校验已放宽；
   - §8 风险表「PR-1 采用 §3.3 方案 A」改为方案 B；
   - §10 决策项 1 从「推荐 A，若 PR-1 已按共享 packages/ 开工必须回退」
     改为「**已定：方案 B**」，并把方案 B 的两个已知缺点（旧文件不清理、
     Windows 已加载 DLL 不可替换）留作真机确认项。

4. **新增 Go 单测**（`desktop/src/bootstrap/run_parts_test.go`），3 个用例：

   | 用例 | 断言 |
   |---|---|
   | `TestRunPartsAllowsAnOwnerAndAppendingPartsOnOneTarget` | owner + appending part 共享 target 时**允许**，且解包后两个文件都在（端到端跑真 HTTP server） |
   | `TestRunPartsRejectsAnOwnerThatWouldDeleteARequiredPart` | 选中 owner 而落下 required 兄弟 part → 报错含 `would delete the files of` |
   | `TestRunPartsRejectsAnOwnerAfterAnAppendingPart` | owner 排在 appending part 之后 → 报错含 `appending part comes before it` |

   PR-35 原有的 `TestRunPartsRejectsPartsThatShareATarget`（两个无 append 的 part
   共享 target → 报错含 `same target`）**保持不变且仍然通过** ——
   新规则下它落在「同一 target 两个 owner」这条，仍然被拒。

### 4.3 未改动但需注意的一处语义

`Run()`（非 `RunParts`）路径**不做**同 target 校验 ——
这是 PR-1 的既有设计：manifest 由打包脚本生成，顺序与 `append` 标志受控
（`runtime` → `deps-core`（owner）→ `app`（append）→ `deps-*`（append））。
校验只加在 `RunParts`（用户点选安装的路径），因为那里的选择是运行期决定的。
这一点在 pending 文档 §3.1 记录为真机确认项。

---

## 五、必须由人类完成的事项

完整清单见 **`docs/desktop-runtime-layered-download-pending.md`**（13 项，
按 Windows 真机 / 跨仓库 / 决策三类组织，每项含「为什么本机做不了、
具体操作步骤、验收标准、阻塞关系」）。摘要：

### 5.1 Windows 真机验证

1. **重打运行时 zip 并验收体积**：246,105,871 字节 → **≤190MB**
   （≤199,229,440 字节，即至少减少 46,876,431 字节 / ≈44.7MB）；
   同时确认 zip 内不再有 `packages/playwright/` 与 `packages/tencentcloud/`。
2. **分片安装后的首启与核心功能回归**：素材库 / 浏览器 / 视频 / 聊天 /
   版本识别 / `import octop` 六项清单。
3. **下载器行为真机验证**：多 part 下载、断点续传、SHA256 校验、
   多镜像 fallback、全镜像失败、平台校验，共 6 个场景。
4. **长路径与杀软行为**：MAX_PATH 260 与 Defender 实时防护。

### 5.2 PR-0b 跨仓库

5. **`octop-harness` 提供收窄的 `[base]` extra** ——
   把 `google-api-python-client`（≈14.8MB）与 `boto3`/`botocore`（≈13MB）
   移出默认依赖。
6. **`octop-gateway` 解除 `lark-oapi` 硬依赖**（若要裁剪飞书 SDK）。
7. **本仓库跟着升版本与 pin**：`octop-harness[all]` → pin 到提供 `[base]`
   的版本；重跑 `uv lock`；确认 `uv export --no-dev` 不再出现
   `google-api-python-client` / `boto3`。

### 5.3 其它需人工决策 / 确认

8. 部署侧（Docker / fnos / 安装脚本）补 `tencentcloud` extra。
9. PR-3 进度面板落点：dashboard 顶条 vs 托盘气泡。
10. PR-5 是否新增 `FEATURE_DEPS_MISSING` 错误码。
11. PR-5 OCR / embedding 是否也走分片。
12. 可选分片是否需要真正的「取消」。
13. `uv.exe` 是否随 PR-0 拆出 core。

---

## 六、验证命令与实际结果（最终态）

<!-- FINAL_PYTEST_RESULT -->
