# 测试夹具

## `octop-sample.db`

一份**脱敏后**的 Octop 数据库样本，用来给需要真实 schema 和真实行数的测试打底。

### 它从哪来

2026-11-24 从 `ocdev.aixifs.com`（生产实例，127.0.0.1:8088）用
`sqlite3 octop.db ".backup"` 导出的一致性快照。**没有停服务**，所以快照不含
WAL 撕裂，`PRAGMA integrity_check` 为 `ok`。

### 它被脱敏了什么

| 对象 | 处理 | 为什么 |
|---|---|---|
| `secrets` | **key 名保留**，value 全部替换为 `fixture-secret-value` | key 名是承重的：`SecretRepo.get("jwt")` 在 `api/deps.py`、`infra/server.py`、`infra/auth/mfa/` 里到处被调用，改名会让加载这个库的测试直接失败。但**签名密钥绝不能进仓库**。 |
| `users` | username / email / display_name / sso_subject 改写，password_hash 换成固定的假哈希 | 真实账号与口令哈希 |
| `sessions` | **整表清空** | session_key 是可直接使用的凭据 |
| `audit_log` | 保留行数，自由文本列置空 | 保留计数与分页行为，去掉操作记录 |
| `thread_messages` | 保留行数，`message_json` 换成固定内容 | 真实对话内容 |
| `sso_login_states` | 保留行数，`state`/`nonce`/`code_verifier`/`login_code` 全部替换，`user_id` 置空 | 这四个是一次性登录凭据：仓库里躺着一个 `login_code`，就等于躺着一个待完成的登录 |
| `user_sso_identities` | 保留行数，`subject` 逐行改写 | `subject` 是 provider 侧身份（微信 openid），指向一个真实的人 |
| `sso_providers` | 保留行数，`client_id`/`issuer`/`dashboard_origin` 改写，`client_secret_enc` 置空 | 真实 appid 与内网地址 |
| 其它名字里含 token/secret/password/key 的列 | 置空；**NOT NULL 的列改写成唯一占位值** | 兜底。NOT NULL 列写 NULL 会报错，而报错被吞掉时那条凭据就留在夹具里 |

**行数刻意保留**：只有 schema 没有数据的夹具，测不出分页、计数、外键这些真实行为。

### 脱敏后的验证

用原始快照里的真实值逐条反查夹具，**未发现任何残留**
（`secrets.v` / `users.username` / `users.password_hash` /
`sessions.session_key` / `thread_messages.message_json` 全查）。

2026-11-25 补做了一轮：反查发现 `sso_login_states` 的一次性登录凭据、
`user_sso_identities.subject` 的真实 openid、`sso_providers.client_id`
的 appid 都**没有被覆盖到**（列名里没有 token/secret/password 这些词），
脱敏脚本因此补了三条规则并重新生成了夹具。复扫结果：

- 凭据模式（`github_pat_` / `ghp_` / `cnb_` / `sk-` / JWT / 私钥头）→ 0
- 非 `example.invalid` 邮箱 → 0
- 上述 SSO 相关的 9 个原值 → 0

### 它不包含什么

生产目录里这些**没有**进夹具，因为它们是备份和缓存，与测试无关：

`dashboard-backups/`（306MB）、`product-library/`（56MB）、`agents/`（14MB）、
`logs/`（9.9MB）、`backups/`、`browser-profiles/`、`_junk_backup/`

生产目录 391MB → 夹具 880KB。

### 怎么重新生成

生产库会变，夹具不用每次都跟。确需重建时：

```bash
# 1. 在生产机上做一致性导出（不停服务）
ssh ocdev 'sqlite3 /opt/octop-data/octop.db ".backup /tmp/snap.db"'

# 2. 拉回本地并脱敏
scp ocdev:/tmp/snap.db /tmp/snap.db
python scripts/redact_octop_fixture.py /tmp/snap.db tests/fixtures/octop-sample.db
```

`scripts/redact_octop_fixture.py` 是脱敏脚本本身，随仓库走，便于审阅。

> 2026-11-25 那次补规则后重新生成夹具时，原始生产快照已经不在了，
> 做法是拿仓库里这份夹具当输入再跑一遍脚本——补上的三条规则作用在
> 当时**还没被覆盖**的字段上，所以结果与从生产快照重跑一致。
> 脚本本身是幂等的（重复跑不会二次破坏已脱敏的字段）。

### 使用约束

- **这是样本，不是生产**。不要拿它当备份，也不要往里写生产数据。
- 夹具里的 `jwt` 密钥是假的，任何用它签发的 token 都不应在别处被信任。
- 如果测试需要改这个库，**复制一份再改**，别原地改（仓库里的是基线）。
