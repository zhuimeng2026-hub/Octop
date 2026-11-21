#!/bin/bash
# Git 凭据体检 + 自愈（针对本仓库的 https 远端）
#
# 为什么需要它：
#   ~/.git-credentials 是【多项目共享】的文件。git 的 credential-store helper 在
#   用掉一条凭据后会把它重写回文件；一旦这次查找走的是 host 级匹配
#   （credential.useHttpPath=false），被折叠的 path 级条目会连同同 host 的另一条
#   path 级条目一起消失（restore-git-creds.sh 文件头「坑 1」，2026-11-21 实测：
#   11 条 → 9 条，cnb.cool/mengxa.com/Octop.git 直接没了）。
#
#   本仓库 .git/config 里设了 credential.useHttpPath=true，所以
#   cnb.cool/mengxa.com/Octop.git 与 gitee.com/webheat/octop_client.git
#   只能靠【path 级】条目匹配。条目一丢，`git fetch cnb` 报的是
#   "could not read Username for 'https://cnb.cool/...'" —— 看不出是凭据问题，
#   很容易误判成「仓库没了」。
#
# 做什么：
#   1. 检查真实 store 里本仓库需要的条目在不在（只读）
#   2. 用【隔离副本】跑 ls-remote 验证各 https 远端真的能通
#      （隔离副本会被 git 改写，真实 store 不会 —— 坑 1）
#   3. 缺条目 / 远端不通 → 调用 /opt/envctl/credentials/restore-git-creds.sh 重写并复验
#
# 退出码：0 = 一切正常；1 = 原本有问题、已修复；2 = 仍有问题（需人工看日志）
#
# 定时：系统 crond 每天 03:10 跑一次（crontab -l 里能看到）
# 手动：bash scripts/check_git_credentials.sh [--no-fix]
set -uo pipefail

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL=C.UTF-8
export LANG=C.UTF-8
export HOME="${HOME:-/root}"
# 凭据找不到就立刻失败，不要卡在交互式提示上（cron 里没终端）
export GIT_TERMINAL_PROMPT=0

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STORE="$HOME/.git-credentials"
RESTORE=/opt/envctl/credentials/restore-git-creds.sh

FIX=1
[ "${1:-}" = "--no-fix" ] && FIX=0

say() { printf '%s\n' "$*"; }
hr()  { say "--------------------------------------------------"; }

# ---- 本仓库需要的条目（后缀匹配，token 本身不比对）----
# path 级：本仓库 useHttpPath=true，只认这些
PATH_ENTRIES=(
    "cnb.cool/mengxa.com/Octop.git"
    "gitee.com/webheat/octop_client.git"
)
# host 级：给本机其它仓库兜底
HOST_ENTRIES=(
    "cnb.cool"
    "gitee.com"
    "github.com"
)

problems=0

say "== 1/3 真实 store 条目检查 =="
hr
if [ ! -f "$STORE" ]; then
    say "  ✗ 凭据文件不存在：$STORE"
    problems=$((problems + 1))
else
    perm=$(stat -c %a "$STORE")
    [ "$perm" = "600" ] || say "  ⚠️  $STORE 权限是 $perm，不是 600"
    n=$(grep -c '^https://' "$STORE" 2>/dev/null || echo 0)
    say "  · store 共 $n 条，权限 $perm"
    for e in "${PATH_ENTRIES[@]}"; do
        # 形如 https://cnb:TOKEN@cnb.cool/mengxa.com/Octop.git —— 路径段以 @ 开头，
        # 所以用 host+path 整段匹配，不用前导斜杠
        if grep -qF "$e" "$STORE"; then
            say "  ✓ path 级 $e"
        else
            say "  ✗ path 级 $e 缺失"
            problems=$((problems + 1))
        fi
    done
    for e in "${HOST_ENTRIES[@]}"; do
        if grep -qE "^https://[^@]+@${e//./\\.}\$" "$STORE"; then
            say "  ✓ host 级 $e"
        else
            say "  ✗ host 级 $e 缺失"
            problems=$((problems + 1))
        fi
    done
