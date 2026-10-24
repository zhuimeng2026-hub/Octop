# Backend MVP v0.1 — 实施任务书（供低成本开发模型执行）

状态：**待实现**。本文件是设计与验收要求，**不代表功能已经开发或测试通过**。
目标分支：`fix/backend-mvp-v01-integration`。不得修改桌面 M1 分支，不得直接向 `main` 推送业务代码。

## 现状确认
- 现有 Web SSO 已支持 `wechat_open`：`src/octop/infra/auth/sso/providers/wechat_open.py`、`auth_oauth.py`、`SsoService`。基于现有 `/api/auth/oauth/start`、`/callback`、`/exchange`，**禁止重建平行微信鉴权体系**。
- 微信开放平台网站应用采用 `snsapi_login`、扫码授权、授权回调；需使用开放平台的网站应用 AppID，非公众号/小程序 AppID。微信凭据尚未提供，本阶段只做无密钥配置和模拟测试。
- 产品、素材、项目已经通过 `ProductLibraryService` / repo 的 `owner_id` 过滤；分镜草稿在 `OCTOP_HOME/product-library/video-drafts/<user_id>/<project_id>.json`。
- 分镜功能：`llm_video_planner.py`、`video_drafts.py`、`product_library.py`；已具备生成、编辑确认及导出初版。

## 任务 A：微信开放平台登录预留与安全复核
1. 复用既有 `wechat_open`，对 `/api/auth/oauth/status`、`/start`、`/callback`、`/exchange`、后台提供商配置进行定向复核；确认未配置时状态为不可用且不能绕过认证；登录失败返回受控错误。
2. 确认 state + 同站 Cookie 校验、短时一次性登录码兑换、防重放、账号绑定/解绑权限均沿用 SSO 服务，不信任前端提交的 openid/unionid/user_id。
3. Provider secret 后端加密存放且不回显，不在日志、响应及回调 URL 中暴露 token/secret；测试应使用 Mock 微信响应，**不得使用真实 AppSecret、二维码或实际用户资料**。
4. 增加/修补必要的 Provider 单元测试和 README 文档，提供管理员配置清单：开放平台网站应用 AppID/AppSecret、审核通过的域名、HTTPS callback URL；没有凭据的环境应保持该入口关闭。
5. 如果原有实现已满足，就**不要改动已稳定逻辑**；补最小缺失测试及说明即可。

## 任务 B：用户数据隔离加固（本轮核心）
1. 系统身份只从 `current_user` 验证后的 JWT 导出，项目和素材查找均执行 `owner_id = user.id`；客户端不得提供或覆盖 owner ID。
2. 对下列 API 增加跨用户定向测试：产品列表/更新/删除、素材上传/下载、项目生成、分镜生成、分镜获取、PUT 编辑与确认、制作包导出。用户 B 猜中 A 的 project_id/asset_id 也只能得到 404/权限错误，不应泄露资源存在性。
3. 针对磁盘草稿：检查 owner ID 与 project ID 的路径安全、非法路径字符、权限与原子写；确认保存前必须重校验脚本素材引用和媒体类型，导出时必须再查归属及重新校验。
4. 避免 TOCTOU：确认草稿与脚本保存采用不可意外覆盖的受控原子写，至少记录同一用户并发写入的限制；不得让用户通过伪造字段选择任意服务器文件。
5. ZIP 只能包含当前项目快照引用的素材，验证 SHA256，杜绝越权读取、ZIP slip、不可信本地路径；保持已发行的 ZIP 格式和 Remotion 模板向后兼容。
6. 单实例 MVP 可以暂用本地磁盘草稿，但应明确多个后台节点无法直接共享草稿，不能据此声称实现完整多租户存储。

## 任务 C：后台 MVP 最小集成验收
- 允许使用 Mock LLM 验证 `generate-storyboard → GET → PUT confirm → storyboard-package`，返回的 ZIP 中含 `script.json` 和 renderer 启动文件，能解析 manifest。
- API 验证覆盖：未登录 401、用户 B 读取 A 项目拒绝、无草稿 404、未确认不能导出 409、恶意素材引用 422。
- `wechat_open` 仅对配置有效的后台启用；未配置时不暴露可用登录入口。
- 不执行全量 `make test`、整个桌面安装包编译或支付模型调用。使用现有的 `tests/unit/**` 测试模式与 pytest fixtures，并执行 `python -m compileall`、格式检查、**本轮改动范围**的 pytest。
- 如果定向测试失败，低成本执行模型应自行修复同一分支并重试；切勿直接改 `main`。

## 修改范围与交付
优先仅改 `src/octop/infra/auth/sso/**`、`src/octop/api/routers/auth_oauth.py`、`src/octop/infra/product_library/**`、`src/octop/api/routers/product_library.py`、对应 `tests/unit/**` 和 `docs/**`。如无需迁移数据库不要新增 migration。
交付：带真实改动的 commits、定向测试命令与 PASS/FAIL 输出、修订文档、PR（base=main）。无真实平台凭据时明确标注微信真实扫码联调未验证。

## 合并门禁
1. 静态检查与定向测试 PASS；
2. 认证入口无安全绕过，跨用户读写/导出均被拦截；
3. Mock LLM 的 API→ZIP 闭环可运行；
4. GitHub PR 无冲突；
5. 由评估方复核后合并。**没有测试证据不得声称已达标。**

## 低成本模型执行提示
你是 Octop 的实施 Agent。读取本任务书以及上述现有模块。先列出已满足与缺失项，然后仅实现缺失项。优先最小补丁、复用已有 SSO/认证/Repo，不做界面和全量测试。提交到本分支并创建 PR，提供准确的测试输出与限制；禁止记录真实凭据。
