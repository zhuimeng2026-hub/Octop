# Git 凭据管理（多远端 / 共享 store）

本仓库有 4 个远端，其中 3 个走 https，靠 `~/.git-credentials` 兜底：

| remote | 地址 | 认证方式 |
|---|---|---|
| `origin` | `git@github.com:zhuimeng2026-hub/Octop.git` | SSH（`~/.ssh`），不碰 credential store |
| `gitee-server` | `https://gitee.com/webheat/octop.git` | 公开仓库，拉取匿名可读 |
| `gitee` | `https://gitee.com/webheat/octop_client.git` | **path 级**条目（客户端发布仓专用 token） |
| `cnb` | `https://cnb.cool/mengxa.com/Octop.git` | **path 级**条目（CNB Octop 专用 token） |

---

## 一、两个必须记住的机制

### 1. `credential.useHttpPath` 是「换一套匹配规则」，不是「打开就更好」

| 取值 | 匹配范围 | 后果 |
|---|---|---|
| `false`（全局默认） | 只匹配 **host 级**条目（URL 里不带 path 的） | 同 host 多 token 时会拿错；path 级条目一条都不生效 |
| `true` | 只匹配 **path 级**条目，且 path 必须**完全一致**（不带 `.git` 后缀也不匹配） | host 级条目全部失效 |

**全局保持 `false`**（`restore-git-creds.sh` 每次都会复位），**本仓库 `.git/config` 里单独设 `true`**：

```bash
git config --local credential.useHttpPath true
```

这样 `gitee` / `cnb` 两个远端能用各自的 path 级专用 token，其它项目不受影响。

### 2. git 会改写 `~/.git-credentials`，共享 store 会被「折叠」

credential-store helper 在用掉一条凭据后会把它重写回文件。如果这次查找走的是
host 级匹配（`useHttpPath=false`），被折叠的 path 级条目会**连同同 host 的另一条
path 级条目一起消失**。

2026-11-21 实测：本机 store 从 11 条掉到 9 条，`cnb.cool/mengxa.com/Octop.git`
直接消失。此后 `git fetch cnb` 报的是

```
fatal: could not read Username for 'https://cnb.cool/mengxa.com/Octop.git'
```

—— 看不出是凭据问题，很容易误判成「仓库没了」。

**两条硬规矩**：

1. 验证凭据一律跑在**隔离 store** 上（`restore-git-creds.sh --check` 已内置）；
2. 不要用 `useHttpPath=false` 对 `cnb.cool` / `gitee.com` 跑 `git ls-remote`。

---

## 二、体检 + 自愈

```bash
bash scripts/check_git_credentials.sh            # 检查，缺了就修
bash scripts/check_git_credentials.sh --no-fix   # 只检查不修
```

做三件事：

1. 查真实 store 里 path 级 / host 级条目在不在、权限是不是 600；
2. 用**隔离副本**跑 `ls-remote` 验三个 https 远端真的能通（真实 store 不参与，不受改写影响）；
3. 有问题 → 调 `/opt/envctl/credentials/restore-git-creds.sh` 重写 store，
   并复位仓库级 `credential.useHttpPath=true`。

退出码：`0` 正常 / `1` 原本有问题、已修复 / `2` 仍有问题（需人工）。

**定时**：系统 crond 每天 `03:10` 跑一次，日志在 `scripts/logs/git-credentials-check.log`。

```cron
10 3 * * * /opt/Octop/scripts/check_git_credentials.sh >> /opt/Octop/scripts/logs/git-credentials-check.log 2>&1
```

想停：`crontab -e` 删掉那一行。

---

## 三、手动修复

```bash
bash /opt/envctl/credentials/restore-git-creds.sh --check   # 只验证，不写
bash /opt/envctl/credentials/restore-git-creds.sh           # 写入并验证
```

写完确认权限 600、条目数 11。脚本每次都会把全局
`credential.useHttpPath` 复位成 `false`（本仓库的 `.git/config` 里那条 `true` 不受影响）。

需要 path 级专用 token 的一次性命令：

```bash
git -c credential.useHttpPath=true push https://github.com/zhuimeng2026-hub/Octop.git
```

---

## 四、别把 token 写进 remote URL

remote URL 一律脱敏成 `https://host/path`，凭据全靠 store 兜底。
需要「不带 flag 就能 fetch」时，改的是 **remote URL 之外的配置**
（`credential.useHttpPath`），不是往 URL 里塞 token。

例外：`gitee.com/webheat/octop` 是公开仓库，`git fetch gitee-server` 匿名即可，
不依赖 store。
