"""tests/unit/test_gitee_release_assets.py"""

from __future__ import annotations

import importlib.util
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parents[2] / "scripts" / "gitee"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, _SCRIPTS / f"{name}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _asset(name: str, size: int) -> dict:
    return {"name": name, "size": size, "browser_download_url": f"https://example/{name}"}


MB = 1024 * 1024


def test_platform_of_reads_the_name() -> None:
    assets = _load("assets")
    assert assets.platform_of("Octop-desktop-slim-windows-amd64-1.4.0.exe") == "windows"
    assert assets.platform_of("Octop-desktop-darwin-arm64-1.4.0.dmg") == "darwin"
    assert assets.platform_of("Octop-desktop-linux-amd64-1.4.0.tar.gz") == "linux"
    assert assets.platform_of("octop-1.4.0-py3-none-any.whl") is None
    assert assets.platform_of("Octop-fnos-docker-1.4.0.fpk") is None


def test_matches_platform_keeps_the_platform_neutral_assets() -> None:
    assets = _load("assets")
    assert assets.matches_platform("Octop-desktop-windows-amd64-1.4.0.exe", "windows")
    assert not assets.matches_platform("Octop-desktop-darwin-arm64-1.4.0.dmg", "windows")
    assert assets.matches_platform("octop-1.4.0-py3-none-any.whl", "windows")
    assert assets.matches_platform("Octop-desktop-darwin-arm64-1.4.0.dmg", "all")


def test_select_splits_by_size_and_platform() -> None:
    assets = _load("assets")
    release_assets = [
        _asset("Octop-desktop-slim-windows-amd64-1.4.0.exe", 20 * MB),
        _asset("Octop-desktop-slim-darwin-arm64-1.4.0.dmg", 20 * MB),
        _asset("Octop-portable-windows-amd64-1.4.0.zip", 290 * MB),
        _asset("octop-1.4.0-py3-none-any.whl", 22 * MB),
    ]
    small, large = assets.select(release_assets, "windows")
    assert [a["name"] for a in small] == [
        "Octop-desktop-slim-windows-amd64-1.4.0.exe",
        "octop-1.4.0-py3-none-any.whl",
    ]
    assert [a["name"] for a in large] == ["Octop-portable-windows-amd64-1.4.0.zip"]

    small_all, large_all = assets.select(release_assets, "all")
    assert len(small_all) == 3
    assert len(large_all) == 1


def test_release_notes_point_at_the_github_runtime() -> None:
    notes = _load("release_notes")
    release = {
        "body": "Octop 1.4.0",
        "assets": [
            _asset("Octop-desktop-slim-windows-amd64-1.4.0.exe", 20 * MB),
            _asset("Octop-portable-windows-amd64-1.4.0.zip", 290 * MB),
        ],
    }
    text = notes.build(release, "owner/repo", "v1.4.0", "windows")
    assert "首次启动会从 GitHub Release 下载约 213 MB 的运行时" in text
    assert "CDN" not in text
    assert "Octop-portable-windows-amd64-1.4.0.zip" in text
    assert "https://github.com/owner/repo/releases/download/v1.4.0" in text


def test_release_notes_link_the_components_from_gitee() -> None:
    """组件在 Gitee 上，链接就不能把读者送到 GitHub。"""
    notes = _load("release_notes")
    release = {
        "body": "",
        "assets": [_asset("Octop-video-components-windows-x64-1.4.0.exe", 72 * MB)],
    }
    text = notes.build(release, "owner/repo", "v1.4.0", "windows")
    assert (
        "https://gitee.com/webheat/octop_client/releases/download/v1.4.0/"
        "Octop-video-components-windows-x64-1.4.0.exe"
    ) in text
    assert "github.com" not in text


def test_release_notes_leave_the_other_platforms_out() -> None:
    notes = _load("release_notes")
    release = {
        "body": "",
        "assets": [
            _asset("Octop-desktop-slim-windows-amd64-1.4.0.exe", 20 * MB),
            _asset("Octop-desktop-slim-darwin-arm64-1.4.0.dmg", 20 * MB),
        ],
    }
    text = notes.build(release, "owner/repo", "v1.4.0", "windows")
    assert "Octop-desktop-slim-windows-amd64-1.4.0.exe" in text
    assert "darwin" not in text
