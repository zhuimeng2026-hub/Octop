"""Shared SSO state cookie for OIDC and OAuth login callbacks."""

from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse, Response

from octop.infra.base_path import apply_base_path

SSO_STATE_COOKIE = "octop_sso_state"
SSO_COOKIE_PATH = "/api/auth"
SSO_STATE_TTL_SECONDS = 600


def _cookie_path() -> str:
    """Cookie path under the deployment prefix — the browser only sends it there."""
    return apply_base_path(SSO_COOKIE_PATH)


def request_is_https(request: Request) -> bool:
    forwarded_proto = request.headers.get("x-forwarded-proto")
    if forwarded_proto:
        return forwarded_proto.split(",", 1)[0].strip().lower() == "https"
    return request.url.scheme == "https"


def set_sso_state_cookie(response: JSONResponse, request: Request, state: str) -> None:
    response.set_cookie(
        SSO_STATE_COOKIE,
        state,
        max_age=SSO_STATE_TTL_SECONDS,
        path=_cookie_path(),
        httponly=True,
        secure=request_is_https(request),
        samesite="lax",
    )


def delete_sso_state_cookie(response: Response, request: Request) -> None:
    response.delete_cookie(SSO_STATE_COOKIE, path=_cookie_path(), secure=request_is_https(request))


def cookie_state(request: Request) -> str | None:
    return request.cookies.get(SSO_STATE_COOKIE)
