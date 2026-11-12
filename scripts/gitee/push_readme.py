#!/usr/bin/env python3
"""Push the download page to the Gitee repository.

    python3 scripts/gitee/push_readme.py --owner webheat --repo octop_client --token "$GITEE_TOKEN"

Updates README.md and README.en.md through the Gitee contents API and prints the
commit the default branch now points at — that commit is the one a release tag
should point at, so the Release page shows the download page instead of an
unrelated commit.

Files are only written when their content actually changed.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.request

API_BASE = os.environ.get("GITEE_API_BASE", "https://gitee.com/api/v5")
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_FILES = ["REPO_README.md", "REPO_README.en.md"]
TARGET_NAMES = ["README.md", "README.en.md"]
COMMIT_MESSAGE = "docs: 更新客户端下载页"


def request(method: str, path: str, token: str, payload: dict | None = None) -> tuple[int, object]:
    body = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(f"{API_BASE}{path}", data=body, method=method)
    req.add_header("Authorization", f"token {token}")
    req.add_header("Accept", "application/json")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            raw = response.read()
            return response.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            return exc.code, json.loads(raw)
        except json.JSONDecodeError:
            return exc.code, {"message": raw.decode(errors="replace")}


def repo_info(owner: str, repo: str, token: str) -> dict:
    status, data = request("GET", f"/repos/{owner}/{repo}", token)
    if status != 200:
        raise SystemExit(f"cannot read the repository {owner}/{repo}: HTTP {status} {data}")
    return data


def head_sha(owner: str, repo: str, token: str, branch: str) -> str:
    # Gitee has no git/refs read endpoint — the branch is the way in.
    status, data = request("GET", f"/repos/{owner}/{repo}/branches/{branch}", token)
    if status != 200:
        raise SystemExit(f"cannot read {branch} of {owner}/{repo}: HTTP {status} {data}")
    return data["commit"]["sha"]


def derive_asset_version(tag: str) -> str:
    """从 tag 推出产物文件名里的版本号。

    tag 形如 v1.4.0-gitee.1 → 1.4.0；v1.4.0 → 1.4.0。
    Gitee 试点构建的 tag 带 -gitee.N 后缀，但产物文件名里没有那段。
    """
    v = tag.strip().lstrip("v")
    for suffix in ("-gitee",):
        if suffix in v:
            v = v.split(suffix, 1)[0]
    return v.strip()


def render_template(text: str, owner: str, repo: str, tag: str, asset_version: str) -> str:
    """把内容源里的占位符替换成本次发布的版本信息。

    占位符：
      {{BASE_URL}}        → https://gitee.com/<owner>/<repo>/releases/download/<tag>
      {{TAG}}             → tag
      {{ASSET_VERSION}}   → 产物文件名里的版本号（1.4.0 这种）

    ⚠️ 为什么要占位符（2026-11-13 实测）：
    直链写死版本号的话，**下一次发版会把上一版的直链推上去**，
    用户从下载页点到的还是旧客户端。现在版本由发布时的 tag 决定。
    没给 --tag 时，残留占位符会被换成通用 Releases 链接（宁可少个直链，
    也不能把 {{...}} 原样推到线上）。
    """
    if not tag:
        # 没给 tag 就别给直链——指向「不存在的版本」的链接比没有链接更糟。
        # 带占位符的 markdown 链接降级成纯文字，其余占位符换成 Releases 页。
        out = re.sub(r"\[([^\]]+)\]\(([^)]*\{\{[^)]*)\)", r"\1", text)
        generic = "https://gitee.com/%s/%s/releases" % (owner, repo)
        out = (out.replace("{{BASE_URL}}", generic)
                  .replace("{{TAG}}", "")
                  .replace("{{ASSET_VERSION}}", ""))
        out = out.replace("{{", "").replace("}}", "")
        print("warning: no --tag given; download links degraded to plain text")
        return out
    base = "https://gitee.com/%s/%s/releases/download/%s" % (owner, repo, tag)
    out = (text.replace("{{BASE_URL}}", base)
               .replace("{{TAG}}", tag)
               .replace("{{ASSET_VERSION}}", asset_version))
    if "{{" in out:
        raise SystemExit("unresolved placeholder left in README source")
    return out


def push_file(owner: str, repo: str, token: str, branch: str, target: str, content: bytes) -> str:
    """Write content to target. Returns the new commit sha, or "" when unchanged."""

    status, existing = request("GET", f"/repos/{owner}/{repo}/contents/{target}", token)
    if status == 200:
        current = base64.b64decode(existing.get("content") or "")
        if current == content:
            print(f"{target}: unchanged")
            return ""
        payload = {
            "content": base64.b64encode(content).decode(),
            "message": COMMIT_MESSAGE,
            "branch": branch,
            "sha": existing["sha"],
        }
        # Gitee updates a file with PUT; PATCH is GitHub's verb and answers 405.
        method = "PUT"
    elif status == 404:
        payload = {
            "content": base64.b64encode(content).decode(),
            "message": COMMIT_MESSAGE,
            "branch": branch,
        }
        method = "POST"
    else:
        raise SystemExit(f"cannot read {target}: HTTP {status} {existing}")

    status, data = request(method, f"/repos/{owner}/{repo}/contents/{target}", token, payload)
    if status not in (200, 201):
        raise SystemExit(f"cannot write {target}: HTTP {status} {data}")
    print(f"{target}: updated")
    return data.get("commit", {}).get("sha", "")


def read_token() -> str:
    """--token wins, then $GITEE_TOKEN, then ~/.gitee_token."""
    token = os.environ.get("GITEE_TOKEN", "").strip()
    if not token:
        path = os.path.expanduser("~/.gitee_token")
        if os.path.isfile(path):
            with open(path, encoding="utf-8") as handle:
                token = handle.read().strip()
    return token


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner", required=True, help="Gitee repository owner")
    parser.add_argument("--repo", required=True, help="Gitee repository name")
    parser.add_argument(
        "--token", default="", help="Gitee access token (default: $GITEE_TOKEN or ~/.gitee_token)"
    )
    parser.add_argument("--dir", default=HERE, help="directory holding the README sources")
    parser.add_argument("--tag", default="", help="release tag being published (fills {{TAG}}/{{BASE_URL}}/{{ASSET_VERSION}})")
    parser.add_argument("--asset-version", default="", help="version used in asset file names (default: derived from --tag)")
    args = parser.parse_args()
    token = args.token or read_token()
    if not token:
        raise SystemExit("no token: pass --token, set GITEE_TOKEN, or write it to ~/.gitee_token")

    info = repo_info(args.owner, args.repo, token)
    branch = info.get("default_branch") or "master"

    asset_version = args.asset_version or (derive_asset_version(args.tag) if args.tag else "")
    for source_name, target in zip(DEFAULT_FILES, TARGET_NAMES, strict=True):
        source = os.path.join(args.dir, source_name)
        if not os.path.isfile(source):
            raise SystemExit(f"missing source file: {source}")
        with open(source, encoding="utf-8") as handle:
            text = handle.read()
        rendered = render_template(text, args.owner, args.repo, args.tag, asset_version)
        push_file(args.owner, args.repo, token, branch, target, rendered.encode("utf-8"))

    sha = head_sha(args.owner, args.repo, token, branch)
    print(sha)
    return 0


if __name__ == "__main__":
    sys.exit(main())
