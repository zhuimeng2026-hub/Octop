#!/usr/bin/env bash
# Publish release assets to a Gitee release.
#
#   scripts/gitee/publish_release.sh --tag v1.4.0 --owner <owner> --repo <repo> \
#       --token <token> --assets-dir <dir> [--body-file <file>] [--max-size-mb 100]
#
# Gitee caps a single release attachment at 100 MB, so only files below the
# limit are uploaded. Larger ones are reported so the caller can list them as
# external links (GitHub Release / COS) in the release body.
#
# The tag must exist in the Gitee repository. When the local checkout knows the
# tag, the script creates the missing Gitee ref from it; otherwise push the tag
# to Gitee first. Use --base-sha to point the tag at a commit that already
# exists in the Gitee repository — the way to publish binaries from a release
# repository that does not carry the source code.
set -euo pipefail

API_BASE="${GITEE_API_BASE:-https://gitee.com/api/v5}"
MAX_SIZE_MB="${GITEE_MAX_SIZE_MB:-100}"

usage() {
  echo "usage: $0 --tag <v1.2.3> --owner <owner> --repo <repo> --token <token> --assets-dir <dir> [--body-file <file>] [--max-size-mb <n>] [--base-sha <sha>]" >&2
  exit 2
}

tag=""
owner=""
repo=""
token=""
assets_dir=""
body_file=""
base_sha=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) tag="$2"; shift 2 ;;
    --owner) owner="$2"; shift 2 ;;
    --repo) repo="$2"; shift 2 ;;
    --token) token="$2"; shift 2 ;;
    --assets-dir) assets_dir="$2"; shift 2 ;;
    --body-file) body_file="$2"; shift 2 ;;
    --max-size-mb) MAX_SIZE_MB="$2"; shift 2 ;;
    --base-sha) base_sha="$2"; shift 2 ;;
    *) usage ;;
  esac
done

[[ -n "$tag" && -n "$owner" && -n "$repo" && -n "$assets_dir" ]] || usage
# Token: --token wins, then $GITEE_TOKEN, then ~/.gitee_token.
if [[ -z "$token" ]]; then
  token="${GITEE_TOKEN:-}"
fi
if [[ -z "$token" && -f "${HOME}/.gitee_token" ]]; then
  token="$(tr -d '[:space:]' < "${HOME}/.gitee_token")"
fi
[[ -n "$token" ]] || {
  echo "::error::no Gitee token: pass --token, set GITEE_TOKEN, or write it to ~/.gitee_token" >&2
  exit 1
}
if [[ ! "$tag" =~ ^v[0-9][0-9A-Za-z.+_-]*$ ]]; then
  echo "::error::invalid tag: ${tag}" >&2
  exit 1
fi
if [[ ! -d "$assets_dir" ]]; then
  echo "::error::assets directory does not exist: ${assets_dir}" >&2
  exit 1
fi
if [[ ! "$MAX_SIZE_MB" =~ ^[0-9]+$ ]] || [[ "$MAX_SIZE_MB" -le 0 ]]; then
  echo "::error::invalid --max-size-mb: ${MAX_SIZE_MB}" >&2
  exit 1
fi
max_bytes=$((MAX_SIZE_MB * 1024 * 1024))

body=""
if [[ -n "$body_file" ]]; then
  if [[ ! -f "$body_file" ]]; then
    echo "::error::body file does not exist: ${body_file}" >&2
    exit 1
  fi
  body="$(cat "$body_file")"
fi

api() {
  # api <method> <path> [curl args...]
  local method="$1"
  local path="$2"
  shift 2
  curl -sS -w '\n%{http_code}' -X "$method" \
    -H "Authorization: token ${token}" \
    "$@" \
    "${API_BASE}${path}"
}

# api_json <method> <path> <json-body> -> prints the response body
api_json() {
  local method="$1"
  local path="$2"
  local payload="$3"
  curl -sS -w '\n%{http_code}' -X "$method" \
    -H "Authorization: token ${token}" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    "${API_BASE}${path}"
}

status_of() {
  # The last line of api() is the HTTP status code.
  tail -n 1
}

body_of() {
  # Everything but the trailing status line.
  sed '$d'
}

