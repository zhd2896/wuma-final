"""Remote account isolation, legacy claim, and token rotation contracts."""
from dataclasses import replace
from datetime import datetime, timedelta, timezone
import pytest
from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.services.game_store import InMemoryGameStore
from backend.app.core.errors import ApiError


def account(client):
    result = client.post('/api/v1/auth/device').json()['data']
    return {'Authorization': 'Bearer ' + result['token']}


def room(client, headers, public=False):
    response = client.post('/api/v1/remote/rooms', headers=headers,
                           json={'device_id': 'host-device-123', 'public': public})
    assert response.status_code == 200, response.text
    return response.json()['data']


def test_remote_creation_requires_authentication():
    with TestClient(create_app(store=InMemoryGameStore())) as client:
        for path, body in [('/rooms', {'device_id': 'host-device-123'}),
                           ('/join', {'device_id': 'guest-device-123', 'invite_code': 'ABCDEFGH'}),
                           ('/match', {'device_id': 'match-device-123'})]:
            assert client.post('/api/v1/remote' + path, json=body).status_code == 401


def test_same_account_cannot_join_or_match_its_other_device_room():
    with TestClient(create_app(store=InMemoryGameStore())) as client:
        a = account(client)
        host = room(client, a, True)
        denied = client.post('/api/v1/remote/join', headers=a, json={
            'device_id': 'different-device-456', 'invite_code': host['invite_code']})
        assert denied.status_code == 409 and denied.json()['code'] == 'REMOTE_SELF_JOIN'
        matched = client.post('/api/v1/remote/match', headers=a,
                              json={'device_id': 'third-device-789'}).json()['data']
        assert matched['game_id'] != host['game_id'] and matched['seat'] == 'A'


def test_bound_tokens_require_their_account_and_recover_rotates_only_own_seat():
    with TestClient(create_app(store=InMemoryGameStore())) as client:
        a, b, stranger = account(client), account(client), account(client)
        host = room(client, a)
        guest = client.post('/api/v1/remote/join', headers=b, json={
            'device_id': 'guest-device-456', 'invite_code': host['invite_code']}).json()['data']
        path = '/api/v1/remote/rooms/' + host['game_id']
        for suffix, method, body in [('', 'get', None), ('/cancel', 'post', {}),
            ('/legal-moves', 'get', None), ('/move', 'post', {'from_node': 'P01', 'to_node': 'P02',
             'expected_version': 0, 'client_request_id': 'account-move-001'}),
            ('/resign', 'post', {'expected_version': 0, 'client_request_id': 'account-resign-001'}),
            ('/undo-requests', 'post', {'expected_version': 0, 'client_request_id': 'account-undo-001'}),
            ('/undo-requests/unknown/accept', 'post', {'expected_version': 0, 'client_request_id': 'account-accept-001'}),
            ('/undo-requests/unknown/decline', 'post', {'expected_version': 0, 'client_request_id': 'account-decline-001'}),
            ('/review', 'get', None), ('/review', 'post', {})]:
            response = client.request(method, path + suffix, headers={**stranger, 'X-Room-Token': host['token']}, json=body)
            assert response.status_code == 403, response.text
        assert client.post(path + '/recover', headers=stranger).status_code == 403
        recovered = client.post(path + '/recover', headers=a)
        assert recovered.status_code == 200, recovered.text
        restored = recovered.json()['data']
        assert restored['seat'] == 'A' and restored['token'] != host['token']
        assert client.get(path, headers={**a, 'X-Room-Token': host['token']}).status_code == 403
        assert client.get(path, headers={**b, 'X-Room-Token': restored['token']}).status_code == 403
        assert client.get(path, headers={**b, 'X-Room-Token': guest['token']}).status_code == 200


def test_legacy_claim_needs_original_token_and_cannot_steal_bound_seat():
    store = InMemoryGameStore()
    with TestClient(create_app(store=store, require_auth=False)) as old:
        host = room(old, {})
    with TestClient(create_app(store=store)) as client:
        a, b = account(client), account(client)
        path = '/api/v1/remote/rooms/' + host['game_id']
        assert client.post(path + '/recover', headers=a).status_code == 403
        assert client.post(path + '/claim', headers=a).status_code == 403
        assert client.post(path + '/claim', headers={**a, 'X-Room-Token': 'wrong'}).status_code == 403
        claimed = client.post(path + '/claim', headers={**a, 'X-Room-Token': host['token']})
        assert claimed.status_code == 200, claimed.text
        token = claimed.json()['data']['token']
        assert client.post(path + '/claim', headers={**b, 'X-Room-Token': token}).status_code == 403
        assert client.post(path + '/recover', headers=a).json()['data']['seat'] == 'A'


