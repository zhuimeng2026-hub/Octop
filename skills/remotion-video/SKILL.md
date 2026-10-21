---
name: remotion-video
description: "把素材与描述变成视频脚本（script.json + 素材），交给本机 Remotion 渲染成片。适用于「做一条视频」「把这个做成视频」「生成视频脚本并渲染」类需求。"
version: 1.0.0
compatibility: linux, macos, windows
metadata:
  octop:
    label:
      zh: "Remotion 视频"
      en: "Remotion Video"
    summary:
      zh: "产出结构化视频脚本与素材，由本机 Remotion 环境渲染成片。"
      en: "Produce a structured video script + assets, rendered to mp4 by the local Remotion install."
  harness:
    emoji: "🎬"
---

# Remotion 视频脚本流程#

本技能只负责**前半段**：读素材 → 产出 `script.json` + 素材目录。**渲染发生在用户本机**（那里有 Remotion 环境和素材文件），本机上的同步器会自动取走本目录下的任务并渲染。

## 何时使用#

当用户要求「做一条视频 / 把这些素材做成视频 / 生成视频脚本 / 渲染成片」时使用。用户通常会把图片、视频片段、文字说明放进工作区目录，并在对话里给出视频描述。

## 工具#

| 概念 | 工具 |
|------|------|
| Shell | `execute` |
| 读/写/编辑文件 | `read_file`, `write_file`, `edit_file` |
| 查找文件 | `glob`, `grep` |
| 取回 URL | `web_fetch` |
| 子代理 | `task` |

## 分工边界（重要）#

| 谁 | 做什么 |
|----|--------|
| **你（模型）** | 读素材与描述 → 写 `render-jobs/<job_id>/script.json` → 复制素材到 `render-jobs/<job_id>/assets/` → 告诉用户任务已就绪 |
| **用户本机的同步器** | 拉取任务 → 用本机 Remotion 渲染 → 把 `final.mp4` 传回同一目录 |
| **用户本机的 Remotion** | 渲染（你不执行渲染命令） |

**不要**在本机（服务器）上尝试执行 `npx remotion render` —— 服务器上没有素材，也没有 Remotion 环境。

## 目录约定#

所有任务都放在工作区的 `render-jobs/` 下，一个任务一个目录：

```
render-jobs/
└── 20261021-1430-product-intro/
    ├── script.json          # 必须：视频脚本（唯一契约）
    ├── assets/              # 可选：图片 / 基础视频
    │   ├── cover.png
    │   └── clip.mp4
    └── brief.md             # 可选：原始描述留档
```

- 任务目录名：`YYYYMMDD-HHMM-<英文短横线 slug>`，例如 `20261021-1430-product-intro`。
- `script.json` 里 `asset` 字段写的是 **`assets/` 下的文件名**（如 `cover.png`），不是完整路径。
- 素材必须是同步器能下载到的普通文件；不要引用工作区之外的绝对路径。

## script.json 契约#

完整字段说明见 `references/script-schema.md`。骨架：

```json
{
  "title": "视频标题",
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "theme": { "bg": "#0F1117", "primary": "#58C4DD", "secondary": "#83C167", "accent": "#FFD93D" },
  "scenes": [
    { "id": "s1", "type": "title", "duration": 3, "text": "标题", "subtitle": "副标题" },
    { "id": "s2", "type": "bullets", "duration": 6, "text": "要点", "bullets": ["第一条", "第二条"] },
    { "id": "s3", "type": "image", "duration": 4, "asset": "cover.png", "caption": "说明文字" },
    { "id": "s4", "type": "video", "duration": 6, "asset": "clip.mp4", "caption": "片段说明" },
    { "id": "s5", "type": "endcard", "duration": 2, "text": "完" }
  ]
}
```

`type` 可选值：`title` `bullets` `image` `video` `text` `endcard`。
`duration` 单位是**秒**，必须 > 0。

## 流程#

```
READ（读描述与素材） → PLAN（讲清叙事弧） → WRITE（写 script.json + 复制素材） → CHECK（自检） → REPORT
```

### 步骤 1：READ#

1. 用 `glob` 找到工作区里用户放进来的素材（图片、视频、markdown 描述）。
2. 用 `read_file` 读描述文件，弄清视频要讲什么、给谁看、什么调性。
3. 统计素材：有哪些图、哪些视频片段、各自适合放在哪一段。

### 步骤 2：PLAN#

先在心里（并在回复里）讲清楚**叙事弧**：开头抓人、中段推进、结尾收束。每个场景只干一件事。

### 步骤 3：WRITE#

1. 建目录：`execute` 运行 `mkdir -p render-jobs/<job_id>/assets`。
2. 写 `script.json`（`write_file`）。
3. 把要用的素材**复制**到 `render-jobs/<job_id>/assets/`（`execute` 用 `cp`；只复制脚本里真正引用到的文件）。
4. 把原始描述留档为 `render-jobs/<job_id>/brief.md`（可选，但便于回溯）。

### 步骤 4：CHECK#

写完必须自检（`read_file` 回读 `script.json`）：

- [ ] JSON 合法，每个 `scene` 都有 `id` / `type` / `duration`
- [ ] `duration` 都 > 0，总时长合理（通常 15–90 秒；太长会让本机渲染很久）
- [ ] 每个 `asset` 都能在 `assets/` 里找到对应文件
- [ ] 场景类型用对了：有要点用 `bullets`，有解说词用 `text`，别用 `text` 硬塞列表
- [ ] 字幕长度适合画面宽度（一行不超过约 20 个汉字）

### 步骤 5：REPORT#

告诉用户：任务目录名、成片预计时长、场景数量，并说明「本机同步器会取走渲染，渲染完成会把 `final.mp4` 放回同一目录」。

## 常见错误#

| 症状 | 原因 | 处理 |
|------|------|------|
| 本机渲染报 `missing asset file(s)` | `asset` 写的名字和 `assets/` 里的文件名不一致 | 用 `glob` 列一遍 `assets/`，逐字对齐 |
| 本机渲染报 `no positive duration` | 某个场景 `duration` 缺失或为 0 | 自检时逐个确认 |
| 成片很卡 | 总时长太长（渲染是逐帧的） | 缩短场景时长或减少场景数 |
| 文字被截断 | 单行文字太长 | 拆成 `bullets` 场景或缩短文案 |
| 任务没被取走 | 目录不在 `render-jobs/` 下，或缺 `script.json` | 确认路径与文件名 |

## 参考#

| 文件 | 内容 |
|------|------|
| `references/script-schema.md` | `script.json` 全部字段、场景类型、主题色、时间轴计算 |
