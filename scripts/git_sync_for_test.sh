#!/bin/bash
# 全量测试前的 git 同步 —— 把被测仓库与外部 git（origin）对齐。
# 设计说明见 docs/backend-full-test.md「测试前的 git 同步」一节。
#
# 政策（同步尽力而为，绝不弄丢本地工作）：
#   1. git fetch origin 永远先做（只读，超时 300s）；
#   2. 设了 TEST_TARGET_BRANCH 且当前分支不同：工作树干净才切换过去
#      （本地没有该分支就从 origin 建跟踪分支）；脏树不切换，原树进测试；
#   3. 对齐只快进（merge --ff-only）：不造合并提交、不 rebase；
#   4. 工作树脏 / 分头 / 无 upstream / fetch 失败 / 等锁超时 → 跳过同步，
#      原树直接进测试——测到本地状态也比不测强；
#   5. 任何情况下不 discard、不 stash、不 push。
#
# 本脚本永远 exit 0：它跑在 octop-backend-full-test.service 的
# ExecStartPre 上，非零退出会取消整个测试。同步结论写两处：
#   stdout（systemd 追加进 backend-full-test.log）—— 人读
#   $TEST_REPORT_DIR/git-sync-latest.json + git-sync-<时间戳>.json —— 机读
#
# 与 01:15 octop-git-sync / 01:40 cnb-git-sync-all 的分工：那两个做
# origin → cnb 的推送镜像，不动工作树；本脚本做 origin → 工作树的快进
# 更新。flock 串行化：镜像任务没跑完就等（最多 10 分钟），等不到就跳过。

set -u

REPO="${OCTOP_REPO:-/opt/Octop}"
REPORT_DIR="${TEST_REPORT_DIR:-/opt/octop-test-reports}"
TARGET_BRANCH="${TEST_TARGET_BRANCH:-}"
LOCK_FILE="/tmp/octop-git-sync-for-test.lock"
FETCH_TIMEOUT=300
FLOCK_WAIT=600
TS="$(date +%Y-%m-%dT%H:%M:%S%z)"
STAMP="$(date +%Y%m%d-%H%M%S)"

STATUS="unknown"
BRANCH=""
OLD_HEAD=""
NEW_HEAD=""
AHEAD=0
BEHIND=0
DETAIL=""
DIRTY=""

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] git-sync: $*"; }

finish() {
  mkdir -p "$REPORT_DIR"
  TS="$TS" STATUS="$STATUS" BRANCH="$BRANCH" TARGET="$TARGET_BRANCH" \
  OLD_HEAD="$OLD_HEAD" NEW_HEAD="$NEW_HEAD" AHEAD="$AHEAD" BEHIND="$BEHIND" \
  DETAIL="$DETAIL" DIRTY="$DIRTY" /usr/bin/python3 - > "$REPORT_DIR/git-sync-latest.json.tmp" <<'PY'
import json, os
dirty = [l for l in os.environ.get("DIRTY", "").splitlines() if l.strip()]
doc = {
    "ts": os.environ["TS"],
    "branch": os.environ["BRANCH"],
    "target": os.environ["TARGET"],
    "status": os.environ["STATUS"],
    "old_head": os.environ["OLD_HEAD"],
    "new_head": os.environ["NEW_HEAD"],
    "ahead": int(os.environ["AHEAD"] or 0),
    "behind": int(os.environ["BEHIND"] or 0),
    "detail": os.environ["DETAIL"],
    "dirty_files": dirty,
}
print(json.dumps(doc, ensure_ascii=False, indent=2))
PY
  rc=$?
  if [ "$rc" -eq 0 ]; then
    mv "$REPORT_DIR/git-sync-latest.json.tmp" "$REPORT_DIR/git-sync-latest.json"
    cp -f "$REPORT_DIR/git-sync-latest.json" "$REPORT_DIR/git-sync-$STAMP.json"
  else
    rm -f "$REPORT_DIR/git-sync-latest.json.tmp"
    log "状态 JSON 写入失败（不影响测试）"
  fi
  log "结论：status=$STATUS branch=${BRANCH:-无} ahead=$AHEAD behind=$BEHIND ${DETAIL}"
  exit 0
}

# ── 与镜像任务串行化 ─────────────────────────────────────────────────────────
exec 9>"$LOCK_FILE"
if ! flock -w "$FLOCK_WAIT" 9; then
  STATUS="locked"
  DETAIL="等锁 ${FLOCK_WAIT}s 超时（01:15/01:40 镜像任务可能还在跑），跳过同步"
  finish
fi

# ── 仓库与分支 ───────────────────────────────────────────────────────────────
if ! git -C "$REPO" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  STATUS="no-repo"
  DETAIL="$REPO 不是 git 工作树，跳过同步"
  finish
fi

BRANCH="$(git -C "$REPO" branch --show-current)"
if [ -z "$BRANCH" ]; then
  STATUS="detached"
  DETAIL="HEAD 处于 detached 状态，不做同步"
  finish
