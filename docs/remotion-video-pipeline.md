# 视频生成流水线（Octop + Remotion）

服务器上的 Octop 负责**理解需求、产出视频脚本**；本机负责**渲染成片**。
本机不需要被外网访问——同步器只做出站请求。

## 全景

```
用户 ──对话──▶ 服务器 Octop（LLM 走 new-api）
                    │  1. 读工作区里的描述与素材
                    │  2. 写 render-jobs/<job>/script.json + assets/
                    ▼
              服务器 workspace
                    │  3. 同步器拉取（GET tree/download）
                    ▼
                本机 work/<job>/project/
                    │  4. Remotion 渲染（本地 Chromium + ffmpeg）
                    ▼
                本机 out/final.mp4
                    │  5. 回传（POST upload）
                    ▼
              服务器 render-jobs/<job>/final.mp4
                    │  6. agent 读取并交付给用户
                    ▼
                   用户
```

## 组件与代码位置

| 组件 | 位置 | 说明 |
|------|------|------|
| 服务器端 skill | `skills/remotion-video/SKILL.md` | 告诉模型怎么产出 `script.json` 与素材目录 |
| 脚本契约 | `skills/remotion-video/references/script-schema.md` | 字段、场景类型、时间轴规则 |
| 本机 Remotion 工程 | `remotion/src/` | Composition + 六种场景组件（`title`/`bullets`/`image`/`video`/`text`/`endcard`） |
| 本机渲染器 | `remotion/render.mjs` | `script.json` + `assets/` → mp4 |
| 本机同步器 | `remotion/sync.mjs` | 轮询 → 下载 → 渲染 → 回传 |

## 服务器侧部署

1. 把 skill 放进目标 agent 的工作区：

   ```bash
   # 工作区路径见 Dashboard → 专家 → 高级设置 → 工作区目录
   cp -r skills/remotion-video <workspace>/skills/
   ```

   或者用工作区文件接口上传（`PUT /api/agents/{agent_id}/workspace/file`）。

2. 在 Dashboard → 管理 → 模型 里把 new-api 配成 provider（协议 `openai`，
   地址 `https://<new-api>/v1`，密钥填 new-api 令牌），并给 agent 指定默认模型。

3. 确认 agent 处于**运行中**：workspace 的读写接口要求 agent 存活
   （`require_running_workspace`）。

4. 用户把素材（图片/基础视频/描述）放进 agent 工作区，或直接在对话里发。

## 本机侧部署

```bash
cd remotion
npm install
node render.mjs --project example --quality draft   # 首次会下载 Remotion Chromium
```

常驻同步：

```bash
node sync.mjs \
  --server https://ocbot.aixifs.com/videogen \
  --agent  <agent_id> \
  --token  <dashboard JWT> \
  --queue render-jobs \
  --interval 30
```

JWT 取自服务器 Dashboard 的 Local Storage `auth_token`（或服务器上
`octop user login` 生成的 `~/.octop/cli_state.json`）。

## 两种产出形态

| 形态 | 服务器产出 | 本机使用 | 适用 |
|------|-----------|---------|------|
| **数据形态（默认）** | `script.json` + `assets/` | 本机 `remotion/src/` 的组件 | 快、稳、风格统一；模型只填内容 |
| **工程形态（进阶）** | 完整 Remotion 工程（自带 `src/index.ts`） | 渲染器检测到 `<job>/src/index.ts` 就改用它打包 | 需要模型自定义视觉/组件 |

渲染器会自动判断：`<job>/src/index.ts` 存在就用它作为入口，`<job>/public/` 存在就作为
静态目录；否则用本机工程 + `<job>/assets/`。工程形态下依赖仍从本机 `node_modules`
解析（webpack `resolve.modules` 注入），所以不需要在服务器或本机重复安装依赖。

## 已知边界

- 同步器依赖 **agent 运行中**；服务器重启后 agent 需重新启用。
- 渲染是逐帧的，1080p 30fps 一分钟片子在本机通常要几分钟；先用 `--quality draft` 验脚本。
- 视频片段建议 h264 + yuv420p 的 mp4；其他编码需要先转码。
- 同步器不处理鉴权过期：JWT 失效后请求返回 401，需换新 token 重启同步器。
- 渲染卡在下载 Chromium、面板白屏、`X-Forwarded-For` 不生效等部署问题，见
  [deployment-pitfalls.md](deployment-pitfalls.md)。
