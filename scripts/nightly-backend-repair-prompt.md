# 交给 02:10 夜间智能体的指令（后端全量测试与最小修复）

> 这份指令对应 [../docs/backend-nightly-repair.md](../docs/backend-nightly-repair.md) §5。
> systemd 单元把它作为 `claude -p` 的输入；**手册是唯一权威**，本文件只是入口与
> 机械化基线轮的工具说明，两者冲突以手册为准。

```text
你负责 Octop 后端夜间全量测试与最小修复。

第一步：完整阅读 docs/backend-nightly-repair.md（全文，逐条读完），它是本轮的唯一
运行手册；本指令与手册冲突时以手册为准。下面只是手册 §5 的模板复述，不能替代手册。

时间：每天 02:10 Asia/Shanghai；同一任务互斥（不得并行启动第二个全量）。
基线：不要固定使用任何历史 SHA（如 89d6fbe8）；从 cnb/develop 读取本轮真实完整 SHA
作为 baseline_sha。
范围：仅服务端 Python。执行 uv sync --locked，然后在独立 checkout/worktree、独立
非 root 账号、HOME/OCTOP_HOME/数据库/pytest tmp 下运行
uv run --locked --no-sync pytest -m 'not live' -q。不要构建 dashboard/、不跑 Go/桌面
构建、不做真实外部调用与微信、不发布、不部署、不写生产 checkout/数据/服务设置。
基线轮可以直接用仓库里的机械执行器（它只做手册 §4.1–§4.2 与 §3 的证据绑定）：
    python3 scripts/run_backend_nightly_repair.py --report-dir <报告目录>
它会生成 run_id、克隆 cnb/develop 到独立 checkout、记录 baseline_sha、跑 uv sync
--locked 与基线全量，并写出 baseline.json / baseline.md 与产物 SHA256。归因、最小
修复、候选快照与结果卡由你按手册 §4.3–§4.5 完成，不要只交付基线轮。
先做 preflight 并保存路径、权限、依赖与 git 快照（手册 §4.1 第 2 步）。
基线失败先保存完整受限日志，再按 nodeid 归因；仅在同一基线可稳定定向复现的小范围
deterministic defect 可最小修改并写回归测试。环境/偶发/凭据/规格不明/迁移/权限/运行库
归属/需要扩大范围，一律记 blocked 或待人研判。不要 skip、xfail、删测试或盲改超时。
从记录的 baseline 建候选分支 codex/nightly-backend-<run_id> 与独立工作树，保存最终
全量前快照；无提交授权就生成包含新增文件的可审 diff/binary patch 与 patch SHA256，
不提交/推送/建 PR。候选在同一隔离条件跑一次最终全量；最终全量后任何文件变更都使
结果失效。若 cnb/develop 前进，状态写 blocked 并说明需 integrate/revalidate。
所有日志/报告/patch 进入带 run_id 的唯一目录，不从 latest 推断。报告必须包含
baseline/candidate 完整 SHA、pytest 根目录、隔离路径、命令、退出码、收集数、跳过原因
（既有条件跳过与新增跳过分开）、证据路径、SHA256、状态与未完成项，并按手册 §5.1 复制
结果卡模板填写，不得以空字段冒充证据。
截止窗口（建议 07:30）后不再启动新的验证并保留现场，不无条件中止已经运行的进程；
剩余窗口不足时报告 blocked 或未完成，不压缩步骤换取绿色。
无人时不改主干/生产设置、不删分支、不默认对外发消息、不部署。
```
