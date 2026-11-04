# superagent 远程部署说明

本文说明 superagent（dsh-superagent）如何脱离开发机、在常开服务器上以 systemd 服务常驻，
以及运行和升级时必须遵守的约束。

按「概览 → 运行时约束 → 升级方式 → 排查入口」组织：前两节说清楚现在这台机器上是怎么跑的、
哪些写法不能碰；后两节是改完代码怎么上线、出问题先看哪里。

---

## 1. 概览

superagent 不是独立进程，而是 DeepSeek Harness（dsh）加载的一个 bundle 插件：它随 harness
进程一起启动、一起常驻、一起重启。

**部署形态**：常开服务器上的 systemd 单元 `dsh-superagent.service`。

```ini
[Service]
Type=simple
User=sa
WorkingDirectory=/home/sa
ExecStart=/home/sa/bin/dsh --profile superagent
Restart=on-failure
RestartSec=10
MemoryHigh=1400M
MemoryMax=2000M
```

开机自启（`WantedBy=multi-user.target`），异常退出 10 秒后拉起；内存设了上限，避免和同机的
其它服务抢内存。面板与管理 API 只监听 `127.0.0.1:3082`（端口写在 profile 的
`~/.dsh/profiles/superagent/cordis.patch.yml` 的 `webserver` 配置里），对外暴露靠反向代理。

**状态目录本身就是配置**。`stateDir=/home/sa/.dsh/state/superagent`，数据源（GitHub / Feishu /
CNB，按需启用）、策略规则、执行器设置（模型、并发数、工作目录、prepare 命令）以及各来源的轮询
游标，全部存在 `orchestrator.sqlite` 里：游标是 `cnb-cursor:*`、`github-cursor:*` 这些键，设置是
`settings-block-revision:source:*`、`settings-block-revision:policy`、
`settings-block-revision:executor` 这些键。面板上改的设置落的就是这张表，所以备份状态目录
等于备份全部配置与处理进度。

| 状态目录里的路径 | 内容 |
| --- | --- |
| `orchestrator.sqlite` | 数据源、策略、执行器设置、游标 |
| `work/` | 每个 Ticket 的工作目录 |
| `worker-bin/` | 命令 shim：`gh`、`lark-cli`、被禁命令 |
| `worker-gitconfig` | agent 专用 git 配置（凭据助手等），不写个人 git 设置 |
| `cnb-api.mjs` | CNB OpenAPI 调用脚本，每次启动重写 |

机器侧只有两处固定配置：profile 的 `~/.dsh/profiles/superagent/cordis.patch.yml`（`stateDir`、
端口等）和 `~/.dsh/profiles/superagent/package.json`（依赖写法，见第 2 节）。

---

## 2. 运行时约束

### 2.1 harness 必须运行构建产物，不能用 tsx 直接跑源码

服务入口 `/home/sa/bin/dsh` 执行的是 harness 工作区的构建产物：

```sh
exec /opt/node22/bin/node /home/sa/deepseek-harness/apps/cli/lib/bin.js "$@"
```

不能改成 `node --import tsx/esm apps/cli/src/bin.ts`（harness 仓库里的 `pnpm dsh`、
`pnpm start:web` 走的就是这条路，只适合开发）。

原因是同一个包会被加载两份：tsx 运行时按 tsconfig 的 `paths` 加载工作区源码，而插件解析到的
是同一个包的 `lib`。两份代码不是同一个模块实例，典型后果是 `@deepseek-ai/dsh-scope` 出现两个
`kScope` 符号，Session 绑定的作用域对插件不可见——表现为 worker 继承不到工具集，只剩插件
自带的几个工具。

所以升级 harness 时，先在 harness 工作区构建产物（`pnpm build`，输出在 `apps/cli/lib`），再
重启服务；不要用 tsx 临时跑源码代替。

### 2.2 插件的 `@deepseek-ai/*` peer 依赖必须 link 到 harness 工作区

`dsh-superagent` 有一批 `@deepseek-ai/*` peer 依赖（cordis、dsh-scope、dsh-session、dsh-tools
等）。它们必须和 harness 用同一份代码，所以 profile 的 `package.json` 里全部写成 `link:`，指向
harness 工作区里已经装好的位置：

```json
"@deepseek-ai/dsh-scope": "link:/home/sa/deepseek-harness/packages/goal/goal/node_modules/@deepseek-ai/dsh-scope"
```

装完之后，profile 的 `node_modules/@deepseek-ai/*` 应当都是指向 harness 工作区的符号链接。

不能保留 npm 下载的副本：副本是另一份代码，和 harness 里的那份不是同一个模块实例，理由与
2.1 相同——Session 继承不到工具集，worker 只剩插件自带的几个工具。

改完依赖，在 profile 目录里 `pnpm install`，然后重启服务。

---

## 3. 升级方式

### 3.1 插件是 `file:` 依赖，产物会被复制一份

profile 的 `package.json` 里插件是这样声明的：

