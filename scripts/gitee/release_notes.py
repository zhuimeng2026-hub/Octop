#!/usr/bin/env python3
"""Build the Gitee release notes from a GitHub release.

    python3 scripts/gitee/release_notes.py --repo TencentCloud/Octop --tag v1.4.0 --out notes.md

The upstream release body is kept as-is; two sections are appended:

* what Gitee actually carries (the slim installers) and the fact that they
  fetch the runtime on first launch;
* the assets that are too large for a Gitee attachment, with links.

Gitee caps one attachment at 100 MB, so the split is not a choice — see
docs/gitee-release.md.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

GITEE_ATTACHMENT_LIMIT_MB = 100
GITEE_ATTACHMENT_LIMIT_BYTES = GITEE_ATTACHMENT_LIMIT_MB * 1024 * 1024
DOWNLOAD_BASE = "https://github.com/{repo}/releases/download/{tag}"


def is_small(asset: dict) -> bool:
    """Gitee takes one attachment up to 100 MB; bigger ones stay on GitHub/COS."""
    return asset.get("size", 0) < GITEE_ATTACHMENT_LIMIT_BYTES


def fetch_release(repo: str, tag: str) -> dict:
    url = f"https://api.github.com/repos/{repo}/releases/tags/{tag}"
    request = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json"})
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"cannot read the GitHub release {repo}@{tag}: HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"cannot reach api.github.com: {exc.reason}") from exc


def build(release: dict, repo: str, tag: str) -> str:
    body = (release.get("body") or "").strip()
    assets = release.get("assets") or []
    small = [a for a in assets if is_small(a)]
    large = [a for a in assets if not is_small(a)]

    lines: list[str] = []
    if body:
        lines += [body, ""]
    else:
        lines += [f"Octop {tag}", ""]

    lines += ["## Gitee 上的安装包", ""]
    if small:
        lines += ["以下产物已上传到 Gitee：", ""]
        for asset in sorted(small, key=lambda a: a["name"]):
            lines.append(f"- {asset['name']}（{asset['size'] / 1024 / 1024:.0f} MB）")
        lines.append("")
    desktop = [a for a in small if a["name"].startswith("Octop-desktop")]
    if any("slim" in a["name"] for a in desktop):
        lines += [
            "**slim 版**安装包只含桌面外壳（不含 Python 运行时），"
            "**首次启动会从 CDN 下载约 215 MB 的运行时**并解包到本地，此后离线可用。"
            "首次启动需要联网；下载失败时重启客户端会重新下载。",
            "",
        ]
    if any("slim" not in a["name"] for a in desktop):
        lines += [
            "**远程版**安装包连接已经部署好的 Octop 服务，不需要在本地安装 Python 运行时。",
            "",
        ]
    if any(a["name"].endswith((".whl", ".tar.gz")) for a in small):
        lines += [
            "`octop-*.whl` / `octop-*.tar.gz` 是 Python 包，用 `pip install octop` 安装服务端。",
            "",
        ]

    if large:
        lines += [
            f"## 完整安装包（超过 {GITEE_ATTACHMENT_LIMIT_MB} MB，未上传到 Gitee）",
            "",
            "Gitee 单个附件上限 "
            f"{GITEE_ATTACHMENT_LIMIT_MB} MB，以下产物只在 GitHub Release 提供：",
            "",
        ]
        base = DOWNLOAD_BASE.format(repo=repo, tag=tag)
        for asset in sorted(large, key=lambda a: a["name"]):
            name = asset["name"]
            lines.append(
                f"- {name}（{asset['size'] / 1024 / 1024:.0f} MB） — [GitHub]({base}/{name})"
            )
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo", required=True, help="GitHub repo (owner/repo) holding the release"
    )
    parser.add_argument("--tag", required=True, help="release tag, e.g. v1.4.0")
    parser.add_argument("--out", required=True, help="file to write the notes to")
    args = parser.parse_args()

    release = fetch_release(args.repo, args.tag)
    notes = build(release, args.repo, args.tag)
    with open(args.out, "w", encoding="utf-8") as handle:
        handle.write(notes)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
