#!/usr/bin/env bash
# =============================================================================
# build-concat-portable.sh
#   把上游 Concat 的 Windows 安装包重组成「绿色便携包」，生成客户端可读的
#   引擎清单，并（可选）上传到 CDN 节点。
#
# 为什么需要重组
#   上游 release 只发布 Windows 安装包（setup.exe / .msi），不发布便携 zip；
#   而 Concat 的绿色模式是靠「exe 同级存在名为 portable 的目录」触发的
#   （上游 concat-host/src/dirs.rs 的 portable_root()）。本脚本用 msiextract
#   把上游的 .msi 解出 staged 目录树，同级补一个空的 portable/ 目录，再打成 zip。
#
# 为什么用 .msi 而不是 setup.exe
#   上游的 setup.exe 是 Inno Setup 6.7.0，innoextract 最高只认到 6.3.3
#   （发行版里的 1.8 只认到 6.0.2），Inno 路线解不开。.msi 是标准 MSI 库，
#   msitools 的 msiextract 能解；上游 .wxs 明说两个安装器出自同一份 staged
#   目录（"the two installers ship the same files"），所以内容等价。
#
# 依赖（缺任何一个都会在开跑前退出，不会半途才炸）
#   curl / jq / msiextract / zip / sha256sum / scp / ssh
#   Debian/Ubuntu: apt-get install -y msitools
#
# 幂等
#   同一个版本重复跑：远端已有同 sha256 的文件就跳过上传，只做校验；
#   本地产物已存在、且 meta 里记的上游安装包 sha 与本次一致（输入没变）时，
#   也跳过重新下载与重新打包。
#
# 分发拓扑（dw.mengxa.com 的 DNS 轮询到 4 个 IP）
#
#   | IP              | HTTPS         | HTTP                 | 角色                     |
#   |-----------------|---------------|----------------------|--------------------------|
#   | 1.14.182.208   | ✅ 200        | ✅ 206               | HTTPS 主源               |
#   | 175.178.33.107 | ✅ 200        | 301→HTTPS（不供文件） | HTTPS 主源               |
#   | 175.178.192.87 | ❌ SNI 不匹配 | ✅ 206               | 只服务 HTTP              |
#   | 8.134.147.195  | ❌ 过期证书    | 403 拦截页            | 故意挂的故障节点          |
#
#   只有前三台对外供文件，所以 DEPLOY_HOSTS 只列这三台。
#   8.134.147.195 是容灾验证用的故障节点（返回别的站点的过期证书 + 拦截页）：
#   不要给它上传，也不要从 DNS 里摘掉 —— 摘了这套容灾验证就没了。
#
#   客户端拿到 manifest 后按 (host, scheme) 分组、逐 IP 探测并避开坏节点，
#   再把并行 Range 分片轮询到不同可达节点上。所以 manifest 写双 scheme
#   （https + http）同域名就够了，**不要写 IP 直连地址**。
#
# 用法
#   ./build-concat-portable.sh                      # 只在本地构建（默认）
#   ./build-concat-portable.sh --upload             # 构建 + 上传 + 逐台校验
#   ./build-concat-portable.sh --version 0.2.13     # 锁定版本
#   ./build-concat-portable.sh --verify-only        # 只校验远端已发布产物
#   ./build-concat-portable.sh --verify-http         # 逐 IP 探活 HTTP 可达性
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ---- 可覆盖的环境变量（cron 里不依赖交互 shell，全部有默认值）----------------
CONCAT_ENGINE_VERSION="${CONCAT_ENGINE_VERSION:-}"          # 空 = 取上游最新 release
CONCAT_ENGINE_OUT_DIR="${CONCAT_ENGINE_OUT_DIR:-$REPO_ROOT/dist/concat-engine}"
# 分发地址。只写到「域名（含端口）」这一层：路径由脚本按 concat-engine/<版本> 拼，
# 写成 https://dw.mengxa.com/concat-engine 会和远端目录重复成 concat-engine/concat-engine。
CONCAT_ENGINE_BASE_URL="${CONCAT_ENGINE_BASE_URL:-https://dw.mengxa.com}"
# 镜像地址：逗号分隔。写进 manifest 的 urls[]，客户端逐个尝试，
# 并把并行 Range 分片轮询到不同源上（不同源往往就是不同机器）。
CONCAT_ENGINE_MIRRORS="${CONCAT_ENGINE_MIRRORS:-http://dw.mengxa.com}"
# 单个 part 开几路并行 Range 下载。客户端读 manifest 的 connections 字段；
# 没有这个字段就退化成单连接（≈600 KB/s），多点并行等于没开。
CONCAT_ENGINE_CONNECTIONS="${CONCAT_ENGINE_CONNECTIONS:-4}"
CONCAT_ENGINE_DEPLOY_HOSTS="${CONCAT_ENGINE_DEPLOY_HOSTS:-175.178.192.87,1.14.182.208,175.178.33.107}"
CONCAT_ENGINE_DEPLOY_USER="${CONCAT_ENGINE_DEPLOY_USER:-root}"
CONCAT_ENGINE_DEPLOY_PORT="${CONCAT_ENGINE_DEPLOY_PORT:-13122}"
CONCAT_ENGINE_DEPLOY_KEY="${CONCAT_ENGINE_DEPLOY_KEY:-$HOME/.ssh/id_ed25519}"
CONCAT_ENGINE_WEB_ROOT="${CONCAT_ENGINE_WEB_ROOT:-/opt/dw.mengxa.com}"
CONCAT_ENGINE_UPSTREAM_REPO="${CONCAT_ENGINE_UPSTREAM_REPO:-jub0t/Concat}"
CONCAT_ENGINE_CURL_NOPROXY="${CONCAT_ENGINE_CURL_NOPROXY:-1}"
CONCAT_ENGINE_MIN_FREE_MB="${CONCAT_ENGINE_MIN_FREE_MB:-2048}"
# zip 里写入的时间戳（固定值 → 同样输入产出同样的包）
CONCAT_ENGINE_ZIP_EPOCH="${CONCAT_ENGINE_ZIP_EPOCH:-1600000000}"

