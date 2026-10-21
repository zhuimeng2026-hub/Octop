"""Mounting Octop under a URL path prefix (e.g. ``/videogen``)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from tests.support.app import octop_client, write_octop_config


async def test_api_answers_only_under_the_prefix(tmp_octop_home: Any) -> None:
    """A prefixed deployment serves the API under the prefix, 404s elsewhere."""
    write_octop_config(tmp_octop_home, base_path="/videogen")
    async with octop_client(tmp_octop_home) as (client, _srv):
        prefixed = await client.get("/videogen/api/health")
        root = await client.get("/api/health")
        assert prefixed.status_code == 200
        assert root.status_code == 404


async def test_prefix_routes_to_the_api_not_the_spa(tmp_octop_home: Any) -> None:
    """The prefix is a real mount point, not a catch-all for every path."""
    write_octop_config(tmp_octop_home, base_path="/videogen")
    async with octop_client(tmp_octop_home) as (client, _srv):
        resp = await client.get("/videogen/api/health")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("application/json")
        # An unrelated prefix must not resolve to the health endpoint.
        other = await client.get("/other/api/health")
        assert other.status_code != 200 or "application/json" not in other.headers.get(
            "content-type", ""
        )


async def test_setup_status_reports_under_prefix(tmp_octop_home: Any) -> None:
    write_octop_config(tmp_octop_home, base_path="/videogen")
    async with octop_client(tmp_octop_home) as (client, _srv):
        resp = await client.get("/videogen/api/setup/status")
        assert resp.status_code == 200
        assert "setup_required" in resp.json()


def test_config_file_keeps_base_path(tmp_octop_home: Path) -> None:
    write_octop_config(tmp_octop_home, base_path="/videogen")
    data = json.loads((tmp_octop_home / "config.json").read_text(encoding="utf-8"))
    assert data["base_path"] == "/videogen"


@pytest.mark.parametrize("value", ["", "/", "videogen", "/videogen/"])
def test_base_path_normalization(value: str) -> None:
    from octop.config import _normalize_base_path

    assert _normalize_base_path(value) in {"", "/videogen"}
