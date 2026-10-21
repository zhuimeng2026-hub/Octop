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

**服务器不需要能连到本机**：同步器只做出站请求（拉目录树、下载任务、可选上传）。
本机拉不到任务时最常见的原因是服务器上那个 agent 没在运行——workspace 读写接口
要求 agent 存活。

### 成片的去向：自动切换

同步器默认 `--deliver auto`：本机渲染后**自动尝试回传**；回传失败（例如只读凭证、
权限不足）就留在本机，成片不会丢，也不需要人工改参数。

| 模式 | 行为 | token 权限 |
|------|------|-----------|
| `auto`（默认） | 能回传就回传，不能就留本机 | 只读即可 |
| `server` | 一定回传，失败则该任务报错 | 读 + 写 |
| `local` | 只留本机 `remotion/work/<job>/project/out/final.mp4` | 只读 |

**单个任务可以自己决定去向**（优先级高于上面的默认值）：

- `script.json` 顶层的 `"deliver": "server" | "local"`
- 或任务目录里的 `deliver` 文件（内容 `server` / `local`）

因此「界面上自动切换」是这样实现的：用户在对话里说「成片发我 / 在对话里给我看」，
服务器上的模型在 `script.json` 里写 `"deliver": "server"`；本机下一轮轮询就把成片
传回服务器 workspace，agent 随后用 `send_file` 发到对话里。说「留在本机就行」则
写 `"deliver": "local"`。

## 两种产出形态

| 形态 | 服务器产出 | 本机使用 | 适用 |
|------|-----------|---------|------|
| **数据形态（默认）** | `script.json` + `assets/` | 本机 `remotion/src/` 的组件 | 快、稳、风格统一；模型只填内容 |
| **工程形态（进阶）** | 完整 Remotion 工程（自带 `src/index.ts`） | 渲染器检测到 `<job>/src/index.ts` 就改用它打包 | 需要模型自定义视觉/组件 |

渲染器会自动判断：`<job>/src/index.ts` 存在就用它作为入口，`<job>/public/` 存在就作为
静态目录；否则用本机工程 + `<job>/assets/`。工程形态下依赖仍从本机 `node_modules`
解析（webpack `resolve.modules` 注入），所以不需要在服务器或本机重复安装依赖。

## 为什么成片去向由系统自动决定

早期设计是「本地模式 / 回传模式」两个开关，靠人改命令行参数切换。实际用起来这个
设计有几个具体问题：

1. **人要在两个界面之间来回**。开关在本机终端，目标在服务器对话里；改完还得记得
   改回去，忘一次就整条链路对不上。
2. **漏回传等于白渲染**。本机渲染一条 1080p 片子要几分钟，渲染完却因为没开开关
   而只静静躺在本机，服务器那边完全不知情。
3. **凭证权限是会变的**。token 过期、换成一个只读凭证，都会让「能不能回传」变成
   一个需要人判断的前置条件；而不该由人来兜底这件事。
4. **需求是逐条变化的**。同一个 agent，这一条要发回对话、下一条只留本机，是常态。

所以改成：**发布是渲染的副作用，不是人下的指令**。

| 层次 | 谁决定 | 怎么表达 |
|------|--------|---------|
| 默认行为 | 同步器 | `auto`：渲染完自动尝试回传；回传失败（403/401）就留在本机，成片不丢、任务不报错 |
| 单条任务 | 服务器上的模型 | `script.json` 顶层的 `"deliver": "server" \| "local"`（用户在对话里一句话就能改） |
| 全局兜底 | 运维 | `--deliver server/local` 覆盖默认（`--no-upload` 是 `local` 的别名） |

这样「界面自动切换」的完整链路是：

```
用户在服务器对话里说「成片发我」
   → 模型写 script.json 时带上 "deliver": "server"
   → 本机下一轮轮询读到该指令 → 渲染 → 回传 render-jobs/<job>/final.mp4
   → 服务器上的 agent 读回成片 → send_file 发到对话里
```

用户改口说「这条留本机」→ 模型把 `deliver` 改成 `local` → 本机下次轮询就不再
回传。**两边都不需要人手动改参数。**

> 注意 `deliver` 只影响「成片去哪」，不影响渲染本身；渲染永远在本机发生。

## 已知边界

- 同步器依赖 **agent 运行中**；服务器重启后 agent 需重新启用。
- 渲染是逐帧的，1080p 30fps 一分钟片子在本机通常要几分钟；先用 `--quality draft` 验脚本。
- 视频片段建议 h264 + yuv420p 的 mp4；其他编码需要先转码。
- 同步器不处理鉴权过期：JWT 失效后请求返回 401，需换新 token 重启同步器。
- 渲染卡在下载 Chromium、面板白屏、`X-Forwarded-For` 不生效等部署问题，见
  [deployment-pitfalls.md](deployment-pitfalls.md)。
