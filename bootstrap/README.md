# Octop 下载引导器

极轻量的**图形化下载引导器**：本体只有几十 KB，不含 Python 运行时和应用包。
用户双击后打开一个窗口，按 5 个步骤把基础环境、应用和可选组件分步下载到本地，最后自动拉起服务并打开浏览器。

## 文件

| 文件 | 作用 |
|------|------|
| `Octop-Bootstrap.cmd` | Windows 双击入口（调用 PowerShell，绕过执行策略） |
| `Octop-Bootstrap.ps1` | Windows 图形界面（WinForms）与分步下载逻辑 |
| `bootstrap.sh` | macOS / Linux：有 `zenity` 时显示图形进度条，否则终端输出 |
| `bootstrap.conf` | 版本、镜像、端口等配置（三个平台共用） |

## 分步下载流程

| 步骤 | 内容 |
|------|------|
| 1 | 基础工具 `uv`（已安装则复用）→ 下载失败自动切换镜像源 |
| 2 | `uv venv --python 3.12` → 拉取 CPython 运行环境 |
| 3 | Octop 主程序与依赖：优先使用本地构建产物 `payload/*.whl` 或 `../dist/*.whl`，否则从 PyPI 下载 |
| 4 | 可选组件 Playwright Chromium（勾选 / `--browser` 才下载） |
| 5 | 后台 `octop run`，探测 `8088` 端口就绪后自动打开浏览器 |

## 使用

Windows：

```
Octop-Bootstrap.cmd                      # 双击即可
Octop-Bootstrap.cmd -Mirror              # 国内镜像加速
Octop-Bootstrap.cmd -WithBrowser         # 同时下载浏览器组件
powershell -File Octop-Bootstrap.ps1 -NoGui -InstallDir D:\octop
powershell -File Octop-Bootstrap.ps1 -Plan
```

macOS / Linux：

```bash
bash bootstrap.sh                 # 图形界面（zenity 可用时）
bash bootstrap.sh --no-gui --mirror --browser
bash bootstrap.sh --plan
```

打包与配置：

```bash
make bootstrap                                        # dist/Octop-bootstrap-<ver>.zip
uv run python scripts/build_bootstrap.py --with-wheel  # 同时内嵌 dist/octop-*.whl
```

## 与仓库其它安装方式的关系

- `scripts/install.*`：面向熟悉命令行的用户，一次性装完。
- `desktop/portable`：把完整运行时打进便携包 / 桌面安装包（体积大）。
- 本引导器：**只带一个界面和一份配置**，所有内容按需分步下载；若旁边已有构建产物（`../dist/*.whl`），则直接复用该产物离线安装。
