"""Shared SSO state cookie for OIDC and OAuth login callbacks."""

from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse, Response

SSO_STATE_COOKIE = "octop_sso_state"
SSO_COOKIE_PATH = "/api/auth"
SSO_STATE_TTL_SECONDS = 600


def request_is_https(request: Request) -> bool:
    forwarded_proto = request.headers.get("x-forwarded-proto")
    if forwarded_proto:
        return forwarded_proto.split(",", 1)[0].strip().lower() == "https"
    return request.url.scheme == "https"


def _cookie_path(request: Request) -> str:
    """Cookie path, including the mount prefix (e.g. "/videogen/api/auth")."""
    root_path = (request.scope.get("root_path") or "").rstrip("/")
    return f"{root_path}{SSO_COOKIE_PATH}"


def set_sso_state_cookie(response: JSONResponse, request: Request, state: str) -> None:
    response.set_cookie(
        SSO_STATE_COOKIE,
        state,
        max_age=SSO_STATE_TTL_SECONDS,
        path=_cookie_path(request),
        httponly=True,
        secure=request_is_https(request),
        samesite="lax",
    )


def delete_sso_state_cookie(response: Response, request: Request) -> None:
    response.delete_cookie(
        SSO_STATE_COOKIE, path=_cookie_path(request), secure=request_is_https(request)
    )


def cookie_state(request: Request) -> str | None:
    return request.cookies.get(SSO_STATE_COOKIE)