DO_UPLOAD=0
PUBLISH_NAMES=()
PUBLISH_PATHS=()
VERIFY_ONLY=0
VERIFY_HTTP=0
DO_BUILD=1
KEEP_WORK=0
MIRROR_OVERRIDE=()

# 日志一律走 stderr：download_and_verify 的返回值要用 INSTALLER="$(download_and_verify)"
# 取，日志混进 stdout 会把安装包路径冲掉（解包工具会拿到一串日志文本当文件名）。
say()  { printf '\n\033[1m==> %s\033[0m\n' "$*" >&2; }
info() { printf '    %s\n' "$*" >&2; }
warn() { printf '\033[33m    ! %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31m    x %s\033[0m\n' "$*" >&2; exit 1; }

usage() { sed -n '2,55p' "${BASH_SOURCE[0]}"; }

while (($#)); do
  case "$1" in
    --version)      CONCAT_ENGINE_VERSION="${2:-}"; shift 2 ;;
    --out-dir)      CONCAT_ENGINE_OUT_DIR="${2:-}"; shift 2 ;;
    --base-url)     CONCAT_ENGINE_BASE_URL="${2:-}"; shift 2 ;;
    --mirror)       MIRROR_OVERRIDE+=("${2:-}"); shift 2 ;;
    --connections)  CONCAT_ENGINE_CONNECTIONS="${2:-}"; shift 2 ;;
    --host)         CONCAT_ENGINE_DEPLOY_HOSTS="${2:-}"; shift 2 ;;
    --upload)       DO_UPLOAD=1; shift ;;
    --no-build)     DO_BUILD=0; shift ;;
    --verify-only)  VERIFY_ONLY=1; DO_BUILD=0; shift ;;
    --verify-http)  VERIFY_HTTP=1; shift ;;
    --keep-work)    KEEP_WORK=1; shift ;;
    -h|--help)      usage; exit 0 ;;
    *)              die "未知参数：$1（--help 看用法）" ;;
  esac
done

# 镜像列表：env 的逗号分隔清单 + --mirror 追加项（保持顺序，base 永远排第一）
IFS=',' read -r -a MIRROR_LIST <<< "$CONCAT_ENGINE_MIRRORS"
if [ "${#MIRROR_OVERRIDE[@]}" -gt 0 ]; then
  MIRROR_LIST+=("${MIRROR_OVERRIDE[@]}")
fi
case "$CONCAT_ENGINE_CONNECTIONS" in
  ''|*[!0-9]*) die "--connections 必须是正整数（当前 $CONCAT_ENGINE_CONNECTIONS）" ;;
esac
[ "$CONCAT_ENGINE_CONNECTIONS" -ge 1 ] || die "--connections 至少为 1（当前 $CONCAT_ENGINE_CONNECTIONS）"

