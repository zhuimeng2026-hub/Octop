#!/usr/bin/env bash
# Build and publish the thin Windows client from the LATEST production code.
#
#   bash scripts/gitee/release_client.sh --dry-run          # build + verify + pack, no Gitee writes
#   bash scripts/gitee/release_client.sh                    # auto tag: v1.4.1-gitee.<max+1>
#   bash scripts/gitee/release_client.sh --tag v1.4.1-gitee.10
#
# Why this script exists
# ----------------------
# v1.4.1-gitee.9 shipped an exe compiled on 11-20, before the local-library
# bridge (f0d8fe17, 11-22) was merged. Its release body claimed "the front end
# loads remotely, so no need to rebuild the exe" — true for pure UI changes,
# wrong for features that need native shell code (file picker, local store,
# local render). Users saw "仅在桌面客户端可用" in a desktop client.
#
# The failure mode is removed here by three hard gates:
#   1. Source: fetch ${SOURCE_REF} (default origin/main) and build in a detached
#      worktree at that exact commit. No dirty tree, no reused old exe.
#   2. Product: grep the built exe for the bridge markers. Abort before packing
#      if any is missing.
#   3. Tag: Gitee tags are immutable, so publish under a NEW tag. Refuse to
#      reuse a tag that already exists.
#
# Publication order (verified on gitee.3 ... gitee.9):
#   render README on master (push_readme.py -> sha) -> create release with that
#   sha as target (publish_release.sh) -> upload the green zip.
#
# One artifact only
# -----------------
# Up to gitee.10 the release carried both Octop.exe and the green zip. Both
# entries share the filename Octop.exe inside the archive, so users comparing
# "the exe I downloaded" with "the exe inside the zip" ended up comparing two
# different builds (one of them a stale pack) and reported a phantom feature
# difference. The green zip already contains Octop.exe + README.txt, so the
# standalone exe is pure redundancy: it is no longer packed nor uploaded.
set -euo pipefail

API_BASE="${GITEE_API_BASE:-https://gitee.com/api/v5}"
OWNER="webheat"
REPO="octop_client"
SOURCE_REF="origin/main"
VERSION=""
TAG=""
SERVER_URL="https://ocbot.aixifs.com/videogen"
COMPONENTS_URL="https://dw.mengxa.com/video-components/1.4.0/win-x64/manifest.json,http://dw.mengxa.com/video-components/1.4.0/win-x64/manifest.json"
DRY_RUN=0

usage() {
  sed -n '2,35p' "$0"
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --tag) TAG="$2"; shift 2 ;;
    --owner) OWNER="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --source-ref) SOURCE_REF="$2"; shift 2 ;;
    --server-url) SERVER_URL="$2"; shift 2 ;;
    --components-url) COMPONENTS_URL="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
done

die() { echo "ERROR: $*" >&2; exit 1; }
info() { printf '\n==> %s\n' "$*"; }

# --- 1. host tools, repo, token -------------------------------------------
for tool in git go wails3 python3 curl grep; do
  command -v "$tool" >/dev/null 2>&1 || die "missing tool: $tool"
done
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) PY=python ;;
  *) PY=python3 ;;
esac
command -v "$PY" >/dev/null 2>&1 || die "missing python interpreter: $PY"

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
[[ -f scripts/gitee/publish_release.sh && -f scripts/gitee/push_readme.py \
   && -f scripts/pack_green_client.py && -d desktop/src ]] \
  || die "run this script at the Octop repository root"

TOKEN="${GITEE_TOKEN:-}"
if [[ -z "$TOKEN" && -f "${HOME}/.gitee_token" ]]; then
  TOKEN="$(tr -d '[:space:]' < "${HOME}/.gitee_token")"
fi
if [[ "$DRY_RUN" -eq 0 && -z "$TOKEN" ]]; then
  die "no Gitee token: set GITEE_TOKEN or write ~/.gitee_token"
fi