```json
"dsh-superagent": "file:/home/sa/dsh-superagent-prototype"
```

pnpm 会按包自己的 `files` 字段把它打包，复制进 profile 的虚拟 store：

```
~/.dsh/profiles/superagent/node_modules/.pnpm/dsh-superagent@file+..+..+..+dsh-superagent-prototype_<hash>/node_modules/dsh-superagent/
```

运行时加载的是这份副本（`lib/`、`locale/`、`prompts/`、`cordis.patch.yml`）。因此只改原型目录
的 `src/`，或者只在原型目录里 `pnpm build`，都不会影响正在跑的服务——副本里的 `lib/` 还是旧的。

### 3.2 升级步骤

1. 备份状态目录的数据库（服务在跑，用 sqlite 的在线备份，别直接复制文件）：

   ```bash
   sqlite3 /home/sa/.dsh/state/superagent/orchestrator.sqlite \
     ".backup '/home/sa/.dsh/state/superagent/orchestrator.sqlite.bak'"
   ```

2. 在原型目录改代码并重新构建产物：

   ```bash
   cd /home/sa/dsh-superagent-prototype
   pnpm build            # tsdown，产物在 lib/
   ```

3. 把产物同步进 pnpm 那份副本，再重启服务：

   ```bash
   rsync -a --delete /home/sa/dsh-superagent-prototype/lib/ \
     /home/sa/.dsh/profiles/superagent/node_modules/dsh-superagent/lib/
   systemctl restart dsh-superagent      # 重启系统单元需要 root 权限
   ```

   `locale/`、`prompts/`、`cordis.patch.yml` 改了同样要同步过去。
   （在 profile 目录重跑 `pnpm install` 也会重新打包 `file:` 依赖、刷新副本，但前提是原型
   已经构建过；顺序不能反。）

4. 确认服务健康：`systemctl status dsh-superagent`，以及第 4 节的
   `GET /orchestrator/api/state`，其中 `runtime`、`launch`、`worker` 应为 `ready`。

### 3.3 harness 升级

harness 工作区在 `/home/sa/deepseek-harness`：先 `pnpm build`（产物在 `apps/cli/lib`），再重启
服务。插件的 peer 依赖是 `link:` 指向 harness 工作区的 `node_modules`，harness 换版本之后要在
profile 目录 `pnpm install` 重新对齐 link 目标。

---

## 4. 排查入口

### 4.1 管理 API

```bash
curl -s -H 'x-orchestrator-request: 1' http://127.0.0.1:3082/orchestrator/api/state
```

必须带 `x-orchestrator-request: 1`，且 Host 只能是 `127.0.0.1` 或 `localhost`，否则 403。

返回里最常用的是 `health`：每个部件一条（`runtime`、`models`、`evals`、`assessment`、`launch`、
`delivery`、`relay`、`notice`、`reply`、`worker`、`github`、`feishu`、`cnb`、`sync:<source id>`），
状态是 `starting` / `ready` / `paused` / `error`，带一句 `detail`。另外还有 `load`
（`running` / `queued` / `maxWorkers`）、`setup`（`problem`、`feishuProblem`、`cnbProblem` 与
`accounts`）、`paused` 和 `masterId`。

按症状定位：

| 症状 | 先看 |
| --- | --- |
| 服务起不来 | `journalctl -u dsh-superagent -n 200`，以及 `health.runtime` |
| worker 报工具缺失、只拿到插件自带的那几个工具 | `health.worker`，多半是第 2 节的依赖写法被改回去了 |
| 收不到新任务 | `health.github` / `health.cnb`（`paused` 且 `Off` 表示源没开）、`paused`、`load.queued` |
| 账号或凭据没配好 | `setup.problem` / `setup.cnbProblem` |

### 4.2 CNB 侧

状态目录下的 `cnb-api.mjs`（每次启动重写）可以直接调 CNB 的 OpenAPI，令牌从
`~/.git-credentials` 读，不会出现在命令行上：

```bash
export DSH_SUPERAGENT_CNB_REPOSITORY=mengxa.com/Octop
node /home/sa/.dsh/state/superagent/cnb-api.mjs GET issues/13
node /home/sa/.dsh/state/superagent/cnb-api.mjs GET pulls/12
```

请求实际打到 `https://api.cnb.cool/<org>/<repo>/-/<path>`。两个容易踩的点：

- **合并 PR 只能用 `PUT`**：合并接口是 `PUT pulls/<n>/merge`，请求体可带 `merge_style`
  （`merge` / `squash` / `rebase` / `fast_forward`）、`commit_title`、`commit_message`。
  用 `POST` 打同一个路径只会得到一个误导性的 404（接口不存在），看上去像是 PR 找不到。
- **关闭 Issue 要同时给 `state` 和 `state_reason`**：改状态的接口是 `PATCH issues/<n>`，
  请求体里的 `state`（`open` / `closed`）和 `state_reason`（`completed` / `not_planned` /
  `reopened`）要么都给、要么都不给，只给一个会返回参数错误。
