# 本机 Remotion 制作包

下载 ZIP 后完整解压，双击根目录的 `preview.cmd`（Windows）或 `preview.command`（macOS），即可打开 Remotion Studio 预览。Studio 内可直接点 Render 输出 MP4；也可双击 `render.cmd` / `render.command` 批量渲染到 `out/final.mp4`。

首次运行需要 Node.js 22 或更新版本（包含 npm）以及网络访问 npm registry。启动器会在 ZIP 的 `renderer/` 内按锁文件执行一次 `npm ci`，之后复用已安装依赖。Remotion 首次渲染可能还需要下载 Chromium。包不需要 Octop token、登录信息或常驻同步进程。

## ZIP 内容合同

```text
script.json
assets/
manifest.json
preview.cmd
preview.command
render.cmd
render.command
README.txt
renderer/
  package.json
  package-lock.json
  remotion.config.ts
  tsconfig.json
  render.mjs
  launch.mjs
  project.mjs
  src/
```

`script.json` 与 `assets/` 是渲染数据；`renderer/` 是固定 Remotion 模板。资源引用只能使用 `assets/` 下的文件名，例如 `"asset": "cover.png"`。Studio 和标准渲染把 `assets/` 作为唯一 public directory，组件通过 `staticFile(scene.asset)` 读取素材；项目根目录中的脚本、清单和 renderer 安装文件不会进入 Remotion bundle。启动器校验脚本参数、场景类型、素材路径和完整性清单，校验通过后 Studio 与命令行渲染都读取 ZIP 根目录的同一份脚本和素材。

`manifest.json` 使用以下结构：

```json
{
  "schema": "octop-remotion-package/1",
  "template_version": "1",
  "project_id": "project-id",
  "script_sha256": "<script.json 的 SHA-256 hex>",
  "assets": [
    { "path": "assets/cover.png", "sha256": "<素材 SHA-256 hex>", "bytes": 12345 }
  ]
}
```

校验规则：`fps` 为 1–120 的整数，`width` 为 1–7680、`height` 为 1–4320 的整数（省略时使用 30/1920/1080）；`scenes` 至少一项，每项 duration 必须为正数，type 只能是 `title`、`bullets`、`image`、`video`、`text`、`endcard`。任何素材都必须是 basename、存在于 `assets/`，并在 manifest 中有匹配的字节数和 SHA-256。

## 启动参数

```sh
node renderer/launch.mjs --project .          # Studio 预览
node renderer/launch.mjs --project . --render  # 写入 out/final.mp4
node renderer/launch.mjs --project . --dry-run # 仅校验并打印计划
```

模板开发可用 `npm test` 运行启动器测试，`npm run render:draft -- --project <目录>` 生成低分辨率草稿。

从任意工作目录启动时，请传入解压后的项目根目录。Studio 使用绝对 Composition entrypoint、`--props=<临时 JSON 文件>`（形状为 `{ "script": ... }`）、`--public-dir=<项目根目录>/assets` 和 `--force-new`；临时 props 文件在 Studio 退出后删除。Studio 与导出因此使用同一脚本输入。

ZIP 生成方应从当前 `remotion/` 模板复制 `package.json`、`package-lock.json`、`remotion.config.ts`、`tsconfig.json`、`render.mjs`、`launch.mjs`、`project.mjs` 与 `src/` 到 `renderer/`，将本目录 `remotion/launchers/` 中的四个静态启动器放到 ZIP 根目录，并生成上面的清单。模板依赖通过 `npm ci` 固定；不得将服务端凭据或 token 写入 ZIP。

当前导出使用已有产品快照的模板编排结果。自动 LLM 文档解析及多轮脚本修改仍需独立接入；本改动负责制作包下载、本机预览与导出，不要求本地业务后端。
