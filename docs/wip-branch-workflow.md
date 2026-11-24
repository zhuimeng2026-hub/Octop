# WIP 分支工作流（未提交改动的快照与重放）

> 状态：**活文档**（最近核实 2026-11-24）
> 文档类型：**规范性文档** —— 规定「线上 / 本机工作树停在半成品状态」时如何留档、如何重放、何时才能清理。
> 落点规则见 [docs/README.md §文档维护规范](./README.md) 第 7 条；分支与发布规则见 `AGENTS.md` §10。

---

## 1. WIP 分支是什么

WIP 分支**不是**功能分支，也**不是**发布分支。它是**一次未提交工作树的快照**，唯一用途是：

1. **不丢东西** —— 把「服务器 / 本机工作树停在某个功能分支的半成品状态」固定成一个可寻址的 commit；
2. **能重放** —— 后续**逐项**重放到 `develop`，而不是整体 merge，把在途快照的脏状态带进主干；
3. **可追溯** —— 线上部署跑的就是这个版本时，文档可以用它标记「当前线上代码版本」。

命名：`wip/<主题>` 或 `wip/<主题>-<YYYY-MM-DD>`，主题与对应 issue / 需求同名。

---

## 2. 何时建立

- 线上工作树有未提交改动，且短期内无法在功能分支上收尾；
- 需要把线上在途状态交给本地继续开发；
- 交接、迁移、换机器之前留底；
- 线上部署的代码与 `develop` 不一致，需要一个可引用的版本号。

**不适用**：功能开发本身请用 `feature/*`；已完成的分支清理请用 §5 的判据，不要随手删。

---

## 3. 建立方式（约定）

在**有未提交改动的工作树**上：

```bash
git switch -c wip/<主题>          # 或 git checkout -b wip/<主题>
git add -A
git commit -m "wip: <一句话说明这批在途改动是什么>"
```

提交信息**必须**写清三件事：

| 项 | 示例 |
|---|---|
| 来源 | 线上 `/opt/Octop` 工作树原停在 `feat/desktop-slim-installer @ bf5994a9` |
| 内容 | 包含 product library 目录批量导入、Windows 免安装 zip 与发布流程调整等 |
| 性质 | **仅作快照，后续需以 develop 为准**；未跑 pre-commit 之类也要写明 |

CRLF 需归一为 LF（遵守 `.gitattributes`）。

---

## 4. 重放规则

- WIP 分支**不整体 merge 进 `develop`**；按项拣选（cherry-pick 或手工重放）；
- 重放时**以 `develop` 为准**，冲突按 `develop` 的口径解决；
- 重放完成后，在 WIP 提交信息末尾追加一行「已重放：<commit / PR>」，便于判断清理时机；
- 迁移编号会随 `develop` 推进而变（例如快照里的 `027` 落地时已成 `028`），比对时要按**内容**而不是文件名判断。

---

## 5. 保留与清理判据

WIP 分支**可以删除**，当且仅当以下三条全部满足：

1. 快照里的每一项改动都已重放到 `develop`，或被明确放弃并在文档里记录；
2. 线上部署**已不再**运行该版本，且没有任何文档把它记为「当前线上代码版本」；
3. 相关文档已更新，不再引用该分支或该 SHA。

未满足时：**保留分支**，或改打一个长期 tag（如 `wip/<主题>-<日期>`）保留可追溯性 —— tag 不可变，比分支更适合当历史锚点。

### 怎么验证「已重放」

```bash
# 该分支相对 develop 独有的提交
git rev-list --count cnb/develop..wip/<主题>
# 按内容比对（+ = develop 里没有这份补丁）
git cherry cnb/develop wip/<主题>
# 逐个关键文件对比内容，而不是只看文件名
git diff cnb/develop wip/<主题> -- <path>
```

注意：`git cherry` 全是 `+` **不等于**工作丢失 —— 重放时往往伴随重编号、重构、拆分，patch-id 对不上；必须落到文件与功能层面逐项核对。

---

## 6. 与镜像链路（GitHub → CNB）的关系

镜像工作流（`.github/workflows/mirror-to-cnb.yml`）逐个推送 origin 的**全部分支与标签**，末尾再比对两侧 ref 是否一致。**只存在于 CNB 一侧的分支或标签会让校验步骤变红**：

```
::error::CNB 与 origin 的引用仍不一致，请人工介入
```

所以 WIP 分支二选一：

- 同步推一份到 origin（`git push origin wip/<主题>`），两侧 ref 自然一致；
- 或在校验里显式排除（如把 `refs/heads/wip/` 一并 `grep -v` 掉）。

无论哪种，都**不要**用 `--force` 推镜像，工作流策略是只做快进。

---

## 7. 当前登记

| 分支 | 快照提交 | 来源 | 状态 | 关联文档 |
|---|---|---|---|---|
| `wip/product-library-batch-import` | `ea0c24c5` | 线上 `/opt/Octop` 工作树（原停在 `feat/desktop-slim-installer @ bf5994a9`） | **保留** —— 内容已逐项重放到 `develop`（迁移 `027`→`028`、`analyse_import` / `commit_import_plan` 路由、vision 分组分类能力均已在 `develop` 且已继续演进），但线上仍以此版本为基准，且被文档引为「当前线上代码版本」 | [product-library-import-architecture.md §4.2](./product-library-import-architecture.md) |

---

## 8. 与其它文档的关系

- 分支与发布规则（`feature/*` → `develop` → `release/*` → `main`）：`AGENTS.md` §10
- 文档落点与状态词表：[docs/README.md §文档维护规范](./README.md)
- 需求条目自身待实施 → 需求文档的「实现状态」+ eval 任务 `status: planned`（见 [eval/README.md §3](./eval/README.md)）
- 工程待办登记 → [backlog.md](./backlog.md)
