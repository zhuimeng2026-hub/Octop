"""Unit tests for the deployment base-path helpers."""

from __future__ import annotations

import pytest

from octop.infra.base_path import (
    apply_base_path,
    current_base_path,
    normalize_base_path,
    prefix_base_path,
    set_base_path,
    strip_base_path,
    strip_current_base_path,
)


@pytest.fixture(autouse=True)
def _reset_base_path():
    yield
    set_base_path("")


def test_normalize_empty_is_root_deployment() -> None:
    assert normalize_base_path("") == ""
    assert normalize_base_path(None) == ""
    assert normalize_base_path("   ") == ""


def test_normalize_adds_leading_slash_and_drops_trailing_slash() -> None:
    assert normalize_base_path("videogen") == "/videogen"
    assert normalize_base_path("/videogen") == "/videogen"
    assert normalize_base_path("/videogen/") == "/videogen"
    assert normalize_base_path("//a//b//") == "/a/b"


def test_normalize_rejects_relative_segments_and_queries() -> None:
    with pytest.raises(ValueError):
        normalize_base_path("/a/../b")
    with pytest.raises(ValueError):
        normalize_base_path("/a?b=1")
    with pytest.raises(ValueError):
        normalize_base_path("/a#frag")


def test_strip_base_path() -> None:
    assert strip_base_path("/videogen/api/health", "/videogen") == "/api/health"
    assert strip_base_path("/videogen", "/videogen") == "/"
    assert strip_base_path("/videogen/", "/videogen") == "/"
    assert strip_base_path("/api/health", "/videogen") is None
    # A path that merely starts with the same characters is outside the prefix.
    assert strip_base_path("/videogenx/api/health", "/videogen") is None
    assert strip_base_path("/api/health", "") == "/api/health"


def test_prefix_base_path() -> None:
    assert prefix_base_path("/api/x", "/videogen") == "/videogen/api/x"
    assert prefix_base_path("/api/x", "") == "/api/x"
    # Non-path values (absolute URLs) pass through untouched.
    assert prefix_base_path("https://example.com/x", "/videogen") == "https://example.com/x"


def test_process_wide_base_path_round_trip() -> None:
    assert set_base_path("videogen/") == "/videogen"
    assert current_base_path() == "/videogen"
    assert apply_base_path("/api/x") == "/videogen/api/x"
    # Idempotent — applying twice does not double the prefix.
    assert apply_base_path(apply_base_path("/api/x")) == "/videogen/api/x"
    assert strip_current_base_path("/videogen/api/x") == "/api/x"
    assert strip_current_base_path("/api/x") == "/api/x"
    set_base_path("")
    assert current_base_path() == ""
    assert apply_base_path("/api/x") == "/api/x"
