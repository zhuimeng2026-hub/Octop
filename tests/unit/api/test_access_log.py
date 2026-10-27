"""Access-log middleware records one line per request at a status-derived level."""

from __future__ import annotations

import logging
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from tests.support.app import ensure_control_plane_bound, write_octop_config

from octop.api.app import build_app
from octop.api.middleware.access_log import logger as access_logger
from octop.infra.errors import ErrorCode, OctopError
from octop.infra.server import OctopServer

ACCESS_LOGGER_NAME = "octop.api.access"


class _Capture(logging.Handler):
    def __init__(self) -> None:
        super().__init__(level=logging.DEBUG)
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)


@pytest.fixture
def captured() -> Iterator[list[logging.LogRecord]]:
    handler = _Capture()
    access_logger.addHandler(handler)
    access_logger.setLevel(logging.DEBUG)
    try:
        yield handler.records
    finally:
        access_logger.removeHandler(handler)


@pytest.fixture
async def client(tmp_path: Path) -> Iterator[httpx.AsyncClient]:
    write_octop_config(tmp_path, enable_dashboard=False)
    srv = OctopServer(home=tmp_path)
    await srv.start()
    await ensure_control_plane_bound(srv)
    app = build_app(srv)

    @app.get("/_test/ok")
    async def _ok() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/_test/missing")
    async def _missing() -> None:
        raise OctopError(ErrorCode.NOT_FOUND, "nope")

    @app.get("/_test/boom")
    async def _boom() -> None:
        raise RuntimeError("kaboom")

    async with httpx.AsyncClient(
        # The 500 path re-raises a bare RuntimeError; let the ASGI transport
        # hand back the response instead of propagating it into the test.
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://testserver",
    ) as c:
        yield c
    await srv.stop()


async def test_success_is_logged_at_info(
    client: httpx.AsyncClient, captured: list[logging.LogRecord]
) -> None:
    r = await client.get("/_test/ok")
    assert r.status_code == 200
    (record,) = [rec for rec in captured if "/_test/ok" in rec.getMessage()]
    assert record.levelno == logging.INFO
    assert record.getMessage().startswith("GET /_test/ok -> 200")


async def test_4xx_is_logged_at_warning(
    client: httpx.AsyncClient, captured: list[logging.LogRecord]
) -> None:
    r = await client.get("/_test/missing")
    assert r.status_code == 404
    (record,) = [rec for rec in captured if "/_test/missing" in rec.getMessage()]
    assert record.levelno == logging.WARNING


async def test_unhandled_exception_is_logged_at_error_with_traceback(
    client: httpx.AsyncClient, captured: list[logging.LogRecord]
) -> None:
    r = await client.get("/_test/boom")
    assert r.status_code == 500
    (record,) = [rec for rec in captured if "/_test/boom" in rec.getMessage()]
    assert record.levelno == logging.ERROR
    assert "-> 500" in record.getMessage()
    assert record.exc_info is not None


async def test_query_string_is_not_logged(
    client: httpx.AsyncClient, captured: list[logging.LogRecord]
) -> None:
    await client.get("/_test/ok", params={"access_token": "super-secret-token"})
    lines = [rec.getMessage() for rec in captured if "/_test/ok" in rec.getMessage()]
    assert lines
    assert all("super-secret-token" not in line for line in lines)
    assert all("?" not in line for line in lines)


async def test_route_template_is_logged(
    client: httpx.AsyncClient, captured: list[logging.LogRecord]
) -> None:
    await client.get("/_test/ok")
    (record,) = [rec for rec in captured if "/_test/ok" in rec.getMessage()]
    assert "route=/_test/ok" in record.getMessage()


async def test_user_agent_is_logged_but_truncated(
    client: httpx.AsyncClient, captured: list[logging.LogRecord]
) -> None:
    agent = "A" * 500
    await client.get("/_test/ok", headers={"user-agent": agent})
    (record,) = [rec for rec in captured if "/_test/ok" in rec.getMessage()]
    message = record.getMessage()
    assert "ua=AAAA" in message
    assert agent not in message
    assert len(message) < len(agent) + 200


async def test_install_is_idempotent(tmp_path: Path) -> None:
    write_octop_config(tmp_path, enable_dashboard=False)
    srv = OctopServer(home=tmp_path)
    await srv.start()
    await ensure_control_plane_bound(srv)
    app = build_app(srv)
    before = len(app.user_middleware)
    # A second build_app on the same app object must not stack a second logger.
    from octop.api.middleware.access_log import install as install_access_log

    install_access_log(app)
    assert len(app.user_middleware) == before
    await srv.stop()
