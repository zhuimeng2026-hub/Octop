"""Tests for the WeChat Open Platform (网站应用) dashboard SSO adapter."""

from __future__ import annotations

from unittest.mock import patch

import httpx
import jwt
import pytest

from octop.config import OctopConfig
from octop.infra.auth.sso.crypto import encrypt_secret
from octop.infra.auth.sso.providers.wechat_open import WeChatOpenAdapter
from octop.infra.auth.sso.service import SsoService
from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.services import build_shared_services
from octop.infra.users.manager import UserManager
from octop.infra.utils.paths import PathLayout


@pytest.fixture
def service(tmp_path):
    paths = PathLayout(tmp_path / ".octop")
    paths.ensure_root()
    db = SqlitePool(paths.db)
    run_migrations(db)
    services = build_shared_services(db=db, paths=paths, config=OctopConfig())
    return SsoService(services, UserManager(services))


def _wechat_row(service: SsoService, *, appid: str = "wxopenappid", secret: str = "app-secret"):
    encrypted = encrypt_secret(service._services.secret_repo, secret)
    return service._services.sso_repo.upsert_by_kind(
        "wechat_open",
        enabled=True,
        display_name="微信",
        issuer="",
        client_id=appid,
        client_secret_enc=encrypted,
        scopes="snsapi_login",
        dashboard_origin=None,
        extra={},
    )


def _mock_client(handler):
    real_client = httpx.Client

    def factory(*args: object, **kwargs: object) -> httpx.Client:
        kwargs.pop("transport", None)
        return real_client(*args, transport=httpx.MockTransport(handler), **kwargs)

    return factory


def test_wechat_open_authorize_url_uses_qrconnect(service: SsoService) -> None:
    adapter = WeChatOpenAdapter(service)
    row = _wechat_row(service)
    url = adapter.authorize_url(
        row=row,
        state="st",
        nonce="ignored",
        code_challenge="ignored",
        redirect_uri="https://octop.example/videogen/api/auth/oauth/callback",
    )
    assert url.startswith("https://open.weixin.qq.com/connect/qrconnect?")
    assert url.endswith("#wechat_redirect")
    query = httpx.QueryParams(url.split("?", 1)[1].split("#", 1)[0])
    assert query["appid"] == "wxopenappid"
    assert query["response_type"] == "code"
    assert query["scope"] == "snsapi_login"
    assert query["state"] == "st"
    assert query["redirect_uri"] == "https://octop.example/videogen/api/auth/oauth/callback"


def test_wechat_open_is_configured(service: SsoService) -> None:
    adapter = WeChatOpenAdapter(service)
    assert adapter.is_configured(_wechat_row(service))
    assert not adapter.is_configured(_wechat_row(service, appid=""))


def test_wechat_open_complete_login_returns_openid_and_claims(service: SsoService) -> None:
    adapter = WeChatOpenAdapter(service)
    row = _wechat_row(service)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/sns/oauth2/access_token"):
            assert request.url.params["code"] == "auth-code"
            assert request.url.params["grant_type"] == "authorization_code"
            return httpx.Response(
                200,
                json={
                    "access_token": "oauth-token",
                    "expires_in": 7200,
                    "refresh_token": "refresh",
                    "openid": "oABC",
                    "scope": "snsapi_login",
                },
            )
        if request.url.path.endswith("/sns/userinfo"):
            assert request.url.params["openid"] == "oABC"
            return httpx.Response(
                200,
                json={
                    "openid": "oABC",
                    "nickname": "张三",
                    "headimgurl": "https://thirdwx.qlogo.cn/avatar/0",
                    "unionid": "uXYZ",
                },
            )
        return httpx.Response(404, json={"errcode": 404, "errmsg": "missing"})

    login_state = type("State", (), {})()
    with patch("octop.infra.auth.sso.service.httpx.Client", side_effect=_mock_client(handler)):
        subject, claims = adapter.complete_login(
            "auth-code",
            row=row,
            login_state=login_state,  # type: ignore[arg-type]
            redirect_uri="https://octop.example/api/auth/oauth/callback",
        )

    assert subject == "oABC"
    assert claims["name"] == "张三"
    assert claims["picture"] == "https://thirdwx.qlogo.cn/avatar/0"
    assert claims["unionid"] == "uXYZ"