# --- 2. gate 1: newest production source, in a clean detached worktree -----
info "Fetching ${SOURCE_REF} (production source of truth)"
git fetch origin main || die "git fetch origin main failed — refusing to build from a stale snapshot"
case "$SOURCE_REF" in
  origin/*) SRC_SHA="$(git rev-parse FETCH_HEAD)" ;;
  *) git fetch "${SOURCE_REF%%/*}" "${SOURCE_REF#*/}" || die "git fetch ${SOURCE_REF} failed"
     SRC_SHA="$(git rev-parse FETCH_HEAD)" ;;
esac
[[ "$SRC_SHA" =~ ^[0-9a-f]{40}$ ]] || die "bad source sha: ${SRC_SHA}"

TMP_BASE="${TMPDIR:-/tmp}"
WORK_DIR="$(mktemp -d "${TMP_BASE}/octop-release.XXXXXX")"
ASSETS_DIR="$(mktemp -d "${TMP_BASE}/octop-assets.XXXXXX")"
rmdir "$WORK_DIR" 2>/dev/null || true
cleanup() {
  # git worktree remove needs the path git registered. Use shutil.rmtree for
  # leftovers: a variable-path `rm -rf` is silently blocked by the host's
  # safe-delete guard on Windows.
  git worktree remove --force "$WORK_DIR" >/dev/null 2>&1 || true
  git worktree prune >/dev/null 2>&1 || true
  python3 - "${WORK_DIR:-}" "${ASSETS_DIR:-}" "${BODY_FILE:-}" <<'PY' 2>/dev/null || true
import os, shutil, sys
for p in sys.argv[1:]:
    if not p:
        continue
    try:
        if os.path.isdir(p):
            shutil.rmtree(p)
        elif os.path.isfile(p):
            os.remove(p)
    except OSError:
        pass
PY
}
trap cleanup EXIT

git worktree add --detach "$WORK_DIR" "$SRC_SHA" >/dev/null \
  || die "cannot create worktree at ${SRC_SHA}"
[[ "$(git -C "$WORK_DIR" rev-parse HEAD)" == "$SRC_SHA" ]] || die "worktree HEAD mismatch"

# The bridge must exist in the source, not just be hoped for in the binary.
[[ -f "$WORK_DIR/desktop/src/library_bridge.go" ]] \
  || die "${SOURCE_REF} (${SRC_SHA}) has no desktop/src/library_bridge.go — wrong source ref"
grep -q 'installLibraryBridge' "$WORK_DIR/desktop/src/main.go" \
  || die "${SOURCE_REF} (${SRC_SHA}) never installs the library bridge"

# build/windows/icon.ico is gitignored (desktop/src/.gitignore:8) but required
# by `wails3 generate syso`. It is a static icon, not product code: copy the
# checked-out copy into the clean worktree so syso generation can run.
for icon in desktop/src/build/windows/icon.ico desktop/src/build/darwin/icons.icns; do
  if [[ -f "$icon" && ! -f "$WORK_DIR/$icon" ]]; then
    mkdir -p "$WORK_DIR/$(dirname "$icon")"
    cp "$icon" "$WORK_DIR/$icon"
  fi
done
[[ -f "$WORK_DIR/desktop/src/build/windows/icon.ico" ]] \
  || die "missing desktop/src/build/windows/icon.ico (gitignored build resource)"

if [[ -z "$VERSION" ]]; then
  VERSION="1.4.1"
fi
if [[ -z "$TAG" ]]; then
  TAG="v${VERSION}-gitee.0"
fi
info "Source: ${SOURCE_REF} @ ${SRC_SHA}"
info "Product version: ${VERSION}; release tag: ${TAG}"

# --- 3. build: syso + thin exe with baked production URLs -----------------
info "Generating Windows syso"
(
  cd "$WORK_DIR/desktop/src/build"
  "$PY" stamp_version.py json windows/info.json windows/info.generated.json "$VERSION"
  "$PY" stamp_version.py manifest windows/wails.exe.manifest windows/wails.exe.generated.manifest "$VERSION"
  wails3 generate syso -arch amd64 -icon windows/icon.ico \
    -manifest windows/wails.exe.generated.manifest \
    -info windows/info.generated.json -out ../wails_windows_amd64.syso
) || die "syso generation failed"

