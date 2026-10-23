#!/usr/bin/env bash
#
# Octop nightly full-test runner.
#
# Runs the whole ship bar end to end — backend lint / typecheck / pytest
# (non-live + live) and frontend typecheck / eslint / prettier / vitest /
# vite build — and prints one summary table with a single exit code.
#
# Deliberately NOT `make all`: that target runs `format-all` first, which
# *writes* (ruff format, prettier --write) and would rewrite the working tree
# of a live deployment at 01:00. This script only ever runs check-only
# variants (`ruff format --check`, `prettier --check`).
#
# Secrets are NOT read from the repo. They come from a root-only env file:
#   /etc/octop-nightly-test.env   (chmod 600, root:root)
# Override with OCTOP_NIGHTLY_ENV=... Everything in it is exported, which
# covers both `tests/live/*` (which also auto-loads a repo-root `.env`) and
# `tests/integration/test_bridge_live.py` (which only reads os.environ).
#
# Usage:
#   scripts/nightly_test.sh                 # every stage
#   scripts/nightly_test.sh backend         # backend stages only
#   scripts/nightly_test.sh frontend        # frontend stages only
#   scripts/nightly_test.sh live            # backend live tier only
#   scripts/nightly_test.sh 04-backend-test # one stage by id
#
# Exit code: 0 = all stages green, 1 = at least one stage failed.

set -uo pipefail

# ── configuration ───────────────────────────────────────────────────────────
REPO_ROOT="${OCTOP_REPO_ROOT:-/opt/Octop}"
DASHBOARD_DIR="$REPO_ROOT/dashboard"
LOG_ROOT="${OCTOP_NIGHTLY_LOG_DIR:-/var/log/octop-nightly-test}"
ENV_FILE="${OCTOP_NIGHTLY_ENV:-/etc/octop-nightly-test.env}"
LOCK_FILE="${OCTOP_NIGHTLY_LOCK:-/var/lock/octop-nightly-test.lock}"
PYTEST_JOBS="${PYTEST_JOBS:-2}"
# Must match the deployed sub-path (config.json base_path / OCTOP_BASE_PATH),
# otherwise the built bundle points at the wrong API prefix.
DASHBOARD_BASE_URL="${DASHBOARD_BASE_URL:-/videogen}"
# Build into a staging dir so the live src/octop/dashboard/ (served by the
# running octop.service) is never swapped out from under a serving process.
FE_BUILD_OUT="${FE_BUILD_OUT:-/var/tmp/octop-nightly-dashboard}"
SKIP_FRONTEND_BUILD="${SKIP_FRONTEND_BUILD:-0}"
# The dashboard bundle is big; the default 1536 MB heap made vite build die
# with "JavaScript heap out of memory" on this 4 GB host.
NODE_MAX_OLD_SPACE="${NODE_MAX_OLD_SPACE:-2816}"

# cron gives a minimal PATH; make uv + node reachable.
export PATH="/root/.local/bin:/root/.nvm/versions/node/v20.20.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Every stage runs from the repo root: `uv run` resolves the project
# (pyproject.toml + .venv) from the *current working directory*, and cron
# starts the script in $HOME. Without this cd every uv-backed stage dies
# with "Failed to spawn: ruff/mypy/pytest".
cd "$REPO_ROOT" || {
  echo "[nightly] repo root not found: $REPO_ROOT" >&2
  exit 1
}

# ── isolation ───────────────────────────────────────────────────────────────
# The deployment exports OCTOP_HOME=/opt/octop-data; tests must never see it.
unset OCTOP_HOME
export HOME="${OCTOP_NIGHTLY_HOME:-/var/tmp/octop-nightly-home}"
mkdir -p "$HOME"
# HOME is redirected above, but uv should keep using the real cache instead of
# re-downloading wheels into a throwaway directory.
export UV_CACHE_DIR="${UV_CACHE_DIR:-/root/.cache/uv}"

# ── single instance ─────────────────────────────────────────────────────────
mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[nightly] another run holds $LOCK_FILE — aborting"
  exit 0
fi

