#!/usr/bin/env bash
# 同步 GitHub (origin) → CNB (cnb)：全部分支 + 全���标签。
#
# 设计要点：
#   1. 独立运行，不依赖 Claude。同步与校验全部由本脚本完成；
#      只有在检测到异常时，才调用 claude 做初判，产出报告供人工介入。
#   2. 只做快进推送（不带 + / --force）。CNB 端若被直接改动导致分叉，
#      推送会被拒绝 → 记为异常 → 交由人工判断，不自动覆盖。
#   3. CNB 独有的分支（origin 上没有的）保留不动，只在报告里列出。
#
# 记录目录：<repo>/.git-sync/
#   latest-report.md        最新一次运行报告（成功/失败都写）
#   anomalies/<ts>.md       异常详情 + 大模型初判
#   cron.log                cron 的标准输出（由 cron 追加）
#
# 用法：
#   scripts/sync_github_to_cnb.sh              # 正常同步
#   REPO_DIR=/path/to/repo scripts/sync_github_to_cnb.sh
#
# 退出码：0 = 已对齐；1 = 有异常（已记录）；2 = 环境/网络错误

set -uo pipefail

REPO_DIR="${REPO_DIR:-/opt/Octop}"
ORIGIN_REMOTE="${ORIGIN_REMOTE:-origin}"
CNB_REMOTE="${CNB_REMOTE:-cnb}"
STATE_DIR="${STATE_DIR:-$REPO_DIR/.git-sync}"
ANOMALY_DIR="$STATE_DIR/anomalies"
REPORT="$STATE_DIR/latest-report.md"
LOCK_FILE="$STATE_DIR/sync.lock"
CLAUDE_BIN="${CLAUDE_BIN:-/root/.nvm/versions/node/v20.20.2/bin/claude}"
CLAUDE_TIMEOUT="${CLAUDE_TIMEOUT:-300}"
TRIAGE_MODEL="${TRIAGE_MODEL:-sonnet}"

mkdir -p "$STATE_DIR" "$ANOMALY_DIR"

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }

# 同一时刻只允许一个同步任务
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    log "已有同步任务在运行，本次跳过"
    exit 0
fi

cd "$REPO_DIR" || { log "无法进入仓库目录 $REPO_DIR"; exit 2; }

TS="$(date '+%Y%m%d-%H%M%S')"
ANOMALY_FILE="$ANOMALY_DIR/$TS.md"
: >"$ANOMALY_FILE"

ANOMALIES=()
NOTES=()

note() { NOTES+=("$1"); }
anomaly() { ANOMALIES+=("$1"); }

log "开始同步 origin → cnb（仓库 $REPO_DIR）"

# ---------- 1. 拉取 origin ----------
if ! FETCH_OUT="$(git fetch "$ORIGIN_REMOTE" --prune --tags 2>&1)"; then
    log "fetch 失败：$FETCH_OUT"
    anomaly "无法从 $ORIGIN_REMOTE 拉取：$(tail -n 3 <<<"$FETCH_OUT" | tr '\n' ' ')"
    FETCH_OK=0
else
    FETCH_OK=1
    note "fetch $ORIGIN_REMOTE 完成"
fi

