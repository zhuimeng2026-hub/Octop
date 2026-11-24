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
| 其它名字里含 token/secret/password/key 的列 | 置空 | 兜底 |

**行数刻意保留**：只有 schema 没有数据的夹具，测不出分页、计数、外键这些真实行为。

### 脱敏后的验证

用原始快照里的真实值逐条反查夹具，**未发现任何残留**
（`secrets.v` / `users.username` / `users.password_hash` /
`sessions.session_key` / `thread_messages.message_json` 全查）。

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

### 使用约束

- **这是样本，不是生产**。不要拿它当备份，也不要往里写生产数据。
- 夹具里的 `jwt` 密钥是假的，任何用它签发的 token 都不应在别处被信任。
- 如果测试需要改这个库，**复制一份再改**，别原地改（仓库里的是基线）。