info "Building thin client (tags=production,thin)"
LDFLAGS="-w -s -H windowsgui -X main.defaultServerURL=${SERVER_URL} -X main.defaultVideoComponentsURL=${COMPONENTS_URL}"
(
  cd "$WORK_DIR/desktop/src"
  GOOS=windows CGO_ENABLED=0 GOARCH=amd64 go build \
    -tags production,thin -trimpath -buildvcs=false \
    -ldflags="$LDFLAGS" -o bin/Octop.exe .
) || die "go build failed"

EXE="$WORK_DIR/desktop/src/bin/Octop.exe"
[[ -f "$EXE" ]] || die "exe was not produced"

# --- 4. gate 2: the exe must carry the local-library bridge ---------------
count_string() {
  local pattern="$1" file="$2"
  if command -v strings >/dev/null 2>&1; then
    strings -n 8 "$file" | grep -Fc "$pattern" || true
  else
    grep -aoF "$pattern" "$file" | wc -l
  fi
}
require_string() {
  local pattern="$1" min="$2" label="$3"
  local n
  n="$(count_string "$pattern" "$EXE")"
  if [[ "$n" -lt "$min" ]]; then
    die "产物自检失败：${label} 出现 ${n} 次（需要 >= ${min}）。壳里没有本机素材库桥接，禁止发布。"
  fi
  printf '  ok  %-28s %s\n' "$label" "$n"
}

info "Verifying built exe ($EXE)"
require_string 'octopDesktopLibrary' 1 'octopDesktopLibrary'
require_string 'desktop:library:' 1 'desktop:library:'
require_string 'product-library/recognize' 1 'recognize endpoint'
require_string "$SERVER_URL" 1 'baked server URL'

exe_size="$(wc -c < "$EXE" | tr -d ' ')"
[[ "$exe_size" -gt 8000000 && "$exe_size" -lt 40000000 ]] \
  || die "exe size ${exe_size} is outside the expected 8-40 MB range"
EXE_SHA256="$(sha256sum "$EXE" | cut -d' ' -f1 | tr -d '\\')"
printf '  ok  exe size %s bytes\n  ok  sha256 %s\n' "$exe_size" "$EXE_SHA256"

# --- 5. pack the green client ---------------------------------------------
info "Packing green client"
(
  cd "$WORK_DIR"
  "$PY" scripts/pack_green_client.py --exe "$EXE" --out-dir "$ASSETS_DIR" \
    --version "$VERSION" --no-7z
) || die "pack_green_client.py failed"

ZIP="$ASSETS_DIR/Octop-green-windows-amd64-${VERSION}.zip"
[[ -f "$ZIP" ]] || die "green zip was not produced"
ZIP_SHA256="$(sha256sum "$ZIP" | cut -d' ' -f1 | tr -d '\\')"
zip_size="$(wc -c < "$ZIP")"
[[ "$zip_size" -lt 100000000 ]] || die "attachment too large for Gitee: $(basename "$ZIP")"
info "Assets ready: $(ls -1 "$ASSETS_DIR" | tr '\n' ' ')"

if [[ "$DRY_RUN" -eq 1 ]]; then
  info "Dry run: release notes would go to ${OWNER}/${REPO} ${TAG}"
  printf '  server URL: %s\n  exe sha256: %s\n  zip sha256: %s\n' "$SERVER_URL" "$EXE_SHA256" "$ZIP_SHA256"
  exit 0
fi

# --- 6. tag: immutable on Gitee, so compute the next one -------------------
info "Checking Gitee tags for ${OWNER}/${REPO}"
tags_json="$(curl -fsS -H "Authorization: token ${TOKEN}" \
  "${API_BASE}/repos/${OWNER}/${REPO}/tags?per_page=100")" \
  || die "cannot read Gitee tags"
if printf '%s' "$tags_json" | "$PY" -c '
import json,sys
name=sys.argv[1]
sys.exit(0 if any(t.get("name")==name for t in (json.load(sys.stdin) or [])) else 1)
' "$TAG"; then
  die "tag ${TAG} already exists — Gitee tags cannot be moved; pass a new --tag"