# ---------- 2. 逐分支快进推送 ----------
# 以 ls-remote 取 GitHub 的权威 SHA，不用 refs/remotes/origin/*：
# origin 配了多个 push URL 时，git push 会更新远程追踪引用，哪怕只有其中一个
# pushurl 成功，追踪引用就可能指向"仅存在于另一端"的提交。
PUSH_FAILURES=()
if [ "$FETCH_OK" = "1" ]; then
    ORIGIN_HEADS="$(git ls-remote --heads "$ORIGIN_REMOTE" 2>/dev/null)"
    if [ -z "$ORIGIN_HEADS" ]; then
        anomaly "无法读取 $ORIGIN_REMOTE 的分支列表（凭据或网络问题）"
    fi
    while IFS=$'\t' read -r sha ref; do
        [ -z "${sha:-}" ] && continue
        branch="${ref#refs/heads/}"
        # fetch 与 ls-remote 之间存在竞态：分支可能刚被创建，本地还没有该对象。
        # 先确认对象在本地，缺失则按需抓取一次再推。
        if ! git cat-file -e "$sha^{commit}" 2>/dev/null; then
            git fetch --no-tags "$ORIGIN_REMOTE" "+$ref:refs/remotes/$ORIGIN_REMOTE/$branch" >/dev/null 2>&1 || true
        fi
        if ! git cat-file -e "$sha^{commit}" 2>/dev/null; then
            anomaly "分支 $branch 的提交 $sha 本地不存在（可能刚被创建），本次跳过，下轮重试"
            continue
        fi
        if OUT="$(git push "$CNB_REMOTE" "$sha:refs/heads/$branch" 2>&1)"; then
            log "  ✓ $branch"
        else
            log "  ✗ $branch"
            PUSH_FAILURES+=("$branch")
            anomaly "分支 $branch 推送失败：$(tr '\n' ' ' <<<"$OUT" | tail -c 400)"
        fi
    done <<<"$ORIGIN_HEADS"
fi

