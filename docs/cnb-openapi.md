# CNB Open API 调用方法（api.cnb.cool）

在 cnb.cool 上做自动化操作（创建 Issue、评论、读取仓库信息等）时使用的 REST API 调用约定。本文记录实际验证过的调用方式与踩过的坑。

## 基本约定

| 项 | 值 |
|---|---|
| API 基地址 | `https://api.cnb.cool` |
| Web 基地址 | `https://cnb.cool`（**不提供 API**，未知 `/api/*` 路径会被前端 SPA 兜底为 200 的 "Page not found" HTML 页，极易误判） |
| 路径前缀 | **无版本前缀**。直接 `/user/...`、`/{repo}/-/{resource}`，不要加 `/v1` 或 `/api/v4`（加上后会 404） |
| Swagger | `https://api.cnb.cool/swagger.json`，交互式文档 `https://api.cnb.cool` |

## 鉴权

使用访问令牌（Access Token），通过请求头传递：

```
Authorization: Bearer <token>
accept: application/json
```

- 令牌申请：cnb.cool 个人设置 → 访问令牌；不同接口要求不同权限（如创建 Issue 需 `repo-issue:rw`）。
- 仓库 https git 凭据（`.git-credentials` 中 `https://<user>:<token>@cnb.cool/...`）里的令牌与 API 令牌是同一体系，可直接用于 API 鉴权。
- 未带鉴权访问受保护接口返回 `401 {"errcode":16,"errmsg":"...not logged in"}`；路径不存在返回 `404 {"errcode":5,"errmsg":"Resource not found."}`。注意：**先 401 后 404** —— 网关未认证时即使路径不存在也返回 401，容易误以为路径正确。

## Issue 接口

仓库标识格式：`组织/仓库名`（不带 `.git` 后缀），如 `mengxa.com/Octop`。

### 列取 Issue

```bash
curl -s \
  -H "accept: application/json" \
  -H "Authorization: Bearer <token>" \
  "https://api.cnb.cool/{repo}/-/issues?page=1&page_size=20"
```

### 创建 Issue

`POST /{repo}/-/issues`，需 `repo-issue:rw` 权限。请求体（JSON）常用字段：

| 字段 | 必填 | 说明 |
|---|---|---|
| `title` | 是 | 标题 |
| `body` | 否 | 正文，Markdown |
| `labels` | 否 | 标签数组，最多 10 个 |
| `assignees` | 否 | 处理人数组，最多 8 个 |
| `priority` | 否 | `-2P` / `-1P` / `P0` / `P1` / `P2` / `P3` |
| `start_date` / `end_date` | 否 | `YYYY-MM-DD` |
| `invisible` | 否 | 是否私密 issue |

```bash
curl -s -X POST \
  -H "accept: application/json" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  --data-binary "@issue.json" \
  "https://api.cnb.cool/{repo}/-/issues"
```

成功返回 `201` 与完整 issue 详情（含 `number`）。

完整端点列表见 swagger.json 中的 `/{repo}/-/issues*` 系列（评论、标签、处理人、附件上传等）。

### Web 页面路径（不是常规形状）

API 路径与网页路径**不一样**，写文档链接时别用 `cnb.cool/{org}/{repo}/...`：

| 目标 | 正确路径 |
|---|---|
| 仓库首页 | `https://cnb.cool/{org}/-/repos/{repo}` |
| Issue 列表 / 单条 | `https://cnb.cool/{org}/-/repos/{repo}/-/issues[/{number}]` |

例：`https://cnb.cool/mengxa.com/-/repos/Octop/-/issues/23`。
`cnb.cool/mengxa.com/Octop/...` 一律返回 404（不是 SPA 200），容易误判为「仓库不存在」。

### 读取仓库内容（核对镜像是否同步）

```
GET /{repo}/-/git/contents/{file_path}?ref={branch}
```

返回的 `content` 是 **base64**，要解码后再判断内容；不解析 base64 会误以为「文件里没有目标关键字」。

## 踩坑记录

0. **Actions 里的 `CNB_TOKEN` 可能过期，镜像会静默落后**。2026-11-24 实测：fork 的 GitHub Actions「Mirror to CNB」因 secret 里的令牌过期而失败（`remote: 您的访问凭证已经过期。` → HTTP 400），GitHub 上已推的提交**不会**自动到 cnb.cool；分支在 cnb 上停在旧 SHA。
   核查方法（对比两个远端的 ref）：
   ```bash
   git ls-remote --heads fork > /tmp/fork.txt
   git ls-remote --heads cnb  > /tmp/cnb.txt
   git ls-remote --tags fork > /tmp/fork_tags.txt
   git ls-remote --tags cnb  > /tmp/cnb_tags.txt
   diff /tmp/fork.txt /tmp/cnb.txt
   ```
   手工补推（只做快进，不带 `--force`，与工作流策略一致）：
   ```bash
   git push cnb <branch>
   git push cnb <tag-sha>:refs/tags/<tag>
   ```
   推送需要的是仓库**写**权限的令牌；本机 `.git-credentials` 里的凭据若仍有效，可直接用于 API 与 git 两种操作。
1. **不要加 `/v1` 前缀**。探测时容易从 `/v1/...` 的 401 误推断版本前缀存在；实际网关对未认证请求一律先回 401，与路径是否存在无关。判定「路径是否正确」必须携带有效 token 再看返回码。
2. **不要在 `cnb.cool` 主域上调 API**。主域是 Next.js 前端，所有未知路径（包括 `/api/*`）都返回 HTTP 200 的 SPA 404 页面，会掩盖真实错误。API 必须走 `api.cnb.cool`。
3. **请求体生成避开 PowerShell 5.1 的 `ConvertTo-Json`**：它生成的多行/中文载荷可能被服务端判为 `invalid post form body`（HTTP 400）。建议用 Python 生成：
   ```python
   import json
   payload = {"title": "...", "body": open("body.md", encoding="utf-8").read()}
   open("issue.json", "w", encoding="utf-8").write(json.dumps(payload, ensure_ascii=False))
   ```
   并用 `curl --data-binary "@issue.json"` 发送（UTF-8 无 BOM），不要用 `-d`（部分 curl 版本对 `@file` 会做 CRLF/编码处理）。
4. **`Accept` 头**：文档要求按接口 `produces` 设置（Issue 接口为 `application/vnd.cnb.api+json`，实测 `application/json` 也可）。
