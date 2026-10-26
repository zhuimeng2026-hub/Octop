"""Structured access log for every HTTP request.

Without this layer a production log only shows what code happened to call
``logger.info`` — a slow request, a burst of 5xx, or a probed path leaves no
trace. Each request emits one line at a status-derived level:

* ``INFO`` — 1xx/2xx/3xx
* ``WARNING`` — 4xx
* ``ERROR`` — 5xx, with ``exc_info`` when the exception escaped the handler

Only the request path is logged, never the query string or the ``Authorization``
header: an access token is accepted in both (``?access_token=…``), so logging
either would write credentials into ``~/.octop/logs``.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import Request

from octop.api.common.client_ip import resolve_client_ip

_INSTALL_ATTR = "_octop_access_log_installed"
logger = logging.getLogger("octop.api.access")

# Status assumed when the handler let an exception escape without a response.
_FAILED_STATUS = 500


def _status_level(status: int) -> int:
    if status >= 500:
        return logging.ERROR
    if status >= 400:
        return logging.WARNING
    return logging.INFO


def install(app: Any) -> None:
    if getattr(app, _INSTALL_ATTR, False):
        return
    setattr(app, _INSTALL_ATTR, True)

    @app.middleware("http")  # type: ignore[untyped-decorator]
    async def _access_log(
        request: Request,
        call_next: Callable[[Request], Awaitable[Any]],
    ) -> Any:
        started = time.perf_counter()
        status = _FAILED_STATUS
        raised = False
        try:
            response = await call_next(request)
            status = response.status_code
            return response
        except BaseException:
            raised = True
            raise
        finally:
            elapsed_ms = (time.perf_counter() - started) * 1000
            user = getattr(request.state, "octop_user", None)
            logger.log(
                _status_level(status),
                "%s %s -> %s %dms user=%s ip=%s",
                request.method,
                request.url.path,
                status,
                round(elapsed_ms),
                getattr(user, "id", None) or "-",
                resolve_client_ip(request),
                exc_info=raised,
            )