# ---------- 3. 推送标签 ----------
# 同样按 GitHub 上的权威 SHA 推送；附注标签只推标签对象本身，
# '^{}' 解引用项随标签本体一起生效，不单独推。
if [ "$FETCH_OK" = "1" ]; then
    while IFS=$'\t' read -r sha ref; do
        [ -z "${sha:-}" ] && continue
        case "$ref" in
            refs/tags/*'^{}') continue ;;
        esac
        tag="${ref#refs/tags/}"
        if ! git cat-file -e "$sha" 2>/dev/null; then
            git fetch --no-tags "$ORIGIN_REMOTE" "+$ref:refs/tags/$tag" >/dev/null 2>&1 || true
        fi
        if ! git cat-file -e "$sha" 2>/dev/null; then
            anomaly "标签 $tag 的对象 $sha 本地不存在（可能刚被创建），本次跳过，下轮重试"
            continue
        fi
        if ! TAG_OUT="$(git push "$CNB_REMOTE" "$sha:refs/tags/$tag" 2>&1)"; then
            anomaly "标签 $tag 推送失败：$(tr '\n' ' ' <<<"$TAG_OUT" | tail -c 400)"
        fi
    done <<<"$(git ls-remote --tags "$ORIGIN_REMOTE" 2>/dev/null)"
fi

# ---------- 4. 校验：远端逐 ref 比对 ----------
MISMATCH=""
CNB_ONLY=""
if [ "$FETCH_OK" = "1" ]; then
    ORIGIN_REFS="$(git ls-remote --heads --tags "$ORIGIN_REMOTE" 2>/dev/null)"
    CNB_REFS="$(git ls-remote --heads --tags "$CNB_REMOTE" 2>/dev/null)"
    if [ -z "$CNB_REFS" ]; then
        anomaly "无法读取 $CNB_REMOTE 的远端引用（凭据或网络问题）"
    else
        while IFS= read -r line; do
            [ -z "$line" ] && continue
            sha="${line%%[[:space:]]*}"
            ref="${line#*[[:space:]]}"
            ref="${ref#*	}"
            cnb_sha="$(awk -v r="$ref" '$2 == r {print $1}' <<<"$CNB_REFS")"
            if [ -z "$cnb_sha" ]; then
                MISMATCH="${MISMATCH}missing:${ref} "
            elif [ "$cnb_sha" != "$sha" ]; then
                MISMATCH="${MISMATCH}differs:${ref} "
            fi
        done <<<"$ORIGIN_REFS"
        # CNB 独有（origin 上没有）的分支：保留，仅记录
        while IFS= read -r line; do
            [ -z "$line" ] && continue
            ref="${line#*[[:space:]]}"
            ref="${ref#*	}"
            case "$ref" in refs/tags/*) continue ;; esac
            if ! grep -qF "$ref" <<<"$ORIGIN_REFS"; then
                CNB_ONLY="${CNB_ONLY}${ref#refs/heads/} "
            fi
        done <<<"$CNB_REFS"
    fi
fi

if [ -n "$MISMATCH" ]; then
    anomaly "同步后校验仍不一致：$MISMATCH"
fi

# ---------- 5. 出报告 ----------
{
    echo "# GitHub → CNB 同步报告"
    echo
    echo "- 时间：$(date '+%F %T %Z')"
    echo "- 仓库：$REPO_DIR"
    echo "- 方向：$ORIGIN_REMOTE → $CNB_REMOTE"
    echo "- 状态：$(if [ ${#ANOMALIES[@]} -eq 0 ]; then echo '✅ 已对齐'; else echo "❌ ${#ANOMALIES[@]} 项异常"; fi)"
    echo
    if [ ${#NOTES[@]} -gt 0 ]; then
        echo "## 执行记录"
        echo
        for n in "${NOTES[@]}"; do echo "- $n"; done
        echo
    fi
    if [ ${#ANOMALIES[@]} -gt 0 ]; then
        echo "## 异常"
        echo
        for a in "${ANOMALIES[@]}"; do echo "- $a"; done
        echo
    fi
    if [ -n "$CNB_ONLY" ]; then
        echo "## 仅 CNB 存在（已保留，未删除）"
        echo
        echo "\`$CNB_ONLY\`"
        echo
    fi
    echo "## 引用"
    echo
    echo '```'
    echo "$ORIGIN_REFS" | awk '{print $2, $1}' | sort
    echo '```'
} >"$REPORT"

log "报告已写入 $REPORT"

# ---------- 6. 异常时调用大模型初判（best-effort，绝不影响同步结论） ----------
if [ ${#ANOMALIES[@]} -gt 0 ]; then
    {
        echo
        echo "## 异常详情"
        echo
        for a in "${ANOMALIES[@]}"; do echo "- $a"; done
    } >>"$ANOMALY_FILE"

    log "检测到 ${#ANOMALIES[@]} 项异常，调用大模型初判"
    if [ -x "$CLAUDE_BIN" ]; then
        PROMPT="你是 Git 仓库同步运维助手。仓库目录 $REPO_DIR，$ORIGIN_REMOTE 是 GitHub，$CNB_REMOTE 是 CNB。
请阅读异常报告文件 $ANOMALY_FILE，并用 git log / git diff / git ls-remote 做只读排查，输出中文初判，包含：
1) 根因判断（是 CNB 被直接改动、凭据失效、网络问题，还是本地仓库状态问题）；
2) 影响范围（哪些分支/标签不一致，是否影响生产 main）；
3) 建议的人工处理步骤（明确写出命令，但不要执行任何写操作、不要 push、不要 merge）；
4) 是否可以安全地由人工执行 git push --force-with-lease 覆盖。
"
        TRIAGE_OUT="$(
            cd "$REPO_DIR" && timeout "$CLAUDE_TIMEOUT" "$CLAUDE_BIN" -p \
                --model "$TRIAGE_MODEL" \
                --allowedTools "Read Grep Glob Bash(git:*)" \
                --max-turns 20 \
                "$PROMPT" 2>&1
        )"
        RC=$?
        {
            echo
            echo "## 大模型初判（$(date '+%F %T')，exit=$RC）"
            echo
            echo '```text'
            echo "$TRIAGE_OUT"
            echo '```'
        } >>"$ANOMALY_FILE"
        if [ "$RC" -ne 0 ]; then
            log "大模型初判未成功（exit=$RC），详见 $ANOMALY_FILE"
        else
            log "大模型初判已写入 $ANOMALY_FILE"
        fi
    else
        {
            echo
            echo "## 大模型初判"
            echo
            echo "未找到可用的 claude CLI（$CLAUDE_BIN），跳过初判，请人工介入。"
        } >>"$ANOMALY_FILE"
        log "未找到 claude CLI，跳过初判"
    fi
    log "异常已记录：$ANOMALY_FILE"
    exit 1
fi

log "全部引用已对齐，GitHub → CNB 同步完成"
exit 0
