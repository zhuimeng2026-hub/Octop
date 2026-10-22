# Octop × Remotion 本机制作模板

该目录提供业务人员下载包使用的 Remotion 模板：`script.json` 与素材保存在包根目录，`renderer/` 内程序负责校验、Studio 预览与 MP4 渲染。

本地开发可运行：

```bash
npm ci
node --test test/*.test.mjs
node render.mjs --project example --quality draft
```

制作包结构、校验合同和 Windows/macOS 双击启动方式见 [`../docs/local-studio-package.md`](../docs/local-studio-package.md)。包启动不需要云端 token 或本机同步服务。`sync.mjs` 是旧的手动同步工具，不属于制作包工作流。
