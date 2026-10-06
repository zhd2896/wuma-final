"""Real MySQL profile persistence and final ordinary actor authorization."""
from sqlalchemy import event
import pytest
from backend.tests.test_mysql_persistence import db, client, pytestmark
from backend.tests.test_ordinary_actor_races import exercise_race, CASES
from backend.tests.test_wechat_auth import FakeWechat, login
from backend.app.db.repositories.mysql_store import MySQLGameStore
from backend.tests.test_profile_edit import exercise_profile_actor_race
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from datetime import datetime, timedelta, timezone
from backend.app.api.v1.account import _token_hash
from backend.app.schemas.game import Move
from backend.app.core.errors import ApiError


def test_mysql_profile_final_actor_validation(client):
    exercise_profile_actor_race(client)


@pytest.mark.parametrize('operation,boundary', CASES)
def test_mysql_ordinary_merge_races(client, operation, boundary):
    exercise_race(client, operation, boundary)


@pytest.mark.parametrize('existing', [False, True])
def test_mysql_profile_persists_restarted_login_and_merge(client, db, existing):
    client.app.state.wechat_auth = FakeWechat()
    if existing:
        target = login(client).json()['data']
        client.headers['Authorization'] = 'Bearer ' + target['token']
        assert client.post('/api/v1/me/profile', json={'nickname': '目标😀', 'avatar': 'piece_v1_ma'}).status_code == 200
    old = client.post('/api/v1/auth/device').json()['data']
    client.headers['Authorization'] = 'Bearer ' + old['token']
    assert client.post('/api/v1/me/profile', json={'nickname': '来源😀', 'avatar': 'piece_v1_pao'}).status_code == 200
    account = login(client, device_token=old['token']).json()['data']
    restarted = MySQLGameStore(str(db.url))
    try:
        profile = client.portal.call(restarted.personal_profile, account['userId'])
        assert (profile['nickname'], profile['avatar']) == (('目标😀', 'piece_v1_ma') if existing else ('来源😀', 'piece_v1_pao'))
        client.headers['Authorization'] = 'Bearer ' + old['token']
        assert client.post('/api/v1/me/profile', json={'nickname': '过期', 'avatar': 'piece_v1_shi'}).status_code == 401
    finally:
        restarted.close()


def test_mysql_ordinary_lock_order_users_before_game_before_review(client):
    from backend.tests.test_training import finished_review
    client.app.state.wechat_auth = FakeWechat()
    account = login(client).json()['data']; client.headers['Authorization'] = 'Bearer ' + account['token']
    game, _ = finished_review(client)
    store = client.app.state.store; locks = []
    def record(conn, cursor, statement, parameters, context, executemany):
        normalized = ' '.join(statement.lower().split())
        if 'for update' in normalized:
            locks.append(normalized)
    event.listen(store.engine, 'before_cursor_execute', record)
    try:
        assert client.post(f'/api/v1/game/{game}/review/explain', json={}).status_code == 200
    finally:
        event.remove(store.engine, 'before_cursor_execute', record)
    tables = ['users' if 'from users ' in sql else 'games' if 'from games ' in sql else 'reviews' if 'from game_reviews ' in sql else 'other' for sql in locks]
    assert tables[:3] == ['users', 'games', 'reviews'], tables


def test_mysql_merge_holds_user_lock_and_waiting_old_turn_is_rejected(client):
    """Two real database transactions: merge owns User locks before old actor can commit."""
    app = client.app; store = app.state.store; app.state.wechat_auth = FakeWechat()
    target = login(client).json()['data']
    old = client.post('/api/v1/auth/device').json()['data']
    client.headers['Authorization'] = 'Bearer ' + old['token']
    game = client.post('/api/v1/game', json={'mode': 'LOCAL'}).json()['data']['game_id']
    snapshot = client.portal.call(store.get_snapshot, game)
    turn = client.portal.call(app.state.adapter.execute_turn, snapshot.state, Move(from_node='P01', to_node='P02'))
    merge_locked, release_merge, commit_attempted = Event(), Event(), Event()
    def after(conn, cursor, statement, parameters, context, many):
        sql = ' '.join(statement.lower().split())
        if 'from users ' in sql and 'for update' in sql and 'order by users.id' in sql:
            merge_locked.set()
            assert release_merge.wait(10), 'merge was not released'
    def before(conn, cursor, statement, parameters, context, many):
        sql = ' '.join(statement.lower().split())
        if 'from users ' in sql and 'for update' in sql and 'order by users.id' not in sql:
            commit_attempted.set()
    event.listen(store.engine, 'after_cursor_execute', after)
    event.listen(store.engine, 'before_cursor_execute', before)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            merging = pool.submit(store._login_wechat, 'wx-test-app:alice', '7' * 64,
                datetime.now(timezone.utc) + timedelta(days=1), _token_hash(old['token']))
            try:
                assert merge_locked.wait(5)
                writing = pool.submit(store._commit_turn, game, 0, turn, 'HUMAN', None, old['userId'])
                assert commit_attempted.wait(5)
                assert not writing.done(), 'old actor write did not wait on merge user lock'
            finally:
                release_merge.set()
            assert merging.result(timeout=10) == target['userId']
            with pytest.raises(ApiError) as exc:
                writing.result(timeout=10)
            assert exc.value.code == 'AUTH_INVALID'
    finally:
        release_merge.set()
        event.remove(store.engine, 'after_cursor_execute', after)
        event.remove(store.engine, 'before_cursor_execute', before)
    assert client.portal.call(store.get_snapshot, game).version == 0
    assert client.portal.call(store.list_moves, game) == []
    client.headers['Authorization'] = 'Bearer ' + target['token']
    assert client.post(f'/api/v1/game/{game}/move', json={'from_node': 'P01', 'to_node': 'P02'}).status_code == 200
