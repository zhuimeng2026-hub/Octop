"""Diagnostic hint for a dashboard asset that is missing from disk.

The dashboard SPA is a single-page app: a "business page is 404" report is
ambiguous — it may be the server refusing an API call, the SPA shell answering
a stale hashed asset, or a route that does not exist at all.  The access log
(``middleware/access_log.py``) answers "what was asked and did it match a
route"; this module answers the follow-up question for the one case that needs
an explanation of its own: the browser is still pointing at a hashed asset
that no longer exists on disk.

There is deliberately no middleware here — the access log already writes one
line per request, and a second one would only duplicate it.
"""

from __future__ import annotations

import logging

from fastapi import Request

logger = logging.getLogger(__name__)

# Hint for a hashed asset that no longer exists on disk.
STALE_ASSET_HINT = (
    "stale build reference (old index.html / service-worker cache) — "
    "hard-reload the page to fetch the current shell"
)


def log_request_failure(
    request: Request,
    status: int,
    *,
    detail: str = "",
    hint: str = "",
) -> None:
    """Log one failed response.  Also called from the SPA fallback handler."""
    path = request.url.path
    context = f"method={request.method} path={path}"
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