fi

say ""
say "== 2/3 仓库级 git 配置 =="
hr
up=$(git -C "$REPO_DIR" config --local --get credential.useHttpPath)
if [ "$up" = "true" ]; then
    say "  ✓ credential.useHttpPath=true（path 级条目生效）"
else
    say "  ✗ credential.useHttpPath 不是 true（当前='${up:-未设置}'）——path 级凭据匹配不到"
    problems=$((problems + 1))
fi

# ---- 远端连通性：用隔离副本验，真实 store 不参与 ----
ISO="$(mktemp -t gitcredcheck.XXXXXX)"
trap 'rm -f "$ISO"' EXIT
[ -f "$STORE" ] && cp "$STORE" "$ISO" 2>/dev/null
chmod 600 "$ISO" 2>/dev/null

verify_remote() {
    local label="$1" url="$2" mode="$3" out rc
    local -a cfg=(-c "credential.helper=store --file=$ISO")
    if [ "$mode" = "path" ]; then
        cfg+=(-c credential.useHttpPath=true)
    else
        cfg+=(-c credential.useHttpPath=false)
    fi
    out=$(timeout 25 git -C "$REPO_DIR" "${cfg[@]}" ls-remote "$url" HEAD 2>&1)
    rc=$?
    if printf '%s' "$out" | grep -qE '^[0-9a-f]{40}'; then
        say "  ✓ $label"
        return 0
    fi
    say "  ✗ $label  → $(printf '%s' "$out" | head -1)"
    return 1
}

say ""
say "== 3/3 远端连通性（隔离 store，不碰真实 store） =="
hr
verify_remote "cnb.cool/mengxa.com/Octop.git" "https://cnb.cool/mengxa.com/Octop.git" path \
    || problems=$((problems + 1))
verify_remote "gitee.com/webheat/octop_client.git" "https://gitee.com/webheat/octop_client.git" path \
    || problems=$((problems + 1))
verify_remote "gitee.com/webheat/octop（公开仓库）" "https://gitee.com/webheat/octop" any \
    || problems=$((problems + 1))
if command -v ssh >/dev/null 2>&1; then
    # ssh 对 GitHub 的 "认证成功但不给 shell" 返回 rc=1，所以不能靠管道退出码判断
    ssh_out=$(timeout 20 ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -T git@github.com 2>&1 || true)
    if printf '%s' "$ssh_out" | grep -q "successfully authenticated"; then
        say "  ✓ github.com（SSH）"
    else
        say "  ⚠️  github.com SSH 认证失败"
    fi
fi

# ---- 修复 ----
if [ "$problems" -eq 0 ]; then
    say ""
    say "结论：✅ 凭据与远端均正常"
    exit 0
fi

if [ "$FIX" -eq 0 ]; then
    say ""
    say "结论：❌ 发现 $problems 处问题（--no-fix，未修复）"
    exit 2
fi

say ""
say "== 修复 =="
hr
if [ ! -f "$RESTORE" ]; then
    say "  ✗ 找不到 $RESTORE，无法自动修复"
    exit 2
fi

# 先只验证 token 本身；token 都不对时写入脚本会拒绝写入（等交互确认，cron 下等于放弃）
if bash "$RESTORE" --check >/dev/null 2>&1; then
    say "  · token 校验通过，重写 store"
    if bash "$RESTORE" </dev/null >/dev/null 2>&1; then
        say "  ✓ store 已重写"
        # 仓库级开关可能被别的工具改掉，一并复位
        git -C "$REPO_DIR" config --local credential.useHttpPath true
        say "  ✓ credential.useHttpPath=true 已复位"
        say ""
        say "结论：⚠️  原本有问题，已修复（建议复跑一次确认）"
        exit 1
    fi
    say "  ✗ 重写 store 失败"
else
    say "  ✗ token 校验不通过，已放弃重写（需人工处理）"
fi

say ""
say "结论：❌ 仍有问题，需人工处理"
exit 2