fi
if [[ "$TAG" == "v${VERSION}-gitee.0" ]]; then
  TAG="$("$PY" -c '
import json,re,sys
version,=sys.argv[1:]
data=json.loads(sys.stdin.read() or "[]")
prefix=f"v{version}-gitee."
best=0
for t in data:
    n=t.get("name","")
    if n.startswith(prefix) and n[len(prefix):].isdigit():
        best=max(best,int(n[len(prefix):]))
print(f"{prefix}{best+1}")
' "$VERSION" <<< "$tags_json")"
  info "Auto-selected tag: ${TAG}"
fi

# --- 7. release notes ------------------------------------------------------
BODY_FILE="$(mktemp "${TMP_BASE}/octop-notes.XXXXXX")"
cat > "$BODY_FILE" <<EOF
## Octop 客户端 · 绿色版（Windows x64）

从生产分支 \`${SOURCE_REF}\` 的 \`${SRC_SHA}\` 构建，包含本机素材库所需的桌面桥接。

### 下载

| 文件 | 说明 | 大小 |
|---|---|---|
| \`Octop-green-windows-amd64-${VERSION}.zip\` | 绿色版压缩包（解压即用） | 5.3 MB |

压缩包内含 \`Octop.exe\`（主程序）与 \`README.txt\`（使用说明），**本轮不再单独提供裸 exe**。

### SHA-256

\`\`\`
${ZIP_SHA256}  Octop-green-windows-amd64-${VERSION}.zip
\`\`\`

### 使用说明

1. 下载并解压到任意目录（建议路径不含中文和空格）。
2. 双击 \`Octop.exe\` 启动，默认连接远程服务 \`${SERVER_URL}\`。
3. 登录后，在需要制作视频时按提示「一键安装」视频组件。
4. 本机素材库可直接导入本地图片：素材留在你的电脑上，服务器只负责 AI 识别。

### 已知限制

视频组件的批量输出能力由运行时产物 \`runtime.json\` 的 \`outputBatchVersion\` 声明；
当前 CDN 上的 \`core.zip\`（\`1.4.0\`）仍为旧版本，多平台面板可能不可用。
该问题与客户端壳版本无关，修复需发布新的组件版本目录。
EOF

# --- 8. publish: README commit -> release -> assets ------------------------
info "Updating download page (README) on master"
BASE_SHA="$(python3 scripts/gitee/push_readme.py \
  --owner "$OWNER" --repo "$REPO" --tag "$TAG" --version "$VERSION")" \
  || die "push_readme.py failed"
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || die "push_readme.py returned a bad sha: ${BASE_SHA}"
info "Download page commit: ${BASE_SHA}"

info "Creating release ${TAG} and uploading assets"
bash scripts/gitee/publish_release.sh \
  --tag "$TAG" --owner "$OWNER" --repo "$REPO" \
  --assets-dir "$ASSETS_DIR" --body-file "$BODY_FILE" \
  --base-sha "$BASE_SHA" || die "publish_release.sh failed"

# --- 9. verify the published release --------------------------------------
info "Verifying the published release"
release_json="$(curl -fsS -H "Authorization: token ${TOKEN}" \
  "${API_BASE}/repos/${OWNER}/${REPO}/releases/tags/${TAG}")" \
  || die "cannot read back the published release ${TAG}"
printf '%s' "$release_json" | "$PY" -c '
import json,sys
d=json.load(sys.stdin) or []
names={a.get("name") for a in (d.get("assets") or [])}
want={sys.argv[1]}
missing=sorted(w for w in want if w not in names)
extra=sorted(n for n in names if n not in want)
if missing:
    print("missing assets:", missing, file=sys.stderr); sys.exit(1)
if extra:
    print("unexpected assets (release should carry the zip only):", extra, file=sys.stderr); sys.exit(1)
print("release id:", d.get("id"), "assets:", sorted(names))
' "Octop-green-windows-amd64-${VERSION}.zip" || die "release verification failed"

info "Published: https://gitee.com/${OWNER}/${REPO}/releases/tag/${TAG}"
