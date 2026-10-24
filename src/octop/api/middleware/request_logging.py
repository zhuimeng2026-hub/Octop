"""Log every failed HTTP response with enough context to diagnose page 404s.

The dashboard SPA is a single-page app: a "business page is 404" report is
ambiguous — it may be the server refusing an API call, the SPA shell answering
a stale hashed asset, or a route that does not exist at all.  This middleware
records what the browser actually asked for (raw path, deployment base path,
matched route template, referer, user agent) so the answer can be read off the
log instead of guessed.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import Request

logger = logging.getLogger(__name__)

# Scope marker: the failure was already logged by a handler deeper down.
FAILURE_LOGGED_KEY = "octop.failure_logged"

# Hint for a hashed asset that no longer exists on disk.
STALE_ASSET_HINT = (
    "stale build reference (old index.html / service-worker cache) — "
    "hard-reload the page to fetch the current shell"
)


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client is not None:
        return request.client.host
    return "-"


def _truncated(value: str, limit: int = 200) -> str:
    return value if len(value) <= limit else value[: limit - 1] + "…"


def _describe(request: Request) -> str:
    scope = request.scope
    path = str(scope.get("path") or request.url.path)
    root_path = str(scope.get("root_path") or "")
    route = scope.get("route")
    route_path = getattr(route, "path", None) or "-"
    referer = request.headers.get("referer") or "-"
    user_agent = _truncated(request.headers.get("user-agent") or "-")
    return (
        f"method={request.method} path={path} base_path={root_path or '-'} "
        f"route={route_path} client={_client_ip(request)} "
        f"referer={_truncated(referer)} ua={user_agent}"
    )


def log_request_failure(
    request: Request,
    status: int,
    *,
    detail: str = "",
    hint: str = "",
) -> None:
    """Log one failed response.  Also called from the SPA fallback handler."""
    context = _describe(request)
    if detail:
        context = f"{context} detail={detail}"
    if hint:
        context = f"{context} hint={hint}"
    if status >= 500:
        logger.error("http %s | %s", status, context)
    elif status == 404:
        logger.warning("http %s | %s", status, context)
    else:
        logger.info("http %s | %s", status, context)
    request.scope[FAILURE_LOGGED_KEY] = True


def install(app: Any) -> None:
    """Install the failure-logging middleware (outermost on the app)."""

    @app.middleware("http")  # type: ignore[untyped-decorator]
    async def _log_failures(
        request: Request,
        call_next: Callable[[Request], Awaitable[Any]],
    ) -> Any:
        response = await call_next(request)
        status = response.status_code
        # A handler that already logged the failure (e.g. the SPA fallback)
        # leaves a marker in the scope — do not log it twice.
        if status >= 400 and not request.scope.get(FAILURE_LOGGED_KEY):
            log_request_failure(request, status)
        return response
