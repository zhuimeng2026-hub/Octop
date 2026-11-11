#!/usr/bin/env python3
"""Build the Gitee release notes from a GitHub release.

    python3 scripts/gitee/release_notes.py --repo TencentCloud/Octop --tag v1.4.0 --out notes.md

The upstream release body is kept as-is; two sections are appended:

* what Gitee actually carries (this round: the Windows slim installers) and
  the fact that they fetch the runtime on first launch;
* the assets that are too large for a Gitee attachment, with links.

Gitee caps one attachment at 100 MB, so the split is not a choice — see
docs/gitee-release.md.
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from assets import GITEE_ATTACHMENT_LIMIT_MB, select  # noqa: E402
from github import fetch_release  # noqa: E402

DOWNLOAD_BASE = "https://github.com/{repo}/releases/download/{tag}"
# Assets that fit a Gitee attachment are served from Gitee itself, so the
# notes link to Gitee and never send the reader to GitHub for them.
GITEE_DOWNLOAD_BASE = "https://gitee.com/{owner}/{repo}/releases/download/{tag}"


def build(
    release: dict,
    repo: str,
    tag: str,
    platform: str | None,
    gitee_owner: str = "webheat",
    gitee_repo: str = "octop_client",
) -> str:
    body = (release.get("body") or "").strip()
    assets = release.get("assets") or []
    small, large = select(assets, platform)

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
    if any("slim" not in a["name"] for a in desktop):
        lines += [
            "**远程版**（推荐）安装包连接已经部署好的 Octop 服务，不需要在本地安装"
            " Python 运行时，装完即用。",
            "",
        ]
    if any("slim" in a["name"] for a in desktop):
        lines += [
            "**slim 版**安装包只含桌面外壳（不含 Python 运行时），"
            "**首次启动会从 GitHub Release 下载约 213 MB 的运行时**并解包到本地，"
            "此后离线可用。首次启动需要联网；下载中断后重启客户端会从断点继续。"
            "运行时下载支持断点续传。",
            "",
        ]
    components = [a for a in small if a["name"].startswith("Octop-video-components")]
    if components:
        base = GITEE_DOWNLOAD_BASE.format(owner=gitee_owner, repo=gitee_repo, tag=tag)
        lines += [
            "## 视频制作组件（另需安装）",
            "",
            "桌面客户端不自带视频渲染环境，两种客户端都要单独装一次。不装不影响登录、"
            "产品库和方案编辑，只是无法在本机出片。",
            "",
        ]
        for asset in sorted(components, key=lambda a: a["name"]):
            name = asset["name"]
            lines.append(
                f"- [{name}]({base}/{name})（{asset['size'] / 1024 / 1024:.0f} MB）"
                " — 默认选项安装，回到客户端点「重新检测」"
            )
        lines.append("")
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
    parser.add_argument(
        "--platform",
        default="windows",
        help="platform this round delivers (default: windows); 'all' keeps every asset",
    )
    parser.add_argument(
        "--gitee-owner",
        default="webheat",
        help="Gitee owner the release is published under (default: webheat)",
    )
    parser.add_argument(
        "--gitee-repo",
        default="octop_client",
        help="Gitee repo the release is published under (default: octop_client)",
    )
    args = parser.parse_args()

    release = fetch_release(args.repo, args.tag)
    notes = build(
        release,
        args.repo,
        args.tag,
        args.platform,
        gitee_owner=args.gitee_owner,
        gitee_repo=args.gitee_repo,
    )
    with open(args.out, "w", encoding="utf-8") as handle:
        handle.write(notes)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