# --- 1. find the release (Gitee answers 200 with a null body when the tag
#        exists but has no release yet) -------------------------------------
release_id=""
existing_assets=""
response="$(api GET "/repos/${owner}/${repo}/releases/tags/${tag}")"
if [[ "$(printf '%s' "$response" | status_of)" == "200" ]]; then
  release_id="$(printf '%s' "$response" | body_of | python3 -c 'import json,sys; d=json.load(sys.stdin) or {}; print(d.get("id",""))')"
  existing_assets="$(printf '%s' "$response" | body_of | python3 -c 'import json,sys; d=json.load(sys.stdin) or {}; print("\n".join(a["name"] for a in d.get("assets",[])))')"
fi

if [[ -n "$release_id" ]]; then
  echo "Reusing the existing Gitee release ${release_id} for ${tag}"
else
  # The tag may already exist (pushed over SSH). Creating a release then
  # creates the tag as well, so only pass a target when the tag is missing.
  tag_exists="no"
  response="$(api GET "/repos/${owner}/${repo}/tags")"
  if [[ "$(printf '%s' "$response" | status_of)" == "200" ]]; then
    if printf '%s' "$response" | body_of | python3 -c 'import json,sys; sys.exit(0 if any(t.get("name")==sys.argv[1] for t in (json.load(sys.stdin) or [])) else 1)' "$tag"; then
      tag_exists="yes"
    fi
  fi

  target="$base_sha"
  if [[ -z "$target" && "$tag_exists" != "yes" ]]; then
    target="$(git rev-parse --verify "${tag}^{commit}" 2>/dev/null || true)"
  fi
  if [[ -z "$target" && "$tag_exists" != "yes" ]]; then
    echo "::error::cannot decide what ${tag} should point at." >&2
    echo "  Pass --base-sha <sha>, or push the tag to Gitee first: git push gitee ${tag}" >&2
    exit 1
  fi
  echo "Creating the Gitee release ${tag}${target:+ at ${target}}"
  payload="$(python3 -c 'import json,sys; p={"tag_name": sys.argv[1], "name": sys.argv[1], "body": sys.argv[2], "prerelease": False}; p.update({"target_commitish": sys.argv[3]}) if sys.argv[3] else None; print(json.dumps(p))' "$tag" "$body" "$target")"
  response="$(api_json POST "/repos/${owner}/${repo}/releases" "$payload")"
  status="$(printf '%s' "$response" | status_of)"
  if [[ "$status" != "201" && "$status" != "200" ]]; then
    echo "::error::could not create the release (HTTP ${status})" >&2
    printf '%s\n' "$response" | body_of >&2
    exit 1
  fi
  release_id="$(printf '%s' "$response" | body_of | python3 -c 'import json,sys; print((json.load(sys.stdin) or {}).get("id",""))')"
fi

if [[ -z "$release_id" ]]; then
  echo "::error::the Gitee release has no id" >&2
  exit 1
fi

# --- 3. upload the attachments that fit ------------------------------------
uploaded=()
skipped=()
shopt -s nullglob
for path in "$assets_dir"/*; do
  [[ -f "$path" ]] || continue
  name="$(basename "$path")"
  size="$(wc -c < "$path" | tr -d ' ')"
  if [[ "$size" -gt "$max_bytes" ]]; then
    skipped+=("${name} ($((size / 1024 / 1024)) MB)")
    continue
  fi
  if printf '%s\n' "$existing_assets" | grep -Fxq "$name"; then
    echo "Already attached: ${name}"
    continue
  fi
  echo "Uploading ${name} ($((size / 1024 / 1024)) MB)"
  code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
    -H "Authorization: token ${token}" \
    -F "file=@${path}" \
    "${API_BASE}/repos/${owner}/${repo}/releases/${release_id}/attach_files")"
  if [[ "$code" != "201" && "$code" != "200" ]]; then
    echo "::error::attach failed for ${name} (HTTP ${code})" >&2
    exit 1
  fi
  uploaded+=("$name")
done
shopt -u nullglob

echo "Uploaded ${#uploaded[@]} file(s) to https://gitee.com/${owner}/${repo}/releases/tag/${tag}"
if [[ ${#skipped[@]} -gt 0 ]]; then
  echo "Skipped (larger than ${MAX_SIZE_MB} MB, link them from the release body):"
  for name in "${skipped[@]}"; do
    echo "  - ${name}"
  done
fi