fi

# ── fetch（只读，安全，失败不阻塞）──────────────────────────────────────────
if ! timeout "$FETCH_TIMEOUT" git -C "$REPO" fetch origin --prune >/dev/null 2>&1; then
  STATUS="fetch-failed"
  DETAIL="git fetch origin 失败（网络/凭据），跳过同步"
  finish
fi

# ── 目标分支：设了 TEST_TARGET_BRANCH 且不同 → 工作树干净才切换 ─────────────
SWITCH_NOTE=""
if [ -n "$TARGET_BRANCH" ] && [ "$TARGET_BRANCH" != "$BRANCH" ]; then
  DIRTY="$(git -C "$REPO" status --porcelain)"
  if [ -n "$DIRTY" ]; then
    N="$(printf '%s\n' "$DIRTY" | wc -l)"
    STATUS="dirty"
    DETAIL="工作树有 $N 处未提交改动，无法切换到 $TARGET_BRANCH，原树跑测试"
    finish
  fi
  if git -C "$REPO" show-ref --verify --quiet "refs/heads/$TARGET_BRANCH"; then
    if ! git -C "$REPO" switch "$TARGET_BRANCH" >/dev/null 2>&1; then
      STATUS="switch-failed"
      DETAIL="git switch $TARGET_BRANCH 失败，原树跑测试"
      finish
    fi
  elif git -C "$REPO" show-ref --verify --quiet "refs/remotes/origin/$TARGET_BRANCH"; then
    if ! git -C "$REPO" switch -c "$TARGET_BRANCH" --track "origin/$TARGET_BRANCH" >/dev/null 2>&1; then
      STATUS="switch-failed"
      DETAIL="从 origin/$TARGET_BRANCH 建跟踪分支失败，原树跑测试"
      finish
    fi
  else
    STATUS="no-target"
    DETAIL="目标分支 $TARGET_BRANCH 本地与 origin 都没有，原树跑测试"
    finish
  fi
  SWITCH_NOTE="已从 $BRANCH 切换到 $TARGET_BRANCH；"
  BRANCH="$TARGET_BRANCH"
fi

OLD_HEAD="$(git -C "$REPO" rev-parse HEAD)"

# ── 脏树：跳过同步（不 stash、不强制覆盖）───────────────────────────────────
DIRTY="$(git -C "$REPO" status --porcelain)"
if [ -n "$DIRTY" ]; then
  N="$(printf '%s\n' "$DIRTY" | wc -l)"
  STATUS="dirty"
  DETAIL="${SWITCH_NOTE}工作树有 $N 处未提交改动，跳过同步（不 stash 不 checkout），原树跑测试"
  finish
fi

# ── upstream：优先分支配置，退而求其次 origin/<branch> ──────────────────────
UPSTREAM="$(git -C "$REPO" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"
if [ -z "$UPSTREAM" ]; then
  if git -C "$REPO" show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
    UPSTREAM="origin/$BRANCH"
  else
    STATUS="no-upstream"
    DETAIL="${SWITCH_NOTE}分支 $BRANCH 无 upstream 且 origin 上没有同名分支，跳过同步"
    finish
  fi
fi

# ── ahead / behind ──────────────────────────────────────────────────────────
COUNTS="$(git -C "$REPO" rev-list --left-right --count "HEAD...$UPSTREAM" 2>/dev/null || true)"
if [ -n "$COUNTS" ]; then
  AHEAD="${COUNTS%%$'\t'*}"
  BEHIND="${COUNTS##*$'\t'}"
fi

if [ "${BEHIND:-0}" -eq 0 ]; then
  if [ "${AHEAD:-0}" -gt 0 ]; then
    STATUS="local-ahead"
    DETAIL="${SWITCH_NOTE}本地领先 $UPSTREAM ${AHEAD} 个提交（未推送），无需拉取，测本地"
  else
    STATUS="up-to-date"
    DETAIL="${SWITCH_NOTE}已与 $UPSTREAM 对齐"
  fi
  finish
fi

# ── 快进（唯一的写操作，且只快进）───────────────────────────────────────────
if git -C "$REPO" merge --ff-only "$UPSTREAM" >/dev/null 2>&1; then
  NEW_HEAD="$(git -C "$REPO" rev-parse --short HEAD)"
  N_COMMITS="$(git -C "$REPO" rev-list --count "$OLD_HEAD..HEAD")"
  STATUS="updated"
  DETAIL="${SWITCH_NOTE}快进 ${OLD_HEAD:0:7} → $NEW_HEAD（拉取 $N_COMMITS 个提交）"
  log "本次拉取的改动（diffstat，最多 20 行）："
  git -C "$REPO" diff --stat "$OLD_HEAD" HEAD | tail -20 | while IFS= read -r l; do
    log "  $l"
  done
else
  STATUS="diverged"
  DETAIL="${SWITCH_NOTE}本地与 $UPSTREAM 分头，--ff-only 失败；不自动合并，原树跑测试（需人工处理）"
fi

finish
