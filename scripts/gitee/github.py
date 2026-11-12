"""Read a GitHub release.

Shared by the release notes and the asset listing: both need the same
release, and both should authenticate the same way.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request


def fetch_release(repo: str, tag: str) -> dict:
    """The GitHub release ``repo@tag`` as a dict."""
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
