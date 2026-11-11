#!/usr/bin/env bash
# Upload a file to a GitHub release.
#
#   scripts/gitee/upload_release_asset.sh <release-id> <file> [name]
#
# The token is read from ~/.github_token, $GH_TOKEN or ~/.git-credentials.
set -euo pipefail

release_id="${1:-}"
path="${2:-}"
name="${3:-}"

[[ -n "$release_id" && -n "$path" && -f "$path" ]] || {
  echo "usage: $0 <release-id> <file> [name]" >&2
  exit 2
}
name="${name:-$(basename "$path")}"

gh_token="${GH_TOKEN:-}"
if [[ -z "$gh_token" && -f "${HOME}/.github_token" ]]; then
  gh_token="$(head -1 "${HOME}/.github_token" | tr -d '[:space:]')"
fi
if [[ -z "$gh_token" && -f "${HOME}/.git-credentials" ]]; then
  gh_token="$(python3 - "${HOME}/.git-credentials" <<'PY'
import re, sys
for line in open(sys.argv[1], encoding="utf-8", errors="replace"):
    m = re.search(r"https://[^:]+:([^@]+)@github\.com", line)
    if m:
        print(m.group(1))
        break
PY
)"
fi
[[ -n "$gh_token" ]] || { echo "::error::no GitHub token" >&2; exit 1; }

size="$(wc -c < "$path" | tr -d ' ')"
echo "Uploading ${name} ($((size / 1024 / 1024)) MB)"
code="$(curl -s -o /tmp/asset_upload.out -w "%{http_code}" --max-time 3600 \
  -X POST \
  -H "Authorization: Bearer ${gh_token}" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@${path}" \
  "https://uploads.github.com/repos/zhuimeng2026-hub/Octop/releases/${release_id}/assets?name=${name}")"
if [[ "$code" != "201" && "$code" != "200" ]]; then
  echo "::error::upload failed (HTTP ${code})" >&2
  head -c 400 /tmp/asset_upload.out >&2
  exit 1
fi
python3 -c "
import json,sys
d=json.load(open('/tmp/asset_upload.out'))
print('  ✓ %s  %s  browser_download=%s' % (d.get('name'), d.get('size'), d.get('browser_download_url')))
" 2>/dev/null || head -c 200 /tmp/asset_upload.out