def test_wechat_open_errcode_body_is_a_failure(service: SsoService) -> None:
    adapter = WeChatOpenAdapter(service)
    row = _wechat_row(service)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"errcode": 40013, "errmsg": "invalid appid"})

    login_state = type("State", (), {})()
    with (
        patch("octop.infra.auth.sso.service.httpx.Client", side_effect=_mock_client(handler)),
        pytest.raises(ValueError, match="40013"),
    ):
        adapter.complete_login(
            "auth-code",
            row=row,
            login_state=login_state,  # type: ignore[arg-type]
            redirect_uri="https://octop.example/api/auth/oauth/callback",
        )


def test_wechat_open_missing_openid_is_invalid_token(service: SsoService) -> None:
    adapter = WeChatOpenAdapter(service)
    row = _wechat_row(service)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"errcode": 0, "access_token": "oauth-token"})

    login_state = type("State", (), {})()
    with (
        patch("octop.infra.auth.sso.service.httpx.Client", side_effect=_mock_client(handler)),
        pytest.raises(jwt.InvalidTokenError),
    ):
        adapter.complete_login(
            "auth-code",
            row=row,
            login_state=login_state,  # type: ignore[arg-type]
            redirect_uri="https://octop.example/api/auth/oauth/callback",
        )


def test_wechat_open_profile_failure_still_signs_in(service: SsoService) -> None:
    adapter = WeChatOpenAdapter(service)
    row = _wechat_row(service)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/sns/oauth2/access_token"):
            return httpx.Response(
                200, json={"errcode": 0, "access_token": "oauth-token", "openid": "oABC"}
            )
        return httpx.Response(200, json={"errcode": 48001, "errmsg": "api unauthorized"})

    login_state = type("State", (), {})()
    with patch("octop.infra.auth.sso.service.httpx.Client", side_effect=_mock_client(handler)):
        subject, claims = adapter.complete_login(
            "auth-code",
            row=row,
            login_state=login_state,  # type: ignore[arg-type]
            redirect_uri="https://octop.example/api/auth/oauth/callback",
        )

    assert subject == "oABC"
    assert claims == {}


def test_wechat_open_errors_never_carry_the_secret(service: SsoService) -> None:
    adapter = WeChatOpenAdapter(service)
    row = _wechat_row(service, secret="super-secret")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"errcode": 40125, "errmsg": "invalid appsecret"})

    login_state = type("State", (), {})()
    with (
        patch("octop.infra.auth.sso.service.httpx.Client", side_effect=_mock_client(handler)),
        pytest.raises(ValueError) as excinfo,
    ):
        adapter.complete_login(
            "auth-code",
            row=row,
            login_state=login_state,  # type: ignore[arg-type]
            redirect_uri="https://octop.example/api/auth/oauth/callback",
        )
    # The AppSecret travels in the query string; httpx puts the request URL in
    # its error message, so the message must not be echoed.
    assert "super-secret" not in str(excinfo.value)


def test_wechat_open_test_connection_accepts_valid_credentials(service: SsoService) -> None:
    adapter = WeChatOpenAdapter(service)
    row = _wechat_row(service)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"errcode": 40029, "errmsg": "invalid code"})

    with patch("octop.infra.auth.sso.service.httpx.Client", side_effect=_mock_client(handler)):
        result = adapter.test_connection(row)

    assert result["ok"] is True


def test_wechat_open_test_connection_rejects_bad_secret(service: SsoService) -> None:
    adapter = WeChatOpenAdapter(service)
    row = _wechat_row(service)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"errcode": 40125, "errmsg": "invalid appsecret"})

    with patch("octop.infra.auth.sso.service.httpx.Client", side_effect=_mock_client(handler)):
        result = adapter.test_connection(row)

    assert result["ok"] is False
    assert "40125" in str(result["detail"])
