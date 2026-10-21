# 微信开放平台（网站应用）扫码登录

Octop 的 Dashboard 可以用**微信开放平台网站应用**的扫码登录代替账号密码登录：
浏览器打开微信官方的扫码页 → 用微信扫 → 授权后微信带 `code` 回调 Octop →
服务端换 `openid` → Octop 按 `openid` 找到或创建用户 → 正常签发 JWT。

参考实现：`/opt/WeChatBridge/server/internal/wechat/client.go`（同一套微信协议）。

## 前提：三套 AppID 别搞混

三个后台的 AppID 都是 `wx` 开头，长得一模一样，填错时**报错发生在浏览器那一步**，
不是填表单的时候：

| 体系 | 后台 | 能否用于本功能 | OAuth 端点 | scope |
|------|------|----------------|-----------|-------|
| 小程序 | `mp.weixin.qq.com` | ❌ | — | — |
| 公众号 / 服务号 | `mp.weixin.qq.com` | ❌ | `/connect/oauth2/authorize` | `snsapi_base` / `snsapi_userinfo` |
| **开放平台 网站应用** | `open.weixin.qq.com` | ✅ | `/connect/qrconnect` | `snsapi_login`（唯一） |

拿小程序或公众号的 AppID 去调 `qrconnect`，微信回
**errcode 10005「Scope 参数错误或没有 Scope 权限」**——因为 `snsapi_login`
只属于开放平台网站应用。

## 配置

1. 开放平台（`open.weixin.qq.com`）建**网站应用**，拿到 AppID / AppSecret。
2. 在「网站应用 → 授权回调域」填**域名**（不含协议、不含路径、不含端口），
   例如 `ocbot.aixifs.com`。Octop 实际回调的完整 URL 是
   `https://<域名>/<base_path>/api/auth/oauth/callback`，路径不用登记。
   微信只校验域名，所以 Octop 挂在子路径下（`OCTOP_BASE_PATH=/videogen`）不影响。
3. Octop 后台 → 用户 → SSO → **微信开放平台**，填 AppID / AppSecret，启用。
   或直接调 API：

   ```bash
   curl -X PUT https://host/api/auth/oauth/providers/wechat_open \
     -H "Authorization: Bearer <admin token>" \
     -H 'Content-Type: application/json' \
     -d '{"enabled":true,"display_name":"微信","client_id":"wx...","client_secret":"..."}'
   ```

4. 「测试连接」会拿 AppID/AppSecret 打一次 token 端点（用一个不可能存在的 code）：
   凭据正确时微信回 `errcode 40029 invalid code`，凭据错误时回
   `40013 invalid appid` / `40125 invalid appsecret`——**凭据正确才是 40029**。

## 实现要点（改代码前先读）

- **`scope` 固定 `snsapi_login`**，由协议规定，不能换成 `snsapi_userinfo`。
- **`#wechat_redirect` 片段必须有**。少了它微信渲染**白屏**而不是报错，症状是
  「扫了码没反应」。
- **只认 body 里的 `errcode`**，不看 HTTP 状态码。微信大量错误是 `200` + errcode。
- **用户资料取不到不算失败**。`/sns/userinfo` 经常被限流或回 `48001`，此时昵称头像
  为空，但登录照常成立——权限永远只认已验证的 `openid`。
- **AppSecret 在 query string 里**，所以错误信息不能回显请求 URL
  （httpx 的错误消息里带 URL）。本适配器只回错误类别，不回 URL。
- **code 一次性、约 5 分钟过期**，失败不能重试。
- **身份用 `openid`**，不是 `unionid`。`unionid` 只有在开放平台账号下绑定了公众号 /
  小程序时才有；`openid` 是网站应用内的唯一标识，也是权限依据。
- 自己渲染 qrconnect URL 的二维码**不能完成登录**：真正可扫的码
  （`open.weixin.qq.com/connect/qrcode/<uuid>`）嵌在微信官方页面的 HTML 里，
  只有真浏览器加载那个页面才有。本功能走官方页面，不自绘二维码。

## 排错

| 现象 | 原因 |
|------|------|
| 扫码页白屏 | 少了 `#wechat_redirect` |
| `errcode 10005` | AppID 不属于开放平台网站应用（用了小程序/公众号的 AppID） |
| `errcode 40013` / `40125` | AppID / AppSecret 填错或不是同一应用的 |
| `errcode 40029` | code 过期（约 5 分钟）或已用过；重走一次扫码流程 |
| 回调后报 `state` 错误 | 登录态 cookie 丢了（跨站或被中间层剥掉），或超过 10 分钟有效期 |
| 回调 404 | Octop 的 `base_path` 与反向代理转发方式不一致（见 `docs/deployment-pitfalls.md`） |
| 登录成功但没有昵称 | `/sns/userinfo` 被限流，登录本身是成功的 |
