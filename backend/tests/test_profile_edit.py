"""User-selected profiles are strict, persistent and survive identity changes."""
import pytest
from fastapi.testclient import TestClient
from backend.app.main import create_app
from backend.app.services.game_store import InMemoryGameStore
from backend.tests.test_wechat_auth import FakeWechat, login
from unittest.mock import patch
from backend.app.api.v1.account import _token_hash
from datetime import datetime, timedelta, timezone


def exercise_profile_actor_race(client):
    store = client.app.state.store; client.app.state.wechat_auth = FakeWechat()
    target = login(client).json()['data']
    old = client.post('/api/v1/auth/device').json()['data']
    client.headers['Authorization'] = 'Bearer ' + old['token']
    original = store.update_profile
    async def race(user, nickname, avatar):
        await store.login_wechat('wx-test-app:alice', '8' * 64,
            datetime.now(timezone.utc) + timedelta(days=1), _token_hash(old['token']))
        return await original(user, nickname, avatar)
    with patch.object(store, 'update_profile', race):
        assert client.post('/api/v1/me/profile', json={'nickname': '旧异步', 'avatar': 'piece_v1_pao'}).status_code == 401
    client.headers['Authorization'] = 'Bearer ' + target['token']
    profile = client.get('/api/v1/me/profile').json()['data']
    assert profile['nickname'] != '旧异步' and profile['avatar'] == 'piece_v1_shi'


def test_profile_final_actor_validation():
    with TestClient(create_app(store=InMemoryGameStore())) as client:
        exercise_profile_actor_race(client)


@pytest.mark.parametrize('existing', [False, True])
def test_profile_save_relogin_and_merge_priority(existing):
    app = create_app(store=InMemoryGameStore())
    with TestClient(app) as client:
        app.state.wechat_auth = FakeWechat()
        if existing:
            target = login(client).json()['data']
            client.headers['Authorization'] = 'Bearer ' + target['token']
            assert client.post('/api/v1/me/profile', json={'nickname': '目标棋手', 'avatar': 'piece_v1_ma'}).status_code == 200
        old = client.post('/api/v1/auth/device').json()['data']
        client.headers['Authorization'] = 'Bearer ' + old['token']
        response = client.post('/api/v1/me/profile', json={'nickname': '  棋😀手  ', 'avatar': 'piece_v1_pao'})
        assert response.status_code == 200, response.text
        assert response.json()['data']['nickname'] == '棋😀手'
        account = login(client, device_token=old['token']).json()['data']
        client.headers['Authorization'] = 'Bearer ' + account['token']
        expected = ('目标棋手', 'piece_v1_ma') if existing else ('棋😀手', 'piece_v1_pao')
        for _ in range(2):
            profile = client.get('/api/v1/me/profile').json()['data']
            assert (profile['nickname'], profile['avatar']) == expected
            account = login(client).json()['data']
            client.headers['Authorization'] = 'Bearer ' + account['token']


@pytest.mark.parametrize('body', [
    {'nickname': '', 'avatar': 'piece_v1_shi'},
    {'nickname': ' ' * 3, 'avatar': 'piece_v1_shi'},
    {'nickname': '棋' * 25, 'avatar': 'piece_v1_shi'},
    {'nickname': '棋\n手', 'avatar': 'piece_v1_shi'},
    {'nickname': '棋\x00手', 'avatar': 'piece_v1_shi'},
    {'nickname': 4, 'avatar': 'piece_v1_shi'},
    {'nickname': '棋手', 'avatar': 'https://example.com/avatar'},
    {'nickname': '棋手', 'avatar': 'piece_v2_shi'},
    {'nickname': '棋手', 'avatar': 'piece_v1_shi', 'userId': 'other'},
])
def test_profile_rejects_invalid_input(body):
    with TestClient(create_app(store=InMemoryGameStore())) as client:
        token = client.post('/api/v1/auth/device').json()['data']['token']
        client.headers['Authorization'] = 'Bearer ' + token
        assert client.post('/api/v1/me/profile', json=body).status_code == 422


def test_profile_unicode_limit_and_defaults():
    with TestClient(create_app(store=InMemoryGameStore())) as client:
        token = client.post('/api/v1/auth/device').json()['data']['token']
        client.headers['Authorization'] = 'Bearer ' + token
        assert client.get('/api/v1/me/profile').json()['data']['avatar'] == 'piece_v1_shi'
        assert client.post('/api/v1/me/profile', json={'nickname': '😀' * 24, 'avatar': 'piece_v1_shi'}).status_code == 200