# ── secrets ─────────────────────────────────────────────────────────────────
if [ -r "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  echo "[nightly] loaded env file: $ENV_FILE"
else
  echo "[nightly] WARNING: no env file at $ENV_FILE — live/credentialed stages will skip"
fi

# ── logging ─────────────────────────────────────────────────────────────────
STAMP="$(date +%Y%m%d-%H%M%S)"
STAGE_DIR="$LOG_ROOT/$STAMP"
mkdir -p "$STAGE_DIR"
SUMMARY_FILE="$STAGE_DIR/summary.txt"
SUMMARY_TMP="$(mktemp)"

cleanup() { rm -f "$SUMMARY_TMP"; }
trap cleanup EXIT

# ── stage runner ────────────────────────────────────────────────────────────
STAGE_NAMES=()
STAGE_RCS=()
STAGE_DURS=()
STAGE_LOGS=()

run_stage() {
  local id="$1" name="$2"
  shift 2
  local log="$STAGE_DIR/$id.log"
  local t0=$SECONDS
  echo "[nightly] ▶ $id ($name) — $(date -Is)"
  "$@" >"$log" 2>&1
  local rc=$?
  local dur=$((SECONDS - t0))
  STAGE_NAMES+=("$id $name")
  STAGE_RCS+=("$rc")
  STAGE_DURS+=("$dur")
  STAGE_LOGS+=("$log")
  if [ "$rc" -eq 0 ]; then
    echo "[nightly] ✔ $id ($name) ok (${dur}s)"
  else
    echo "[nightly] ✘ $id ($name) FAILED rc=$rc (${dur}s) — tail of $log:"
    tail -n 25 "$log" | sed 's/^/    | /'
  fi
  return 0
}

# ── stages ──────────────────────────────────────────────────────────────────
stage_preflight() {
  echo "=== preflight $(date -Is) ==="
  echo "host      : $(uname -a)"
  echo "repo      : $REPO_ROOT"
  echo "git HEAD  : $(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo '?')"
  echo "git branch: $(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  if [ -n "$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null)" ]; then
    echo "git state : DIRTY (working tree has uncommitted changes)"
    git -C "$REPO_ROOT" status --short | sed 's/^/             /'
  else
    echo "git state : clean"
  fi
  echo "python    : $(uv run --no-sync python -V 2>&1)"
  echo "node      : $(node -v 2>&1)"
  echo "npm       : $(npm -v 2>&1)"
  echo "cpus      : $(nproc 2>/dev/null || echo '?')"
  echo "mem       : $(free -m 2>/dev/null | awk '/^Mem:/ {print $2" MiB total, "$7" MiB available"}')"
  echo "disk      : $(df -h "$REPO_ROOT" | awk 'NR==2 {print $4" free of "$2" ("$5" used)"}')"
  echo "--- tool presence ---"
  for b in uv node npm git docker psql bwrap; do
    printf '  %-8s %s\n' "$b" "$(command -v "$b" || echo 'MISSING')"
  done
  echo "--- node_modules ---"
  if [ -d "$DASHBOARD_DIR/node_modules" ]; then
    echo "  present ($(ls "$DASHBOARD_DIR/node_modules" | wc -l) entries)"
  else
    echo "  MISSING — frontend stages will fail; run: cd $DASHBOARD_DIR && npm ci"
  fi
  echo "--- credential presence (names only, values never printed) ---"
  for v in OPENAI_API_KEY OPENAI_BASE_URL OPENAI_MODEL_NAME \
           OCTOP_TEST_DATABASE_URL OCTOP_MEMORY_MAINTENANCE_TEST_DSN \
           OCTOP_TEST_IMAGE WEIXIN_TOKEN FEISHU_APP_ID \
           OCTOP_LDAP_TEST_URL OCTOP_BRIDGE_PEER_URL; do
    if printenv "$v" >/dev/null 2>&1 && [ -n "$(printenv "$v")" ]; then
      printf '  %-34s SET\n' "$v"
    else
      printf '  %-34s unset\n' "$v"
    fi
  done
  echo "=== preflight done $(date -Is) ==="
}

stage_env_sync() {
  # Refresh the venv from the lockfile. Needs network; if it fails we keep
  # using the existing .venv rather than failing the night.
  #
  # IMPORTANT: octop.service runs from THIS venv (/opt/Octop/.venv/bin/octop).
  # Re-syncing it can replace package files underneath a live process, so the
  # sync is skipped while the service is up unless FORCE_ENV_SYNC=1.
  if [ "${FORCE_ENV_SYNC:-0}" != "1" ] && pgrep -f "$REPO_ROOT/.venv/bin/octop" >/dev/null 2>&1; then
    echo "SKIPPED: octop is running from $REPO_ROOT/.venv — re-syncing it could break the service."
    echo "         (set FORCE_ENV_SYNC=1 to override, e.g. after stopping the service)"
    return 0
  fi
  echo "uv sync --frozen"
  if ! uv sync --frozen 2>&1; then
    echo "WARN: uv sync failed (offline?) — continuing with the existing .venv"
  fi
  echo "venv: $(uv run --no-sync python -c 'import sys; print(sys.executable)' 2>&1)"
}

stage_backend_lint() {
  uv run --no-sync ruff check src tests &&
  uv run --no-sync ruff format --check src tests
}

stage_backend_typecheck() {
  uv run --no-sync mypy src/octop
}

stage_backend_test() {
  uv run --no-sync pytest -m "not live" -n "$PYTEST_JOBS" -q -ra \
    --junitxml="$STAGE_DIR/backend-junit.xml" \
    --durations=15
}

stage_backend_live() {
  uv run --no-sync pytest -m live -v -ra \
    --junitxml="$STAGE_DIR/backend-live-junit.xml" \
    --durations=15
}

stage_fe_typecheck() {
  cd "$DASHBOARD_DIR" && npx tsc -b
}

stage_fe_lint() {
  cd "$DASHBOARD_DIR" && npm run lint && npm run format:check
}

stage_fe_test() {
  cd "$DASHBOARD_DIR" && npm test
}

