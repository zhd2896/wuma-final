"""Server-only WeChat code exchange; never return or persist session_key."""
import httpx

from backend.app.core.config import Settings
from backend.app.core.errors import ApiError


class WechatAuth:
    def __init__(self, settings: Settings, transport=None):
        self.settings = settings
        self.transport = transport

    async def exchange(self, code: str) -> str:
        if not self.settings.wechat_app_id or not self.settings.wechat_app_secret:
            raise ApiError("WECHAT_NOT_CONFIGURED", "WeChat login is not configured")
        try:
            async with httpx.AsyncClient(timeout=8.0, transport=self.transport,
                                         follow_redirects=False) as client:
                response = await client.get("https://api.weixin.qq.com/sns/jscode2session", params={
                    "appid": self.settings.wechat_app_id,
                    "secret": self.settings.wechat_app_secret,
                    "js_code": code,
                    "grant_type": "authorization_code",
                })
                response.raise_for_status()
                data = response.json()
        except (httpx.HTTPError, ValueError):
            raise ApiError("WECHAT_UNAVAILABLE", "WeChat login is temporarily unavailable") from None
        if not isinstance(data, dict):
            raise ApiError("WECHAT_LOGIN_FAILED", "WeChat login failed")
        openid = data.get("openid")
        session_key = data.get("session_key")
        if data.get("errcode", 0) != 0 or not isinstance(openid, str) or not openid or len(openid) > 64 or not isinstance(session_key, str) or not session_key:
            raise ApiError("WECHAT_LOGIN_FAILED", "WeChat login failed")
        return self.settings.wechat_app_id + ":" + openid
