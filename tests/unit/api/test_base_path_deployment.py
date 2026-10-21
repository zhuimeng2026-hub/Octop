"""Unit tests for sub-path (base path) deployment of the HTTP app."""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse
from starlette.routing import get_route_path
from tests.support.app import octop_client, write_octop_config
from tests.support.auth import bootstrap_admin

from octop.api.common.attachments import dashboard_inbound_preview_url
from octop.infra.base_path import BasePathApp, set_base_path


@pytest.fixture(autouse=True)
def _reset_process_base_path() -> Iterator[None]:
    yield
    set_base_path("")


def _probe_app() -> FastAPI:
    """Tiny app that reports what the ASGI scope looks like inside a route."""
    app = FastAPI()

    @app.get("/ping")
    async def ping(request: Request) -> dict[str, Any]:
        scope = request.scope
        return {
            "path": scope.get("path"),
            "root_path": scope.get("root_path"),
            "route_path": get_route_path(scope),
            "url_for": str(request.url_for("ping")),
        }

    return app


async def _get(app: Any, path: str) -> httpx.Response:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
        follow_redirects=False,
    ) as client:
        return await client.get(path)


@pytest.fixture
async def prefixed_client(tmp_path: Path) -> AsyncIterator[httpx.AsyncClient]:
    write_octop_config(tmp_path, enable_api_docs=True)
    async with octop_client(tmp_path, base_path="/videogen") as (client, _server):
        # An admin exists — the setup lockdown must not shadow the JWT gate.
        await bootstrap_admin(client, tmp_path, prefix="/videogen")
        yield client


async def test_health_is_served_under_the_prefix(prefixed_client: httpx.AsyncClient) -> None:
    response = await prefixed_client.get("/videogen/api/health")
    assert response.status_code == 200


async def test_health_without_the_prefix_is_404(prefixed_client: httpx.AsyncClient) -> None:
    response = await prefixed_client.get("/api/health")
    assert response.status_code == 404


async def test_unknown_paths_without_the_prefix_are_404(prefixed_client: httpx.AsyncClient) -> None:
    response = await prefixed_client.get("/")
    assert response.status_code == 404


async def test_jwt_exempt_paths_stay_exempt_under_the_prefix(
    prefixed_client: httpx.AsyncClient,
) -> None:
    # ``/api/health`` and ``/api/openapi.json`` bypass the JWT gate.
    assert (await prefixed_client.get("/videogen/api/health")).status_code == 200
    docs = await prefixed_client.get("/videogen/api/openapi.json")
    assert docs.status_code == 200
    # The login route is reachable without a token.
    login = await prefixed_client.post(
        "/videogen/api/auth/login",
        json={"username": "admin", "password": "TestPass12"},
    )
    assert login.status_code == 200


async def test_protected_paths_still_require_a_token(prefixed_client: httpx.AsyncClient) -> None:
    response = await prefixed_client.get("/videogen/api/agents")
    assert response.status_code == 401


async def test_scope_path_is_stripped_and_root_path_published() -> None:
    app = BasePathApp(_probe_app(), "/videogen")
    response = await _get(app, "/videogen/ping")
    assert response.status_code == 200
    body = response.json()
    # The prefix is stripped from the routing path …
    assert body["path"] == "/ping"
    # … and republished as ``root_path`` so Starlette keeps the prefix in
    # generated URLs.
    assert body["root_path"] == "/videogen"
    # ``get_route_path`` must not strip the prefix a second time.
    assert body["route_path"] == "/ping"
    assert body["url_for"] == "http://testserver/videogen/ping"


async def test_empty_base_path_keeps_root_behaviour() -> None:
    app = BasePathApp(_probe_app(), "")
    response = await _get(app, "/ping")
    assert response.status_code == 200
    body = response.json()
    assert body["path"] == "/ping"
    assert body["root_path"] == ""
    assert body["route_path"] == "/ping"
    assert body["url_for"] == "http://testserver/ping"


async def test_redirect_locations_keep_the_prefix() -> None:
    app = FastAPI()

    @app.get("/old")
    async def old() -> RedirectResponse:
        return RedirectResponse("/new")

    @app.get("/away")
    async def _away() -> RedirectResponse:
        return RedirectResponse("https://example.com/elsewhere")

    wrapped = BasePathApp(app, "/videogen")
    response = await _get(wrapped, "/videogen/old")
    assert response.status_code in (302, 307)
    assert response.headers["location"] == "/videogen/new"
    # A redirect to another origin must stay untouched.
    away = await _get(wrapped, "/videogen/away")
    assert away.headers["location"] == "https://example.com/elsewhere"


async def test_trailing_slash_redirect_keeps_the_prefix() -> None:
    wrapped = BasePathApp(_probe_app(), "/videogen")
    response = await _get(wrapped, "/videogen/ping/")
    assert response.status_code in (301, 302, 307)
    assert response.headers["location"].endswith("/videogen/ping")


async def test_root_deployment_serves_health_at_the_root(tmp_path: Path) -> None:
    async with octop_client(tmp_path) as (client, _server):
        health = await client.get("/api/health")
        assert health.status_code == 200
        assert health.json()["ok"] is True


def test_dashboard_urls_carry_the_base_path() -> None:
    set_base_path("/videogen")
    url = dashboard_inbound_preview_url("a1", "inbound/x.png", media_type="image/png")
    assert url.startswith("/videogen/api/agents/a1/media/preview")
    download = dashboard_inbound_preview_url(
        "a1", "inbound/x.bin", media_type="application/octet-stream"
    )
    assert download.startswith("/videogen/api/agents/a1/workspace/download")
