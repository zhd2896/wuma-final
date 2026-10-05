"""WeChat login HTTP behavior with a fake external identity exchange."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.services.game_store import InMemoryGameStore
from backend.tests.test_training import finished_review


class FakeWechat:
    async def exchange(self, code):
        from backend.app.core.errors import ApiError
        if code == "bad":
            raise ApiError("WECHAT_LOGIN_FAILED", "WeChat login failed")
        return "wx-test-app:" + code


def login(client, code="alice", **extra):
    return client.post("/api/v1/auth/wechat", json={"code": code, **extra})


def test_wechat_same_user_across_devices_and_other_user_isolation():
    app = create_app(store=InMemoryGameStore())
    with TestClient(app) as client:
        app.state.wechat_auth = FakeWechat()
        first = login(client)
        assert first.status_code == 200, first.text
        first = first.json()["data"]
        client.headers["Authorization"] = "Bearer " + first["token"]
        game = client.post("/api/v1/game", json={"mode": "AI"}).json()["data"]["game_id"]
        second = login(client).json()["data"]
        assert second["userId"] == first["userId"]
        assert second["token"] != first["token"]
        assert "session_key" not in second and "openid" not in second
        client.headers["Authorization"] = "Bearer " + second["token"]
        assert client.get(f"/api/v1/game/{game}").status_code == 200
        bob = login(client, "bob").json()["data"]
        client.headers["Authorization"] = "Bearer " + bob["token"]
        assert client.get(f"/api/v1/game/{game}").status_code == 403
        assert client.get("/api/v1/me/profile").json()["data"]["games"] == 0


@pytest.mark.parametrize("existing_wechat", [False, True])
def test_anonymous_game_and_training_migration_revokes_old_token(existing_wechat):
    app = create_app(store=InMemoryGameStore())
    with TestClient(app) as client:
        app.state.wechat_auth = FakeWechat()
        target = login(client).json()["data"] if existing_wechat else None
        old = client.post("/api/v1/auth/device").json()["data"]
        client.headers["Authorization"] = "Bearer " + old["token"]
        game_id, review = finished_review(client)
        question = client.post(f"/api/v1/game/{game_id}/training", json={}).json()["data"]["items"][0]
        best = next(move["bestMove"] for move in review["moveReviews"] if move["turn"] == question["sourceTurn"])
        assert client.post(f'/api/v1/training/{question["id"]}/answer', json={
            "from_node": best["from"], "to_node": best["to"], "client_attempt_id": "wx-migration-answer"}).status_code == 200
        account = login(client, device_token=old["token"]).json()["data"]
        assert account["userId"] == (target["userId"] if target else old["userId"])
        assert client.get("/api/v1/me/profile").status_code == 401
        client.headers["Authorization"] = "Bearer " + account["token"]
        profile = client.get("/api/v1/me/profile").json()["data"]
        assert profile["games"] == 1 and profile["training"] == 1
        assert client.get(f"/api/v1/game/{game_id}").status_code == 200
        repeated = login(client, device_token=old["token"]).json()["data"]
        assert repeated["userId"] == account["userId"]
        assert client.get("/api/v1/me/profile").json()["data"]["training"] == 1


def test_login_validation_failure_and_expired_session():
    store = InMemoryGameStore()
    app = create_app(store=store)
    with TestClient(app) as client:
        app.state.wechat_auth = FakeWechat()
        assert login(client, "").status_code == 422
        assert login(client, "bad").status_code == 401
        result = login(client).json()["data"]
        assert datetime.fromisoformat(result["expiresAt"]) > datetime.now(timezone.utc)
        client.headers["Authorization"] = "Bearer " + result["token"]
        assert client.get("/api/v1/me/profile").status_code == 200
        from backend.app.api.v1.account import _token_hash
        key = _token_hash(result["token"])
        store._auth_sessions[key] = (result["userId"], datetime.now(timezone.utc) - timedelta(seconds=1))
        assert client.get("/api/v1/me/profile").status_code == 401
        bob = login(client, "bob", device_token=result["token"]).json()["data"]
        assert bob["userId"] != result["userId"]


def test_wechat_exchange_uses_server_secret_and_rejects_invalid_responses():
    import asyncio
    import httpx
    from backend.app.services.wechat_auth import WechatAuth
    from backend.app.core.config import Settings
    from backend.app.core.errors import ApiError
    def handler(request):
        assert request.url.host == "api.weixin.qq.com"
        assert request.url.params["appid"] == "appid-test"
        assert request.url.params["secret"] == "server-secret"
        assert request.url.params["js_code"] == "once-code"
        return httpx.Response(200, json={"openid": "verified-openid", "session_key": "private"})
    auth = WechatAuth(Settings(wechat_app_id="appid-test", wechat_app_secret="server-secret"),
                      transport=httpx.MockTransport(handler))
    assert asyncio.run(auth.exchange("once-code")) == "appid-test:verified-openid"
    for payload in [{"errcode": 40029, "errmsg": "secret data"}, {}, {"openid": 7}, {"openid": "x"}]:
        auth = WechatAuth(Settings(wechat_app_id="appid-test", wechat_app_secret="server-secret"),
                          transport=httpx.MockTransport(lambda request: httpx.Response(200, json=payload)))
        with pytest.raises(ApiError) as exc:
            asyncio.run(auth.exchange("once-code"))
        assert exc.value.code == "WECHAT_LOGIN_FAILED"
        assert "secret" not in exc.value.message
    auth = WechatAuth(Settings(wechat_app_id="", wechat_app_secret=""))
    with pytest.raises(ApiError) as exc:
        asyncio.run(auth.exchange("code"))
    assert exc.value.code == "WECHAT_NOT_CONFIGURED"


def test_inflight_anonymous_training_cannot_write_to_revoked_user():
    from backend.app.core.errors import ApiError
    from backend.app.api.v1.account import _token_hash
    store = InMemoryGameStore()
    app = create_app(store=store)
    with TestClient(app) as client:
        app.state.wechat_auth = FakeWechat()
        login(client)  # force a merge into an existing WeChat user
        old = client.post("/api/v1/auth/device").json()["data"]
        client.headers["Authorization"] = "Bearer " + old["token"]
        game_id, review = finished_review(client)
        question = client.post(f"/api/v1/game/{game_id}/training", json={}).json()["data"]["items"][0]
        best = next(move["bestMove"] for move in review["moveReviews"] if move["turn"] == question["sourceTurn"])
        original_commit = store.commit_training_record
        async def migrate_before_commit(record, user_id=None):
            await store.login_wechat("wx-test-app:alice", "e" * 64,
                datetime.now(timezone.utc) + timedelta(days=1),
                _token_hash(old["token"]))
            return await original_commit(record, user_id)
        store.commit_training_record = migrate_before_commit
        result = client.post(f'/api/v1/training/{question["id"]}/answer', json={
            "from_node": best["from"], "to_node": best["to"], "client_attempt_id": "wx-inflight"})
        assert result.status_code == 401, result.text
        assert not store._training_records
        state = client.portal.call(store.get_snapshot, game_id).state
        with pytest.raises(ApiError) as exc:
            client.portal.call(store.create, state, "AI", "B", "STANDARD", old["userId"])
        assert exc.value.code == "AUTH_INVALID"