def test_both_participants_have_own_cloud_history_stats_and_stranger_has_none():
    with TestClient(create_app(store=InMemoryGameStore())) as client:
        a, b, c = account(client), account(client), account(client)
        host = room(client, a)
        guest = client.post('/api/v1/remote/join', headers=b, json={
            'device_id': 'guest-device-456', 'invite_code': host['invite_code']}).json()['data']
        path = '/api/v1/remote/rooms/' + host['game_id']
        assert client.post(path + '/resign', headers={**b, 'X-Room-Token': guest['token']},
            json={'expected_version': 0, 'client_request_id': 'stats-resign-001'}).status_code == 200
        reviewed = client.post(path + '/review', headers={**a, 'X-Room-Token': host['token']})
        assert reviewed.status_code == 200 and reviewed.json()['data']['reviewedPlayer'] == 'A'
        for headers, seat, wins, losses in [(a, 'A', 1, 0), (b, 'B', 0, 1)]:
            rows = client.get('/api/v1/me/games', headers=headers).json()['data']['items']
            assert len(rows) == 1 and rows[0]['mode'] == 'REMOTE' and rows[0]['seat'] == seat
            assert rows[0]['reviewAvailable'] == (seat == 'A')
            stats = client.get('/api/v1/me/profile', headers=headers).json()['data']
            assert stats['games'] == stats['finishedGames'] == stats['remoteGames'] == 1
            assert (stats['remoteWins'], stats['remoteLosses']) == (wins, losses)
            assert stats['wins'] == stats['losses'] == 0
            assert stats['reviewedGames'] == (1 if seat == 'A' else 0)
        assert client.get('/api/v1/me/games', headers=c).json()['data']['items'] == []


def test_mixed_personal_pagination_returns_owned_remote_seats_without_duplicates():
    with TestClient(create_app(store=InMemoryGameStore())) as client:
        a, b = account(client), account(client)
        owned = client.post('/api/v1/game', headers=a, json={'mode': 'AI', 'first_player': 'A'}).json()['data']['game_id']
        host = room(client, a)
        other = room(client, b)
        joined = client.post('/api/v1/remote/join', headers=a, json={
            'device_id': 'second-seat-device', 'invite_code': other['invite_code']})
        assert joined.status_code == 200, joined.text
        items, cursor = [], None
        for _ in range(4):
            params = {'limit': 1, **({'cursor': cursor} if cursor else {})}
            page = client.get('/api/v1/me/games', headers=a, params=params).json()['data']
            items.extend(page['items'])
            cursor = page['nextCursor']
            if cursor is None:
                break
        assert len(items) == 3 and {row['gameId'] for row in items} == {owned, host['game_id'], other['game_id']}
        assert {row['gameId']: row['seat'] for row in items if row['mode'] == 'REMOTE'} == {
            host['game_id']: 'A', other['game_id']: 'B'}


def test_account_merge_moves_remote_participants_and_retired_writes_are_rejected():
    store = InMemoryGameStore()
    with TestClient(create_app(store=store)) as client:
        source = client.portal.call(store.register_device, 'source-device')
        target = client.portal.call(store.login_wechat, 'wechat-id', 'target-session',
            datetime.now(timezone.utc) + timedelta(days=1))
        state = client.portal.call(client.app.state.adapter.initialize, 'A')
        host = client.portal.call(store.create_remote_room, state, 'host-hash', 'ABCDEFGH',
            'device-host-123', False, datetime.now(), source)
        migrated = client.portal.call(store.login_wechat, 'wechat-id', 'new-session',
            datetime.now(timezone.utc) + timedelta(days=1), 'source-device')
        assert migrated == target
        assert client.portal.call(store.get_remote_room, host.game_id).host_user_id == target
        assert client.portal.call(store.personal_games, target, 10, None)[0][0]['seat'] == 'A'
        with pytest.raises(ApiError, match='Account was migrated'):
            client.portal.call(store.recover_remote_room, host.game_id, source, 'rotated')


def test_identity_merge_collision_is_rejected_atomically():
    store = InMemoryGameStore()
    with TestClient(create_app(store=store)) as client:
        source = client.portal.call(store.register_device, 'source-device')
        target = client.portal.call(store.login_wechat, 'wechat-id', 'target-session',
            datetime.now(timezone.utc) + timedelta(days=1))
        state = client.portal.call(client.app.state.adapter.initialize, 'A')
        host = client.portal.call(store.create_remote_room, state, 'host-hash', 'ABCDEFGH',
            'device-host-123', False, datetime.now() + timedelta(minutes=30), source)
        client.portal.call(store.join_remote_room, host.invite_code, 'guest-hash',
            'device-guest-456', datetime.now(), target)
        with pytest.raises(ApiError) as failure:
            client.portal.call(store.login_wechat, 'wechat-id', 'new-session',
                datetime.now(timezone.utc) + timedelta(days=1), 'source-device')
        assert failure.value.code == 'REMOTE_ACCOUNT_CONFLICT'
        unchanged = client.portal.call(store.get_remote_room, host.game_id)
        assert (unchanged.host_user_id, unchanged.guest_user_id) == (source, target)
        assert client.portal.call(store.resolve_device, 'source-device') == source


