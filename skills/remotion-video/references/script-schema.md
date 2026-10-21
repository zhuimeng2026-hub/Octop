# script.json 字段说明

渲染器（`remotion/src/types.ts`）只认这一个文件。模型产出它，本机渲染器照它出片。

## 顶层字段

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `title` | string | 必填 | 视频标题 |
| `fps` | int | `30` | 帧率。24 更电影感，30 更通用 |
| `width` | int | `1920` | 画面宽 |
| `height` | int | `1080` | 画面高 |
| `theme` | object | 见下 | 配色与字体 |
| `scenes` | array | 必填 | 场景列表，顺序即时间轴 |
| `deliver` | string | 省略 | 成片去向：`server` 回传服务器 / `local` 只留本机 / 省略=自动（能回传就回传，否则留本机） |

## theme

| 字段 | 默认 | 说明 |
|------|------|------|
| `bg` | `#0F1117` | 全片背景色 |
| `primary` | `#58C4DD` | 标题、强调（青） |
| `secondary` | `#83C167` | 副标题、说明（绿） |
| `accent` | `#FFD93D` | 装饰条、要点标记（黄） |
| `fontFamily` | `Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif` | 字体栈，含中文回退 |

## scene

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 场景内唯一；建议 `s1`、`s2`… |
| `type` | enum | 是 | 见下表 |
| `duration` | number | 是 | **秒**，必须 > 0，可带小数 |
| `text` | string | 视类型 | 主文案 |
| `subtitle` | string | 否 | 副文案 |
| `bullets` | string[] | 否 | 要点列表（`bullets` 类型用） |
| `asset` | string | 视类型 | `assets/` 下的文件名 |
| `caption` | string | 否 | 画面下方的说明（图片/视频场景） |
| `bg` | string | 否 | 覆盖该场景背景色 |
| `transition` | number | 否 | 淡入淡出秒数，默认 `0.4` |

## 场景类型

| `type` | 用途 | 用到的字段 | 视觉 |
|-------|------|-----------|------|
| `title` | 封面 / 章节标题 | `text` `subtitle` | 大字居中 + 装饰条 |
| `bullets` | 要点罗列 | `text` `bullets` | 标题 + 带标记的列表，左对齐 |
| `image` | 全屏图片 | `asset` `caption` | 图片 contain + 说明 |
| `video` | 基础视频片段 | `asset` `caption` | 视频 contain（黑底）+ 说明 |
| `text` | 段落解说 | `text` `subtitle` | 左对齐大段文字 |
| `endcard` | 结尾卡 | `text` `subtitle` | 居中大字 |

## 时间轴

场景按 `scenes` 数组顺序依次排布，第 N 个场景的起始时间 = 前面所有场景 `duration` 之和。

```
总时长 = Σ scene.duration          （秒）
总帧数 = round(总时长 × fps)
```

每个场景独立淡入淡出（`transition` 秒），所以相邻场景之间是柔和过渡而不是硬切。

## 校验规则（渲染器会直接报错）

1. 顶层必须是 JSON 对象。
2. `scenes` 必须是非空数组。
3. 每个 scene 必须是对象，含 `type` 与 `duration > 0`。
4. 每个带 `asset` 的场景，`assets/<asset>` 必须真实存在，否则报 `missing asset file(s)`。

## 素材约束

- `assets/` 下的文件必须是同步器能下载到的普通文件（png/jpg/webp/mp4/mov…）。
- 视频片段建议用 h264 + yuv420p 的 mp4；其他编码本机可能需要 ffmpeg 转码。
- 图片建议长边 ≥ 1920，或接受 contain 留边。
- **不要**写工作区之外的绝对路径——同步器只搬运任务目录里的文件。
