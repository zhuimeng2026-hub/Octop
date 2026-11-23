#!/bin/bash
# PC 端开发模式：外壳直连远程后台，不启动本地 Python 运行时。
#
#   ./package-dev-remote.sh            # 本地 dashboard 热更新（Vite）+ 远程后台 API
#   ./package-dev-remote.sh --direct   # 前端也来自远程后台（不开 Vite）
#
# 两种模式的差别只在「界面从哪来」：
#
#   默认（Vite）：界面是本地 dashboard 源码，改一行即热更新；API 走 Vite 代理
#                 转发到远程后台。BASE_URL 决定子路径，VITE_API_TARGET 决定代理
#                 目标（只填 origin，子路径原样透传，远程后台按 /videogen 挂载）。
#   --direct  ：界面与 API 都来自远程后台，等价于「拿发行版的壳调试线上后台」。
#
# 环境变量：
#   OCTOP_DEV_REMOTE_URL  远程后台地址，默认 https://ocbot.aixifs.com/videogen
#   OCTOP_DEV_VITE_PORT   本地 dashboard dev server 端口，默认 5173
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${OCTOP_DEV_REMOTE_URL:-https://ocbot.aixifs.com/videogen}"
VITE_PORT="${OCTOP_DEV_VITE_PORT:-5173}"
USE_VITE=1
[[ "${1:-}" == "--direct" ]] && USE_VITE=0

if ! command -v go >/dev/null 2>&1; then
  echo "go is not installed (need Go 1.25+)." >&2
  exit 1
fi
if ! command -v wails3 >/dev/null 2>&1; then
  echo "wails3 is not installed." >&2
  echo "  go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.13" >&2
  exit 1
fi

# 远程地址拆成 origin 与子路径：
#   https://ocbot.aixifs.com/videogen -> origin=https://ocbot.aixifs.com, base=/videogen
#   https://example.com                -> origin=https://example.com,        base=""
scheme="${REMOTE%%://*}"
rest="${REMOTE#*://}"
host="${rest%%/*}"
if [[ "$rest" == */* ]]; then
  BASE_PATH="/${rest#*/}"
  BASE_PATH="${BASE_PATH%/}"
else
  BASE_PATH=""
fi
ORIGIN="${scheme}://${host}"

vite_pid=""
cleanup() {
  [[ -n "$vite_pid" ]] && kill "$vite_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

TARGET="$REMOTE"

if [[ "$USE_VITE" -eq 1 ]]; then
  if [[ ! -d "$REPO/dashboard/node_modules" ]]; then
    echo "dashboard/node_modules is missing — run 'cd dashboard && npm ci' first." >&2
    exit 1
  fi
  echo "starting dashboard dev server (base=${BASE_PATH:-/}, proxy target=$ORIGIN)"
  (
    cd "$REPO/dashboard"
    # BASE_URL 给出子路径，VITE_API_TARGET 只给出 origin：
    # Vite 的代理按原样透传 "/videogen/api/…"，远程后台正是挂在 /videogen 上。
    exec env \
      BASE_URL="$BASE_PATH" \
      VITE_API_TARGET="$ORIGIN" \
      VITE_DEV_PORT="$VITE_PORT" \
      npm run dev
  ) &
  vite_pid=$!

  HEALTH="http://127.0.0.1:${VITE_PORT}${BASE_PATH}/api/health"
  ready=0
  for _ in $(seq 1 60); do
    if curl -sf -o /dev/null --max-time 2 "$HEALTH"; then
      ready=1
      break
    fi
    if ! kill -0 "$vite_pid" 2>/dev/null; then
      echo "dashboard dev server exited before it became ready; see the output above." >&2
      exit 1
    fi
    sleep 0.5
  done
  if [[ "$ready" -ne 1 ]]; then
    echo "dashboard dev server did not become ready at ${HEALTH} within 30s." >&2
    echo "Check that the remote backend is reachable: ${REMOTE}/api/health" >&2
    exit 1
  fi
  # 尾部斜杠是必须的：Vite 的 public base 是 "<子路径>/"，访问 "<子路径>"
  # （无斜杠）会落到 404 —— "did you mean to visit <子路径>/<子路径>?"。
  TARGET="http://127.0.0.1:${VITE_PORT}${BASE_PATH:+$BASE_PATH/}"
fi

echo "desktop shell target: ${TARGET}"
echo "  (developer mode: no local Python runtime, remote backend drives the API)"

cd "$REPO/desktop/src"
if [[ "$USE_VITE" -eq 1 ]]; then
  OCTOP_DESKTOP_URL="$TARGET" OCTOP_DESKTOP_AUTH_URL="$REMOTE" OCTOP_DESKTOP_DEV=1 wails3 dev
else
  OCTOP_DESKTOP_URL="$TARGET" OCTOP_DESKTOP_AUTH_URL="" OCTOP_DESKTOP_DEV=1 wails3 dev
fi