# 分发地址只写到域名这一层：路径由脚本按 concat-engine/<版本> 拼
for u in "$CONCAT_ENGINE_BASE_URL" "${MIRROR_LIST[@]}"; do
  [ -n "$u" ] || continue
  rest="${u#*://}"
  case "$rest" in
    */*) die "分发地址只能写到域名（含端口），路径由脚本拼 concat-engine/<版本>：$u" ;;
  esac
done

# GitHub release 资产走 CDN 偶发 "Connection reset by peer"（errno 56），
# 必须带 --retry-all-errors 才会在传输层错误上重试，否则一次抖动就整条链失败。
# --max-time 给得宽：上游 release 资产 CDN 对本机带宽压到几十 KB/s，
# 103 MB 的安装包单连接可能要半小时以上；配合 -C - 断点续传而不是从头再来。
CURL=(curl -fsSL --retry 5 --retry-delay 5 --retry-all-errors
      --connect-timeout 20 --max-time 7200)
[ "$CONCAT_ENGINE_CURL_NOPROXY" = "1" ] && CURL+=(--noproxy '*')

# ---- 前置检查：缺依赖就别开跑 -------------------------------------------------
for c in curl jq msiextract zip sha256sum; do
  command -v "$c" >/dev/null 2>&1 || die "缺少依赖：$c（Debian/Ubuntu: apt-get install -y msitools）"
done
[ -r "$CONCAT_ENGINE_DEPLOY_KEY" ] || warn "找不到 SSH 私钥 $CONCAT_ENGINE_DEPLOY_KEY（只在 --upload 时需要）"

# ---- 解析上游版本与下载地址 ---------------------------------------------------
resolve_version() {
  if [ -n "$CONCAT_ENGINE_VERSION" ]; then echo "$CONCAT_ENGINE_VERSION"; return; fi
  local tag
  tag="$("${CURL[@]}" "https://api.github.com/repos/$CONCAT_ENGINE_UPSTREAM_REPO/releases/latest" \
        | jq -r '.tag_name // empty')" || true
  [ -n "$tag" ] || die "取不到上游最新 release tag（网络或 API 限制）；用 --version 显式指定"
  echo "${tag#v}"
}

VERSION="$(resolve_version)"
TAG="v$VERSION"
UPSTREAM_MANIFEST_URL="https://github.com/$CONCAT_ENGINE_UPSTREAM_REPO/releases/download/$TAG/manifest.json"
ZIP_NAME="Concat-$VERSION-windows-x86_64-portable.zip"
WORK_DIR="$CONCAT_ENGINE_OUT_DIR/work"
CACHE_DIR="$CONCAT_ENGINE_OUT_DIR/cache"
DIST_DIR="$CONCAT_ENGINE_OUT_DIR/$VERSION"
ZIP_PATH="$CONCAT_ENGINE_OUT_DIR/$ZIP_NAME"
META_PATH="$CONCAT_ENGINE_OUT_DIR/$ZIP_NAME.meta.json"
MANIFEST_PATH="$CONCAT_ENGINE_OUT_DIR/manifest.json"
REMOTE_SUBDIR="concat-engine/$VERSION"
ENGINE_ROOT="concat-engine"

say "Concat 引擎便携包构建"
info "版本        = $VERSION (tag $TAG)"
info "上游仓库    = https://github.com/$CONCAT_ENGINE_UPSTREAM_REPO"
info "产物        = $ZIP_PATH"
info "清单        = $MANIFEST_PATH"
info "远端目录    = ${CONCAT_ENGINE_WEB_ROOT%/}/$REMOTE_SUBDIR"

# ---- 上游清单：地址 + 期望 sha256（信任锚是上游自己发布的 manifest）----------
say "读取上游清单"
UPSTREAM_MANIFEST="$WORK_DIR/upstream-manifest.json"
mkdir -p "$WORK_DIR"
# 取不到上游清单时不直接死：本地已有产物（zip + meta + 上一次的 manifest）就降级复用。
# 凌晨 2 点无人值守时，一次网络抖动不该让整条发布链失败 —— 但降级必须显眼，
# 且这一轮的上游一致性没有被重新核对。
OFFLINE_FALLBACK=0
if ! "${CURL[@]}" -o "$UPSTREAM_MANIFEST" "$UPSTREAM_MANIFEST_URL"; then
  warn "取不到上游 manifest：$UPSTREAM_MANIFEST_URL"
  if [ -f "$ZIP_PATH" ] && [ -f "$META_PATH" ] && [ -f "$MANIFEST_PATH" ]; then
    OFFLINE_FALLBACK=1
    ARCHIVE_URL=""
    ARCHIVE_SHA="$(jq -r '.archive_sha // empty' "$META_PATH" 2>/dev/null)"
    ARCHIVE_BYTES="$(jq -r '.source.installerBytes // 0' "$MANIFEST_PATH" 2>/dev/null)"
    ARCHIVE_FILE="$(jq -r '.source.installerFile // "（未重新获取）"' "$MANIFEST_PATH" 2>/dev/null)"
    [ -n "$ARCHIVE_SHA" ] || die "本地 meta 里没有上游 sha256，无法降级复用"
    warn "降级为复用本地产物（本次未重新核对上游）：$ZIP_PATH"
  else
    die "取不到上游 manifest，且本地没有可复用的产物：$UPSTREAM_MANIFEST_URL"
  fi
else

# 上游同时发 .msi（WiX）和 setup.exe（Inno Setup）。这里取 .msi：
# 上游的 setup.exe 是 Inno Setup 6.7.0，而 innoextract 最高只认到 6.3.3
# （1.8 只认到 6.0.2），Inno 路线解不开；.msi 是标准 MSI 库，
# msitools 的 msiextract 能直接解出同一份 staged 目录（上游 .wxs 注释：
# "Built ... from the staged folder the .exe is made of, so the two
# installers ship the same files"）。
ARCHIVE_URL="$(jq -r '.binaries.windows["x86_64"].msi.url // empty' "$UPSTREAM_MANIFEST")"
ARCHIVE_SHA="$(jq -r '.binaries.windows["x86_64"].msi.sha256 // empty' "$UPSTREAM_MANIFEST")"
ARCHIVE_BYTES="$(jq -r '.binaries.windows["x86_64"].msi.bytes // 0' "$UPSTREAM_MANIFEST")"
[ -n "$ARCHIVE_URL" ] && [ -n "$ARCHIVE_SHA" ] \
  || die "上游清单里没有 windows/x86_64/msi 条目（版本 $VERSION 的发布结构可能变了）"
ARCHIVE_FILE="$(basename "$ARCHIVE_URL")"
info "上游包      = $ARCHIVE_FILE"
info "期望 sha256 = $ARCHIVE_SHA"
fi

# ---- 下载安装包并校验 --------------------------------------------------------
download_and_verify() {
  local installer="$CACHE_DIR/$ARCHIVE_FILE"
  mkdir -p "$CACHE_DIR"

  # 缓存命中就完全不下载：凌晨那一轮通常直接走这条分支。
  if [ -f "$installer" ]; then
    local cached_sha
    cached_sha="$(sha256sum "$installer" | awk '{print $1}')"
    if [ "$cached_sha" = "$ARCHIVE_SHA" ]; then
      say "命中缓存，跳过下载"
      info "缓存路径    = $installer"
      info "sha256      = $cached_sha"
      echo "$installer"
      return
    fi
    warn "缓存文件 sha256 与上游清单不符（可能是半截文件），重新下载"
    rm -f "$installer"
  fi

  say "下载上游安装包（断点续传）"
  local part="$installer.part"
  local got_size got_sha
  local attempt=0 max_attempts=12 rc=0 have=0
  while :; do
    attempt=$((attempt+1))
    rc=0
    # -C - 让 curl 从已有字节继续；失败重试由 --retry 处理
    "${CURL[@]}" -C - -o "$part" "$ARCHIVE_URL" || rc=$?
    have="$(stat -c%s "$part" 2>/dev/null || echo 0)"
    [ "$rc" -eq 0 ] && break
    # 字节数够了：多半是 416（已经下完），交给下面的 sha256 去判
    if [ "$ARCHIVE_BYTES" != "0" ] && [ "$have" -ge "$ARCHIVE_BYTES" ]; then break; fi
    # 22 = HTTP 错误（404/403/5xx）：重试没有意义
    [ "$rc" -eq 22 ] && die "上游地址返回 HTTP 错误（curl 22）：$ARCHIVE_URL"
    warn "下载中断（curl $rc），已得 $have 字节，继续重试（第 $attempt 次）"
    [ "$attempt" -ge "$max_attempts" ] && die "下载连续失败 $attempt 次，放弃：$ARCHIVE_URL"
  done
  [ -f "$part" ] || die "下载失败：$ARCHIVE_URL"

  got_size="$(stat -c%s "$part" 2>/dev/null || echo 0)"
  got_sha="$(sha256sum "$part" | awk '{print $1}')"
  [ "$got_sha" = "$ARCHIVE_SHA" ] || die "安装包 sha256 不符：期望 $ARCHIVE_SHA，实得 $got_sha"
  if [ "$ARCHIVE_BYTES" != "0" ] && [ "$got_size" != "$ARCHIVE_BYTES" ]; then
    die "安装包大小不符：期望 $ARCHIVE_BYTES，实得 $got_size"
  fi
  mv -f "$part" "$installer" || die "写缓存失败"
  info "校验通过（sha256 与 bytes 均一致），已入缓存 $installer"
  echo "$installer"
}

# ---- 解包 + 组装便携目录 ----------------------------------------------------
build_portable_zip() {
  local installer="$1"
  local extract_dir="$WORK_DIR/extract"
  local stage="$WORK_DIR/stage"
  rm -rf "$extract_dir" "$stage"
  mkdir -p "$extract_dir" "$stage"

  say "解出安装包内容（msiextract）"
  msiextract -C "$extract_dir" "$installer" \
    || die "msiextract 解包失败（上游换了安装包格式？）"

  # msiextract 按 MSI 的 Directory 表还原目录树，层级随上游 .wxs 变；
  # 直接按内容定位：带 concat.exe 的那个目录就是 {app}。
  local app_dir=""
  app_dir="$(find "$extract_dir" -type f -name 'concat.exe' -printf '%h\n' 2>/dev/null | head -1)"
  [ -n "$app_dir" ] || die "在解包结果里找不到 concat.exe（上游改了安装布局）"
  info "应用目录    = $app_dir"

  local payload="$stage/Concat-$VERSION-windows-x86_64"
  mkdir -p "$payload"
  cp -a "$app_dir"/. "$payload"/ || die "复制应用文件失败"
  [ -f "$payload/concat.exe" ] || die "产物里没有 concat.exe——不是预期的 Windows bundle"

  # 图标：上游的 .iss 额外把 assets/icons/concat.ico 放进 {app}，而 .msi
  # 只拿 staged 目录（不含图标）。补回来，让便携包与真实安装后的目录一致。
  local icon="$payload/concat.ico"
  if [ ! -f "$icon" ]; then
    local icon_url="https://raw.githubusercontent.com/$CONCAT_ENGINE_UPSTREAM_REPO/$TAG/assets/icons/concat.ico"
    "${CURL[@]}" -o "$icon" "$icon_url" || { rm -f "$icon"; warn "取不到图标（可选）"; }
  fi

  # portable 目录是绿色模式的触发条件：exe 同级存在名为 portable 的目录时，
  # 设置、recents、模型与缓存全部落在其中，机器上别处不写。
  mkdir -p "$payload/portable"

  cat > "$payload/便携版说明.txt" <<EOF
Concat $VERSION 绿色便携版（Windows x86_64）

用法
  1. 整个目录解压到任意位置（可放 U 盘），不要只拷 concat.exe；
  2. 双击 concat.exe 即可运行，无需安装、不写注册表、不写系统目录；
  3. 同级的 portable/ 目录是绿色模式的开关：设置、最近打开、下载的模型与
     缓存都落在它里面。删掉它，程序会改用 %APPDATA% / %LOCALAPPDATA%。

注意
  - 本包不包含 AI 模型（语音转写、抠像、TTS 音色等），首次使用相关功能时
    需要联网下载，下载位置同样在 portable/ 内；
  - 显卡驱动较旧的机器可用 CPU 合成回退，但 GPU 合成与导出会变慢；
  - 许可：Concat 为 AGPL-3.0-or-later。本包为未修改的上游二进制，
    对应源码获取地址见 manifest.json 的 source 字段。

来源
  https://github.com/jub0t/Concat  tag $TAG
EOF

  say "打包便携 zip"
  rm -f "$ZIP_PATH"
  # 固定时间戳 + 排序后的条目顺序 → 同样的上游包产出同样的 zip。
  # 这不是洁癖：夜间任务靠「远端 sha256 相同就跳过上传」避免每天重传 132MB，
  # 而 zip 默认会写入构建时刻的时间戳，那样每次重建 sha 都不同、就会反复重传。
  find "$payload" -exec touch -h -d "@$CONCAT_ENGINE_ZIP_EPOCH" {} +
  if find "$payload" -name "*$'\n'" -print -quit | grep -q .; then
    warn "文件名里有换行，改用 zip -r（顺序不可复现）"
    ( cd "$stage" && zip -q -r -X "$ZIP_PATH" "Concat-$VERSION-windows-x86_64" ) \
      || die "zip 打包失败"
  else
    ( cd "$stage" && find "Concat-$VERSION-windows-x86_64" -print | LC_ALL=C sort \
        | zip -q -X "$ZIP_PATH" -@ ) || die "zip 打包失败"
  fi
  mkdir -p "$DIST_DIR"
  cp -f "$ZIP_PATH" "$DIST_DIR/$ZIP_NAME"
  info "产物大小    = $(stat -c%s "$ZIP_PATH") 字节"
}

# ---- 生成客户端可读的引擎清单 ------------------------------------------------
write_manifest() {
  say "生成引擎清单"
  local sha bytes urls
  local -a raw_urls=() urls_list=()
  local u v dup
  sha="$(sha256sum "$ZIP_PATH" | awk '{print $1}')"
  bytes="$(stat -c%s "$ZIP_PATH")"
  mkdir -p "$DIST_DIR"

  # part 的 urls[]：主源第一，镜像随后。客户端按顺序轮询并行 Range 分片，
  # 所以顺序不能被排序打乱（这里不用 jq 的 unique —— 它会重排）。
  for u in "${CONCAT_ENGINE_BASE_URL%/}" "${MIRROR_LIST[@]}"; do
    [ -n "$u" ] || continue
    raw_urls+=("${u%/}/$REMOTE_SUBDIR/$ZIP_NAME")
  done
  for u in "${raw_urls[@]}"; do
    dup=0
    for v in "${urls_list[@]}"; do
      [ "$v" = "$u" ] && dup=1 && break
    done
    [ "$dup" -eq 0 ] && urls_list+=("$u")
  done
  urls="$(jq -nc --args '$ARGS.positional' "${urls_list[@]}")"
  info "下载地址    = ${urls_list[*]}"

  jq -n \
    --arg version "$VERSION" \
    --arg tag "$TAG" \
    --arg sha "$sha" \
    --argjson bytes "$bytes" \
    --argjson urls "$urls" \
    --argjson connections "$CONCAT_ENGINE_CONNECTIONS" \
    --arg archive_sha "$ARCHIVE_SHA" \
    --arg archive_file "$ARCHIVE_FILE" \
    --argjson archive_bytes "$ARCHIVE_BYTES" \
    --arg repo "$CONCAT_ENGINE_UPSTREAM_REPO" \
    '{
      schema: 2,
      product: "Concat",
      version: $version,
      platform: "windows-x86_64",
      parts: [
        {
          id: "engine",
          urls: $urls,
          sha256: $sha,
          size: $bytes,
          format: "zip",
          required: true,
          connections: $connections,
          stripRoot: true
        }
      ],
      source: {
        repo: ("https://github.com/" + $repo),
        tag: $tag,
        license: "AGPL-3.0-or-later",
        installerFile: $archive_file,
        installerBytes: $archive_bytes,
        installerSha256: $archive_sha,
        sourceOffer: "本包分发上游未修改的二进制；按 AGPL 提供对应源码的获取地址即上方 repo + tag"
      },
      notes: {
        portable: "包内 portable/ 目录是绿色模式的触发条件，设置与模型都落在其中",
        models: "模型不随引擎分发，首次使用相关功能时按需下载",
        unpack: "解压整个目录，不要只取 concat.exe",
        parallel: "客户端按 parts[].connections 开并行 Range 连接，并轮询到 urls[] 里的不同源"
      }
    }' > "$MANIFEST_PATH" || die "写清单失败"
  cp -f "$MANIFEST_PATH" "$DIST_DIR/manifest.json" || die "写 $DIST_DIR/manifest.json 失败"
  info "sha256      = $sha"
  info "bytes       = $bytes"
}

# ---- SSH / SCP 参数 ------------------------------------------------------------
SSH_OPTS=(-p "$CONCAT_ENGINE_DEPLOY_PORT" -i "$CONCAT_ENGINE_DEPLOY_KEY"
          -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new)
# scp 的端口开关是大写 -P（小写 -p 是「保留时间戳」，会被误当文件名）
SCP_OPTS=(-P "$CONCAT_ENGINE_DEPLOY_PORT" -i "$CONCAT_ENGINE_DEPLOY_KEY"
          -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new)

# ---- 单台上传（幂等：远端同 sha256 就跳过）------------------------------------
# 发布文件清单：PUBLISH_NAMES[i] 是远端文件名，PUBLISH_PATHS[i] 是本地路径。
# 两个文件：便携 zip、引擎清单。
deploy_one_host() {
  local h="$1" remote_dir="$2" status_file="$3"
  local user="$CONCAT_ENGINE_DEPLOY_USER"
  local remote_sums name local_sha remote_sha i

  if ! ssh "${SSH_OPTS[@]}" "$user@$h" "mkdir -p '$remote_dir'" >/dev/null 2>&1; then
    echo "unreachable" > "$status_file"; return 0
  fi

  # 一次 SSH 拿到远端所有文件的 sha256
  remote_sums="$(ssh "${SSH_OPTS[@]}" "$user@$h" \
      "cd '$remote_dir' 2>/dev/null && sha256sum ${PUBLISH_NAMES[*]} 2>/dev/null" 2>/dev/null | tr -d '\r')"

  local uploaded=0
  for i in "${!PUBLISH_NAMES[@]}"; do
    name="${PUBLISH_NAMES[$i]}"
    local_sha="$(sha256sum "${PUBLISH_PATHS[$i]}" | awk '{print $1}')"
    remote_sha="$(printf '%s\n' "$remote_sums" | awk -v n="$name" '$2==n{print $1; exit}')"
    [ "$remote_sha" = "$local_sha" ] && continue
    if ! scp "${SCP_OPTS[@]}" "${PUBLISH_PATHS[$i]}" "$user@$h:$remote_dir/$name" >/dev/null 2>&1; then
      echo "upload-failed:$name" > "$status_file"; return 0
    fi
    uploaded=1
  done
  [ "$uploaded" -eq 0 ] && { echo "uptodate" > "$status_file"; return 0; }

  # 上传后立刻校验（每台 1 次 SSH，批量比对所有文件）
  remote_sums="$(ssh "${SSH_OPTS[@]}" "$user@$h" \
      "cd '$remote_dir' && sha256sum ${PUBLISH_NAMES[*]}" 2>/dev/null | tr -d '\r')"
  for i in "${!PUBLISH_NAMES[@]}"; do
    name="${PUBLISH_NAMES[$i]}"
    local_sha="$(sha256sum "${PUBLISH_PATHS[$i]}" | awk '{print $1}')"
    remote_sha="$(printf '%s\n' "$remote_sums" | awk -v n="$name" '$2==n{print $1; exit}')"
    if [ "$remote_sha" != "$local_sha" ]; then
      echo "mismatch:$name" > "$status_file"; return 0
    fi
  done
  echo "uploaded" > "$status_file"
}

# ---- 上传（各节点并发 scp + 逐台 sha256 比对）--------------------------------
deploy() {
  say "上传到 CDN 节点"
  local remote_dir="${CONCAT_ENGINE_WEB_ROOT%/}/$REMOTE_SUBDIR"

  # 发布清单：便携 zip + 引擎清单
  PUBLISH_NAMES=("$ZIP_NAME" "manifest.json")
  PUBLISH_PATHS=("$ZIP_PATH" "$MANIFEST_PATH")

  IFS=',' read -r -a hosts <<< "$CONCAT_ENGINE_DEPLOY_HOSTS"
  local -a hlist=() pids=()
  local h p st
  for h in "${hosts[@]}"; do
    [ -n "$h" ] && hlist+=("$h")
  done
  [ "${#hlist[@]}" -gt 0 ] || die "没有配置上传节点（CONCAT_ENGINE_DEPLOY_HOSTS）"

  local status_dir; status_dir="$(mktemp -d)"
  say "并发上传 ${#hlist[@]} 台（每台 1 次状态查询 + 按需上传 + 1 次校验）；文件：${PUBLISH_NAMES[*]}"
  for h in "${hlist[@]}"; do
    deploy_one_host "$h" "$remote_dir" "$status_dir/$h" &
    pids+=("$!")
  done
  for p in "${pids[@]}"; do wait "$p"; done

  local ok=0 failed=0 skipped=0
  for h in "${hlist[@]}"; do
    st="$(cat "$status_dir/$h" 2>/dev/null || echo unknown)"
    case "$st" in
      uploaded)   ok=$((ok+1)); info "$h 上传完成，sha256 一致 ✓" ;;
      uptodate)   ok=$((ok+1)); skipped=$((skipped+1)); info "$h 已是同 sha256，跳过上传 ✓" ;;
      unreachable) failed=$((failed+1)); warn "$h 不可达，跳过" ;;
      *)          failed=$((failed+1)); warn "$h 上传/校验失败（$st）" ;;
    esac
  done
  rm -rf "$status_dir"

  # 根目录再放一份「最新版本」清单，客户端按需下载时读它
  for h in "${hlist[@]}"; do
    ssh "${SSH_OPTS[@]}" "$CONCAT_ENGINE_DEPLOY_USER@$h" \
      "mkdir -p '${CONCAT_ENGINE_WEB_ROOT%/}/concat-engine' && \
       cp -f '$remote_dir/manifest.json' '${CONCAT_ENGINE_WEB_ROOT%/}/concat-engine/manifest.json'" \
      2>/dev/null || warn "$h 写最新清单失败"
  done

  [ "$ok" -gt 0 ] || die "没有任何节点上传成功（可达 0 台）——不发布"
  info "成功 $ok 台（其中 $skipped 台已是同版本跳过），失败 $failed 台"
  [ "$failed" -eq 0 ] || warn "有 $failed 台失败；容灾切换要求逐台一致，失败节点要人工核对"
}

# ---- 远端校验（--verify-only）-----------------------------------------------
verify_remote() {
  say "校验远端已发布产物"
  local remote_dir="${CONCAT_ENGINE_WEB_ROOT%/}/$REMOTE_SUBDIR"
  local local_sha; local_sha="$(sha256sum "$ZIP_PATH" 2>/dev/null | awk '{print $1}')"
  [ -n "$local_sha" ] || die "--verify-only 需要本地已有产物：$ZIP_PATH"
  IFS=',' read -r -a hosts <<< "$CONCAT_ENGINE_DEPLOY_HOSTS"
  local h
  for h in "${hosts[@]}"; do
    [ -n "$h" ] || continue
    local remote_sha
    remote_sha="$(ssh "${SSH_OPTS[@]}" "$CONCAT_ENGINE_DEPLOY_USER@$h" \
        "sha256sum '$remote_dir/$ZIP_NAME' 2>/dev/null | awk '{print \$1}'" 2>/dev/null | tr -d '\r')"
    if [ "$remote_sha" = "$local_sha" ]; then info "   $h 一致 ✓"; else warn "   $h 不一致或缺失"; fi
  done
}

# ---- HTTP 逐台探活（--verify-http）-------------------------------------------
# 文件在磁盘上 ≠ 节点能对外供文件：这四台里有一台只服务 HTTP、一台的 80 端口
# 只做 301 跳转、一台是故意挂的故障节点。所以探活要逐 IP、逐 scheme 打，
# 并且不跟随重定向（跟随了会把只跳 301 的节点误判成健康节点）。
verify_http() {
  say "HTTP 逐台探活（--resolve 指定 IP，绕开 DNS 轮询）"
  command -v curl >/dev/null 2>&1 || die "找不到 curl"
  local base="${CONCAT_ENGINE_BASE_URL%/}"
  local host scheme port code
  host="$(printf '%s' "$base" | sed -E 's#^https?://([^/]+).*#\1#')"

  IFS=',' read -r -a hosts <<< "$CONCAT_ENGINE_DEPLOY_HOSTS"
  local h
  for h in "${hosts[@]}"; do
    [ -n "$h" ] || continue
    for scheme in https http; do
      port=443; [ "$scheme" = "http" ] && port=80
      # 清单：期望 200
      code="$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' \
             --resolve "$host:$port:$h" "$scheme://$host/$ENGINE_ROOT/manifest.json" 2>/dev/null)" || code="ERR"
      if [ "$code" = "200" ]; then
        info "   $h $scheme 清单 200 ✓"
      else
        warn "   $h $scheme 清单 $code ✗"
        continue
      fi
      # 分片：Range 期望 206 —— 没有 206 就没有并行 Range 下载
      code="$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' -r 0-0 \
             --resolve "$host:$port:$h" "$scheme://$host/$REMOTE_SUBDIR/$ZIP_NAME" 2>/dev/null)" || code="ERR"
      if [ "$code" = "206" ]; then
        info "   $h $scheme 分片 Range 206 ✓（可并行 Range）"
      else
        warn "   $h $scheme 分片 Range $code ✗（只能单连接下载）"
      fi
    done
  done
}

# ---- 本地产物是否仍然有效（幂等：上游输入没变就不重下不重打包）---------------
write_meta() {
  jq -n --arg version "$VERSION" --arg archive_sha "$ARCHIVE_SHA" \
        --arg zip_sha "$(sha256sum "$ZIP_PATH" | awk '{print $1}')" \
        --argjson bytes "$(stat -c%s "$ZIP_PATH")" \
        '{version:$version, archive_sha:$archive_sha, zip_sha:$zip_sha, bytes:$bytes}' \
        > "$META_PATH" || warn "写 meta 失败（不影响发布）"
}

local_artifact_current() {
  [ -f "$ZIP_PATH" ] || return 1
  [ -f "$META_PATH" ] || return 1
  local m_archive m_zip
  m_archive="$(jq -r '.archive_sha // empty' "$META_PATH" 2>/dev/null)"
  m_zip="$(jq -r '.zip_sha // empty' "$META_PATH" 2>/dev/null)"
  [ -n "$m_archive" ] && [ "$m_archive" = "$ARCHIVE_SHA" ] || return 1
  [ -n "$m_zip" ] || return 1
  [ "$(sha256sum "$ZIP_PATH" | awk '{print $1}')" = "$m_zip" ] || return 1
  return 0
}

# ---- 主流程 ------------------------------------------------------------------
mkdir -p "$CONCAT_ENGINE_OUT_DIR" "$WORK_DIR"

free_mb="$(df -Pm "$CONCAT_ENGINE_OUT_DIR" | awk 'NR==2{print $4}')"
[ "${free_mb:-0}" -ge "$CONCAT_ENGINE_MIN_FREE_MB" ] \
  || die "磁盘可用 ${free_mb}MB，不足 ${CONCAT_ENGINE_MIN_FREE_MB}MB（上游包 114MB + 解包 + zip）"

if [ "$VERIFY_ONLY" -eq 1 ]; then
  verify_remote
  [ "$VERIFY_HTTP" -eq 1 ] && verify_http
  exit $?
fi

if [ "$DO_BUILD" -eq 1 ]; then
  if local_artifact_current; then
    info "复用已有产物（上游安装包未变，sha256 一致）：$ZIP_PATH"
  else
    INSTALLER="$(download_and_verify)"
    build_portable_zip "$INSTALLER"
    write_meta
  fi
  write_manifest
else
  [ -f "$ZIP_PATH" ] || die "--no-build 需要已存在的产物：$ZIP_PATH"
  info "复用已有产物：$ZIP_PATH"
  write_manifest
fi

if [ "$DO_UPLOAD" -eq 1 ]; then
  deploy
else
  info "未指定 --upload，只在本地构建，未发布任何东西"
fi

[ "$VERIFY_HTTP" -eq 1 ] && verify_http

[ "$KEEP_WORK" -eq 1 ] || rm -rf "$WORK_DIR/extract" "$WORK_DIR/stage"

say "完成"
info "产物 = $ZIP_PATH"
info "清单 = $MANIFEST_PATH"
[ "$DO_UPLOAD" -eq 1 ] && info "已发布到 ${CONCAT_ENGINE_WEB_ROOT%/}/$REMOTE_SUBDIR"

# 客户端接线用的 manifest 地址（逗号分隔多节点）：客户端逐个尝试，
# 取到清单后再按 parts[].urls 里的源并行 Range 下载。客户端侧的下载器
# 还没接线（backlog B-008 步骤 6），这里先把地址口径固定下来。
manifest_urls=()
for u in "${CONCAT_ENGINE_BASE_URL%/}" "${MIRROR_LIST[@]}"; do
  [ -n "$u" ] || continue
  manifest_urls+=("${u%/}/$ENGINE_ROOT/manifest.json")
done
say "客户端接线用地址"
info "$(IFS=,; echo "${manifest_urls[*]}")"
info "（客户端下载器尚未接线，见 backlog B-008 步骤 6）"
exit 0
