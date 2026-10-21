"""Deployment base path (URL sub-path) helpers.

Octop can be served under a URL sub-path, e.g. ``https://host/videogen``.
The prefix is configured once per process (``config.json`` → ``base_path``,
env override ``OCTOP_BASE_PATH``) and applied by :class:`BasePathApp`, which
strips the prefix from ``scope["path"]`` and republishes it as
``scope["root_path"]`` so Starlette-generated URLs (``request.url_for``,
redirects) keep the prefix.

Route matching keeps working unchanged: Starlette's ``get_route_path()`` only
strips ``root_path`` when ``scope["path"]`` still starts with it, and the
stripped path never does.

Code paths that build URLs outside a request (IM/gateway media links) read the
process-wide value through :func:`current_base_path`.
"""

from __future__ import annotations

from urllib.parse import urlsplit, urlunsplit

from starlette.types import ASGIApp, Message, Receive, Scope, Send

_BASE_PATH: str = ""


def normalize_base_path(raw: str | None) -> str:
    """Canonicalize a configured base path.

    ``None``/``""`` → root deployment (``""``). Otherwise a leading slash and
    no trailing slash: ``"videogen"`` → ``"/videogen"``,
    ``"/videogen/"`` → ``"/videogen"``, ``"//a//b//"`` → ``"/a/b"``.
    """
    value = (raw or "").strip()
    if not value:
        return ""
    if "?" in value or "#" in value:
        msg = "base path must not contain a query string or fragment"
        raise ValueError(msg)
    segments = [segment for segment in value.split("/") if segment]
    if not segments:
        return ""
    for segment in segments:
        if segment in {".", ".."}:
            msg = f"base path must not contain relative segments: {raw!r}"
            raise ValueError(msg)
    return "/" + "/".join(segments)


def set_base_path(raw: str | None) -> str:
    """Set the process-wide base path; returns the normalized value."""
    global _BASE_PATH  # noqa: PLW0603 - one deployment per process
    _BASE_PATH = normalize_base_path(raw)
    return _BASE_PATH


def current_base_path() -> str:
    """The process-wide base path (``""`` for a root deployment)."""
    return _BASE_PATH


def strip_base_path(path: str, base_path: str) -> str | None:
    """Return ``path`` without the base-path prefix.

    ``None`` means the path is outside the deployment prefix. The base path
    itself (``/videogen``) maps to ``"/"``.
    """
    if not base_path:
        return path
    if path == base_path:
        return "/"
    if path.startswith(f"{base_path}/"):
        return path[len(base_path) :]
    return None


def prefix_base_path(path: str, base_path: str) -> str:
    """Prefix an absolute path with the base path.

    ``prefix_base_path("/api/x", "/videogen")`` → ``"/videogen/api/x"``.
    Values that are not absolute paths (URLs, relative paths) pass through.
    """
    if not base_path or not path.startswith("/"):
        return path
    return f"{base_path}{path}"


def strip_current_base_path(path: str) -> str:
    """Strip the process-wide base path from ``path`` (unchanged when not prefixed)."""
    stripped = strip_base_path(path, current_base_path())
    return path if stripped is None else stripped


def apply_base_path(path: str) -> str:
    """Prefix ``path`` with the process-wide base path — idempotent."""
    return prefix_base_path(strip_current_base_path(path), current_base_path())


class BasePathApp:
    """Serve ``app`` under ``base_path`` only — anything else gets a 404.

    The wrapper strips the prefix from ``scope["path"]`` and sets
    ``scope["root_path"]`` so the wrapped app keeps matching routes as if it
    were mounted at the root, while generated URLs keep the prefix.
    """

    def __init__(self, app: ASGIApp, base_path: str) -> None:
        self.app = app
        self.base_path = normalize_base_path(base_path)
        set_base_path(self.base_path)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        path = str(scope.get("path") or "")
        stripped = strip_base_path(path, self.base_path)
        if stripped is None:
            await _send_not_found(scope, send)
            return
        scope["path"] = stripped
        scope["root_path"] = self.base_path
        raw_path = scope.get("raw_path")
        if isinstance(raw_path, bytes):
            prefix = self.base_path.encode("utf-8")
            if raw_path.startswith(prefix):
                scope["raw_path"] = raw_path[len(prefix) :] or b"/"
        if scope["type"] == "http":
            await self.app(scope, receive, self._redirect_sender(scope, send))
            return
        await self.app(scope, receive, send)

    def _redirect_sender(self, scope: Scope, send: Send) -> Send:
        """Wrap ``send`` so redirect targets keep the base-path prefix.

        Starlette builds redirect targets from ``scope["path"]`` — already
        stripped here — so a redirect would otherwise point at the
        unprefixed path.
        """
        base_path = self.base_path
        origin = _request_origin(scope)

        async def _send(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = message.get("headers") or []
                rewritten: list[tuple[bytes, bytes]] = []
                changed = False
                for key, value in headers:
                    if key.lower() == b"location":
                        location = value.decode("latin-1")
                        patched = _with_base_path(location, base_path, origin=origin)
                        if patched != location:
                            value = patched.encode("latin-1")
                            changed = True
                    rewritten.append((key, value))
                if changed:
                    message = {**message, "headers": rewritten}
            await send(message)

        return _send


def _request_origin(scope: Scope) -> str:
    """The origin the client addressed (``host`` header, else the server socket)."""
    for key, value in scope.get("headers") or []:
        if key == b"host":
            return str(value.decode("latin-1"))
    server = scope.get("server")
    if server:
        host, port = server
        return f"{host}:{port}"
    return ""


def _with_base_path(location: str, base_path: str, *, origin: str) -> str:
    """Add the base path to a redirect target that does not carry it yet.

    Relative targets are always prefixed. Absolute targets are prefixed only
    when they point at this server — a redirect to another origin (an SSO
    dashboard, a CDN) must stay untouched.
    """
    if not base_path or not location:
        return location
    if location.startswith("/"):
        return _prefix_path(location, base_path)
    if not location.startswith("http://") and not location.startswith("https://"):
        return location
    parts = urlsplit(location)
    if not parts.scheme or not parts.netloc:
        return location
    if origin and parts.netloc != origin:
        return location
    path = _prefix_path(parts.path or "/", base_path)
    return urlunsplit((parts.scheme, parts.netloc, path, parts.query, parts.fragment))


def _prefix_path(path: str, base_path: str) -> str:
    if path == base_path or path.startswith(f"{base_path}/"):
        return path
    return f"{base_path}{path}"


async def _send_not_found(scope: Scope, send: Send) -> None:
    """Answer a request outside the deployment prefix with 404."""
    if scope.get("type") == "websocket":
        await send({"type": "websocket.close", "code": 1000})
        return
    body = b'{"detail":"Not Found"}'
    await send(
        {
            "type": "http.response.start",
            "status": 404,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})
