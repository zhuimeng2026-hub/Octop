#!/usr/bin/env bash
# =============================================================================
# nightly-build.sh
#   夜间构建并发布 Concat 引擎便携包（给系统 crond 调）。
#
# 为什么要有这一层
#   build-concat-portable.sh 是「一次性动作」的脚本；crond 需要的是
#   「不依赖交互 shell、失败可查、不会重叠、不会把机器打满」的入口。
#
# 做什么
#   1. 取上游最新 release 的版本（build 脚本自己解析）；
#   2. 命中本地缓存则秒进解包，没命中才下 114MB 的上游 .msi；
#   3. 解出 staged 目录 → 补 portable/ → 打 zip → 生成引擎清单；
#   4. 并发上传到各 CDN 节点并逐台比对 sha256；
#      远端已经是同 sha256 就跳过，所以同一版本每天重跑不会反复传。
#
# 幂等
#   上游没出新版本 → 清单与产物 sha 不变 → 上传阶段整轮跳过，只做校验。
#
# 依赖
#   curl / jq / msiextract / zip / sha256sum / scp / ssh / flock
#   （Debian/Ubuntu: apt-get install -y msitools）
#
# 用法（cron 之外手工跑）
#   /opt/Octop/scripts/concat-engine/nightly-build.sh            # 正常跑
#   /opt/Octop/scripts/concat-engine/nightly-build.sh --no-upload # 只构建不发布
#
# 卸载
#   crontab -l | grep -v 'concat-engine/nightly-build.sh' | crontab -
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUILD_SCRIPT="$SCRIPT_DIR/build-concat-portable.sh"

# cron 的环境比交互 shell 干净得多：HOME 不一定有，PATH 也短。
export HOME="${HOME:-/root}"
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

OUT_DIR="${CONCAT_ENGINE_OUT_DIR:-$REPO_ROOT/dist/concat-engine}"
LOG_DIR="$OUT_DIR/logs"
LOG_FILE="$LOG_DIR/nightly.log"
LOCK_FILE="$OUT_DIR/nightly.lock"

# 可选：外部凭据文件（脚本自己 source，不指望 cron 注入环境变量）
if [ -n "${CONCAT_ENGINE_ENV_FILE:-}" ] && [ -r "${CONCAT_ENGINE_ENV_FILE}" ]; then
  # shellcheck disable=SC1090
  . "${CONCAT_ENGINE_ENV_FILE}"
fi

DO_UPLOAD=1
for arg in "$@"; do
  case "$arg" in
    --no-upload) DO_UPLOAD=0 ;;
  esac
done

mkdir -p "$LOG_DIR" "$OUT_DIR"

# 日志轮转：单文件超过 10MB 就留一份 .1，避免日志把盘吃满
if [ -f "$LOG_FILE" ] && [ "$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)" -gt 10485760 ]; then
  mv -f "$LOG_FILE" "$LOG_FILE.1"
fi

# 防重叠：上一轮还在跑就直接退出，不排队
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date -Is)] 上一轮还在跑，本次跳过"
  exit 0
fi

if [ ! -x "$BUILD_SCRIPT" ]; then
  echo "[$(date -Is)] x 找不到可执行的 $BUILD_SCRIPT"
  exit 1
fi

for c in curl jq msiextract zip sha256sum flock; do
  command -v "$c" >/dev/null 2>&1 || {
    echo "[$(date -Is)] x 缺少依赖：$c"
    exit 1
  }
done

echo "[$(date -Is)] 开始：夜间构建 Concat 引擎便携包（发布=$DO_UPLOAD）"

BUILD_ARGS=()
[ "$DO_UPLOAD" -eq 1 ] && BUILD_ARGS+=(--upload)

"$BUILD_SCRIPT" ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"} >>"$LOG_FILE" 2>&1
rc=$?

if [ "$rc" -eq 0 ]; then
  echo "[$(date -Is)] 完成（详情见 $LOG_FILE）"
else
  echo "[$(date -Is)] 失败 rc=$rc（详情见 $LOG_FILE）"
  tail -20 "$LOG_FILE" | sed 's/^/    /'
fi
exit "$rc"