def test_inflight_room_write_rechecks_account_after_retirement():
    store = InMemoryGameStore()
    with TestClient(create_app(store=store)) as client:
        a, b = account(client), account(client)
        host = room(client, a)
        client.post('/api/v1/remote/join', headers=b, json={
            'device_id': 'guest-device-456', 'invite_code': host['invite_code']})
        owner = store._remote_rooms[host['game_id']].host_user_id
        original = store.commit_remote_resign

        async def retire_then_commit(*args, **kwargs):
            store._retired_users.add(owner)
            return await original(*args, **kwargs)

        store.commit_remote_resign = retire_then_commit
        response = client.post('/api/v1/remote/rooms/' + host['game_id'] + '/resign',
            headers={**a, 'X-Room-Token': host['token']},
            json={'expected_version': 0, 'client_request_id': 'inflight-resign-001'})
        assert response.status_code == 401 and response.json()['code'] == 'AUTH_INVALID'
        assert store._games[host['game_id']].state.game_status == 'PLAYING'


def test_cancelled_and_time_expired_waiting_rooms_do_not_reappear_as_playing_history(monkeypatch):
    from backend.app.services import remote_service
    with TestClient(create_app(store=InMemoryGameStore())) as client:
        a = account(client)
        host = room(client, a)
        assert client.post('/api/v1/remote/rooms/' + host['game_id'] + '/cancel',
            headers={**a, 'X-Room-Token': host['token']}).status_code == 200
        monkeypatch.setattr(remote_service, 'utc_now', lambda: datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=1))
        room(client, a)
        assert client.get('/api/v1/me/games', headers=a).json()['data']['items'] == []
        stats = client.get('/api/v1/me/profile', headers=a).json()['data']
        assert stats['games'] == stats['remoteGames'] == stats['finishedGames'] == 0


def test_read_rechecks_bound_account_after_route_authorization():
    store = InMemoryGameStore()
    with TestClient(create_app(store=store)) as client:
        a = account(client)
        host = room(client, a)
        original = client.app.state.remote_service.get
        async def rebind_before_read(*args, **kwargs):
            store._remote_rooms[host['game_id']] = replace(store._remote_rooms[host['game_id']],
                host_user_id='different-account')
            return await original(*args, **kwargs)
        client.app.state.remote_service.get = rebind_before_read
        response = client.get('/api/v1/remote/rooms/' + host['game_id'],
            headers={**a, 'X-Room-Token': host['token']})
        assert response.status_code == 403 and response.json()['code'] == 'REMOTE_ACCESS_DENIED'


@pytest.mark.parametrize('invalidation', ['retire', 'rotate'])
def test_remote_review_commit_rechecks_credentials_after_analysis(invalidation):
    store = InMemoryGameStore()
    with TestClient(create_app(store=store)) as client:
        a, b = account(client), account(client)
        host = room(client, a)
        guest = client.post('/api/v1/remote/join', headers=b, json={
            'device_id': 'guest-device-456', 'invite_code': host['invite_code']}).json()['data']
        path = '/api/v1/remote/rooms/' + host['game_id']
        client.post(path + '/resign', headers={**b, 'X-Room-Token': guest['token']},
            json={'expected_version': 0, 'client_request_id': 'review-race-resign-001'})
        owner = store._remote_rooms[host['game_id']].host_user_id
        original = store.commit_review
        async def invalidate_then_commit(*args, **kwargs):
            if invalidation == 'retire':
                store._retired_users.add(owner)
            else:
                await store.recover_remote_room(host['game_id'], owner, 'rotated-hash')
            return await original(*args, **kwargs)
        store.commit_review = invalidate_then_commit
        response = client.post(path + '/review', headers={**a, 'X-Room-Token': host['token']})
        assert response.status_code == (401 if invalidation == 'retire' else 403)
        assert store._reviews == {}


@pytest.mark.parametrize('method', ['get', 'post'])
def test_cached_remote_review_rechecks_token_after_replay(method):
    store = InMemoryGameStore()
    with TestClient(create_app(store=store)) as client:
        a, b = account(client), account(client)
        host = room(client, a)
        guest = client.post('/api/v1/remote/join', headers=b, json={
            'device_id': 'guest-device-456', 'invite_code': host['invite_code']}).json()['data']
        path = '/api/v1/remote/rooms/' + host['game_id']
        client.post(path + '/resign', headers={**b, 'X-Room-Token': guest['token']},
            json={'expected_version': 0, 'client_request_id': 'cached-review-resign-001'})
        headers = {**a, 'X-Room-Token': host['token']}
        assert client.post(path + '/review', headers=headers).status_code == 200
        owner = store._remote_rooms[host['game_id']].host_user_id
        service = client.app.state.remote_service.game_service
        name = '_get_review' if method == 'get' else '_create_review'
        original = getattr(service, name)
        async def rotate_after_replay(*args, **kwargs):
            result = await original(*args, **kwargs)
            await store.recover_remote_room(host['game_id'], owner, 'rotated-hash')
            return result
        setattr(service, name, rotate_after_replay)
        response = client.request(method, path + '/review', headers=headers)
        assert response.status_code == 403 and response.json()['code'] == 'REMOTE_ACCESS_DENIED'
