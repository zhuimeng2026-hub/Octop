"""WeChat Open Platform (开放平台网站应用) QR sign-in adapter for dashboard SSO.

The open platform's website app is a desktop-browser QR login: the browser
opens ``open.weixin.qq.com/connect/qrconnect``, the user scans with WeChat and
WeChat redirects back with a one-time ``code``.

Three facts about the platform shape this adapter:

- The AppID belongs to the **open platform** (``open.weixin.qq.com``), not to a
  公众号 or a 小程序. All three are ``wx``-prefixed and look alike, and using
  the wrong one fails at the browser step with errcode 10005 ("scope 参数错误
  或没有 scope 权限") because the website login scope ``snsapi_login`` only
  exists for the open platform's website app.
- ``snsapi_login`` is fixed by the protocol. ``snsapi_userinfo`` belongs to the
  公众号 flow and is not a substitute.
- The ``#wechat_redirect`` fragment is required: without it WeChat renders a
  blank page instead of the QR image, so the scan silently never happens.

WeChat answers most failures with HTTP 200 and an ``errcode`` in the body, so
every response body is parsed before it is believed.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any
from urllib.parse import urlencode

import httpx
import jwt

from octop.infra.auth.sso.crypto import decrypt_secret
from octop.infra.auth.sso.public_base import oauth_callback_path
from octop.infra.db.repos.sso import SsoLoginStateRow, SsoProviderRow

if TYPE_CHECKING:
    from octop.infra.auth.sso.service import SsoService

logger = logging.getLogger(__name__)

_AUTHORIZE = "https://open.weixin.qq.com/connect/qrconnect"
_API = "https://api.weixin.qq.com"

# Fixed by the website-login protocol.
_SCOPE = "snsapi_login"

# Not decoration: without the fragment WeChat renders a blank page instead of
# the QR image. It is a fragment, so it goes after the query string raw.
_REDIRECT_FRAGMENT = "#wechat_redirect"

# WeChat error codes worth branching on. The rest are surfaced verbatim.
_ERRCODE_INVALID_APPID = 40013
_ERRCODE_INVALID_SECRET = 40125
_ERRCODE_INVALID_CODE = 40029
_ERRCODE_CODE_USED = 40163

# A code that cannot exist. The token endpoint validates the AppID and the
# secret before it looks at the code, so a bogus code with good credentials
# comes back as 40029 ("invalid code") — which makes it a credential probe.
_PROBE_CODE = "octop-credential-probe"


class WeChatOpenAdapter:
    """Website-app QR login: WeChat OpenID in, Octop user out."""

    kind = "wechat_open"
    callback_path = oauth_callback_path()
    default_scopes = _SCOPE

    def __init__(self, service: SsoService) -> None:
        self._service = service

    def is_configured(self, row: SsoProviderRow) -> bool:
        return bool(row.client_id.strip() and row.client_secret_enc is not None)

    def authorize_url(
        self,
        *,
        row: SsoProviderRow,
        state: str,
        nonce: str,
        code_challenge: str,
        redirect_uri: str,
    ) -> str:
        del nonce, code_challenge
        params = {
            "appid": row.client_id.strip(),
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": _SCOPE,
            "state": state,
        }
        appid = row.client_id.strip()
        logger.info(
            "WeChat authorize URL built (appid=%s… scope=%s redirect_uri=%s)",
            appid[:6],
            _SCOPE,
            redirect_uri,
        )
        return f"{_AUTHORIZE}?{urlencode(params)}{_REDIRECT_FRAGMENT}"

    def complete_login(
        self,
        code: str,
        *,
        row: SsoProviderRow,
        login_state: SsoLoginStateRow,
        redirect_uri: str,
    ) -> tuple[str, dict[str, Any]]:
        del login_state, redirect_uri
        if row.client_secret_enc is None:
            raise ValueError("WeChat app secret is not configured")
        secret = decrypt_secret(self._service._services.secret_repo, row.client_secret_enc)
        with self._service._http_client() as client:
            session = self._exchange_code(
                client, appid=row.client_id.strip(), secret=secret, code=code
            )
            claims = self._profile(
                client, access_token=session["access_token"], openid=session["openid"]
            )
        return session["openid"], claims

    def test_connection(self, row: SsoProviderRow) -> dict[str, bool | str]:
        if row.client_secret_enc is None:
            return {"ok": False, "detail": "WeChat app secret is not configured"}
        secret = decrypt_secret(self._service._services.secret_repo, row.client_secret_enc)
        try:
            with self._service._http_client() as client:
                response = self._get(
                    client,
                    f"{_API}/sns/oauth2/access_token",
                    params={
                        "appid": row.client_id.strip(),
                        "secret": secret,
                        "code": _PROBE_CODE,
                        "grant_type": "authorization_code",
                    },
                    op="token",
                )
                payload = self._read_body(response, "token")
        except (httpx.HTTPError, ValueError) as exc:
            return {"ok": False, "detail": str(exc)}
        errcode = payload.get("errcode")
        logger.info("WeChat credential probe returned errcode=%s", errcode)
        if errcode in (_ERRCODE_INVALID_APPID, _ERRCODE_INVALID_SECRET):
            errmsg = payload.get("errmsg")
            detail = errmsg if isinstance(errmsg, str) and errmsg else ""
            suffix = f": {detail}" if detail else ""
            return {
                "ok": False,
                "detail": f"WeChat rejected the credentials (errcode {errcode}){suffix}",
            }
        if errcode in (0, "0", None, _ERRCODE_INVALID_CODE, _ERRCODE_CODE_USED):
            return {"ok": True, "detail": "WeChat app credentials are valid"}
        errmsg = payload.get("errmsg")
        detail = errmsg if isinstance(errmsg, str) and errmsg else ""
        suffix = f": {detail}" if detail else ""
        return {"ok": False, "detail": f"WeChat error {errcode}{suffix}"}

    @staticmethod
    def _get(client: httpx.Client, url: str, *, params: dict[str, str], op: str) -> httpx.Response:
        """GET a WeChat endpoint, keeping the secret-bearing URL out of errors.

        httpx puts the request URL in its transport-error messages and the
        AppSecret travels in the query string, so the URL is never echoed.
        """
        try:
            return client.get(url, params=params)
        except httpx.HTTPError as exc:
            raise ValueError(f"WeChat {op} request failed ({exc.__class__.__name__})") from exc

    @staticmethod
    def _read_body(response: httpx.Response, op: str) -> dict[str, Any]:
        """Parse a WeChat body without judging the ``errcode`` in it."""
        try:
            response.raise_for_status()
        except httpx.HTTPError as exc:
            # httpx puts the request URL in the message and the AppSecret is in
            # this URL's query string — classify, never echo.
            raise ValueError(f"WeChat {op} request failed ({exc.__class__.__name__})") from exc
        try:
            payload = response.json()
        except ValueError as exc:
            raise ValueError(f"WeChat {op} response is not JSON") from exc
        if not isinstance(payload, dict):
            raise ValueError(f"WeChat {op} response is not an object")
        return payload

    @classmethod
    def _read_payload(cls, response: httpx.Response, op: str) -> dict[str, Any]:
        """Parse a WeChat body, turning an ``errcode`` into a failure."""
        payload = cls._read_body(response, op)
        errcode = payload.get("errcode")
        if errcode not in (0, "0", None):
            errmsg = payload.get("errmsg")
            detail = errmsg if isinstance(errmsg, str) and errmsg else ""
            suffix = f": {detail}" if detail else ""
            raise ValueError(f"WeChat {op} failed with errcode {errcode}{suffix}")
        return payload

    @classmethod
    def _exchange_code(
        cls, client: httpx.Client, *, appid: str, secret: str, code: str
    ) -> dict[str, Any]:
        response = cls._get(
            client,
            f"{_API}/sns/oauth2/access_token",
            params={
                "appid": appid,
                "secret": secret,
                "code": code,
                "grant_type": "authorization_code",
            },
            op="token exchange",
        )
        payload = cls._read_payload(response, "token exchange")
        access_token = payload.get("access_token")
        openid = payload.get("openid")
        if not isinstance(openid, str) or not openid:
            raise jwt.InvalidTokenError("WeChat token response has no openid")
        if not isinstance(access_token, str) or not access_token:
            raise ValueError("WeChat token response has no access_token")
        return {"access_token": access_token, "openid": openid}

    @staticmethod
    def _profile(client: httpx.Client, *, access_token: str, openid: str) -> dict[str, Any]:
        """Read the nickname / avatar. Never fatal — the sign-in already stands.

        WeChat refuses the profile call without warning often enough (rate
        limits, 48001 api unauthorized) that failing the login over a missing
        display name would be the worse product.
        """
        try:
            response = WeChatOpenAdapter._get(
                client,
                f"{_API}/sns/userinfo",
                params={"access_token": access_token, "openid": openid, "lang": "zh_CN"},
                op="profile",
            )
        except ValueError:
            return {}
        try:
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError):
            return {}
        if not isinstance(payload, dict) or payload.get("errcode") not in (0, "0", None):
            logger.info(
                "WeChat profile lookup returned errcode=%s (the sign-in itself is unaffected)",
                payload.get("errcode") if isinstance(payload, dict) else "?",
            )
            return {}
        claims: dict[str, Any] = {}
        nickname = payload.get("nickname")
        if isinstance(nickname, str) and nickname.strip():
            claims["name"] = nickname.strip()
        avatar = payload.get("headimgurl")
        if isinstance(avatar, str) and avatar.strip():
            claims["picture"] = avatar.strip()
        unionid = payload.get("unionid")
        if isinstance(unionid, str) and unionid.strip():
            claims["unionid"] = unionid.strip()
        logger.info(
            "WeChat profile lookup ok (nickname=%s avatar=%s unionid=%s)",
            bool(claims.get("name")),
            bool(claims.get("picture")),
            bool(claims.get("unionid")),
        )
        return claims