stage_fe_build() {
  if [ "$SKIP_FRONTEND_BUILD" = "1" ]; then
    echo "SKIP_FRONTEND_BUILD=1 — skipping vite build"
    return 0
  fi
  rm -rf "$FE_BUILD_OUT"
  mkdir -p "$FE_BUILD_OUT"
  cd "$DASHBOARD_DIR" &&
    BASE_URL="$DASHBOARD_BASE_URL" NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=$NODE_MAX_OLD_SPACE" \
    npx vite build --outDir "$FE_BUILD_OUT" --emptyOutDir
}

# ── selection ───────────────────────────────────────────────────────────────
ALL_STAGES=(
  "00-preflight|preflight|stage_preflight"
  "01-env-sync|env sync|stage_env_sync"
  "02-backend-lint|backend ruff|stage_backend_lint"
  "03-backend-type|backend mypy|stage_backend_typecheck"
  "04-backend-test|backend pytest (not live)|stage_backend_test"
  "05-backend-live|backend pytest (live)|stage_backend_live"
  "06-fe-typecheck|frontend tsc -b|stage_fe_typecheck"
  "07-fe-lint|frontend eslint + prettier|stage_fe_lint"
  "08-fe-test|frontend vitest|stage_fe_test"
  "09-fe-build|frontend vite build|stage_fe_build"
)

select_stages() {
  case "${1:-all}" in
    all)      printf '%s\n' "${ALL_STAGES[@]}" ;;
    backend)  printf '%s\n' "${ALL_STAGES[@]}" | grep -E '^(00|01|02|03|04|05)-' ;;
    frontend) printf '%s\n' "${ALL_STAGES[@]}" | grep -E '^(06|07|08|09)-' ;;
    live)     printf '%s\n' "${ALL_STAGES[@]}" | grep -E '^05-' ;;
    *)
      if printf '%s\n' "${ALL_STAGES[@]}" | grep -q "^$1|"; then
        printf '%s\n' "${ALL_STAGES[@]}" | grep "^$1|"
      else
        echo "unknown stage: $1" >&2
        echo "known stages: ${ALL_STAGES[*]%%|*}" >&2
        exit 2
      fi
      ;;
  esac
}

# ── main ────────────────────────────────────────────────────────────────────
echo "[nightly] start $(date -Is) — repo=$REPO_ROOT stages=$*"
SELECTED="$(select_stages "${1:-all}")"
if [ -z "$SELECTED" ]; then
  echo "[nightly] no stage matched '${1:-all}'" >&2
  exit 2
fi
FAILED=0

while IFS= read -r entry; do
  [ -z "$entry" ] && continue
  id="${entry%%|*}"
  rest="${entry#*|}"
  name="${rest%%|*}"
  fn="${rest#*|}"
  run_stage "$id" "$name" "$fn"
done <<< "$SELECTED"

# ── summary ─────────────────────────────────────────────────────────────────
# NB: compute FAILED *before* piping into tee — a pipeline runs the left side
# in a subshell, so an assignment there would be lost.
FAILED=0
for rc in "${STAGE_RCS[@]}"; do
  [ "$rc" -eq 0 ] || FAILED=1
done

{
  echo "Octop nightly test — $(date -Is)"
  echo "repo: $REPO_ROOT"
  echo "git : $(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo '?') ($(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?'))"
  echo
  printf '%-18s %-34s %-6s %-8s %s\n' "STAGE" "NAME" "RESULT" "SECONDS" "LOG"
  for i in "${!STAGE_NAMES[@]}"; do
    if [ "${STAGE_RCS[$i]}" -eq 0 ]; then res="ok"; else res="FAIL"; fi
    printf '%-18s %-34s %-6s %-8s %s\n' \
      "${STAGE_NAMES[$i]%% *}" "${STAGE_NAMES[$i]#* }" "$res" "${STAGE_DURS[$i]}" "${STAGE_LOGS[$i]}"
  done
  echo
  if [ "$FAILED" -eq 0 ]; then
    echo "RESULT: ALL STAGES PASSED"
  else
    echo "RESULT: FAILURES PRESENT — see the stage logs above"
  fi
} | tee "$SUMMARY_FILE"

LATEST="$LOG_ROOT/latest"
ln -sfn "$STAGE_DIR" "$LATEST" 2>/dev/null || true

# ── optional failure notification ───────────────────────────────────────────
if [ "$FAILED" -ne 0 ] && [ -n "${OCTOP_NIGHTLY_WEBHOOK:-}" ]; then
  {
    echo "Octop nightly test FAILED"
    echo "host: $(hostname)"
    echo "time: $(date -Is)"
    echo "summary:"
    cat "$SUMMARY_FILE"
  } | curl -fsS --max-time 20 -X POST -H 'Content-Type: text/plain' \
      --data-binary @- "$OCTOP_NIGHTLY_WEBHOOK" >/dev/null 2>&1 || \
      echo "[nightly] webhook notify failed (ignored)"
fi

echo "[nightly] end $(date -Is) — logs in $STAGE_DIR"
exit "$FAILED"
