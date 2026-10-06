"""Run the remote account API contract against real isolated MySQL transactions."""
from datetime import datetime, timedelta, timezone
import pytest
from sqlalchemy.orm import Session

from backend.app.core.errors import ApiError
from backend.app.db.models import RemoteRoomModel, UserModel, GameReviewModel
from sqlalchemy import select
from backend.app.db.repositories.mysql_store import MySQLGameStore
from backend.app.schemas.remote import RemoteOperationRequest
from backend.tests.test_mysql_persistence import DB_URL, db, client, pytestmark
from backend.tests import test_remote_accounts as contracts


@pytest.mark.parametrize('contract', [
    contracts.test_remote_creation_requires_authentication,
    contracts.test_same_account_cannot_join_or_match_its_other_device_room,
    contracts.test_bound_tokens_require_their_account_and_recover_rotates_only_own_seat,
    contracts.test_legacy_claim_needs_original_token_and_cannot_steal_bound_seat,
    contracts.test_both_participants_have_own_cloud_history_stats_and_stranger_has_none,
    contracts.test_mixed_personal_pagination_returns_owned_remote_seats_without_duplicates,
])
def test_mysql_remote_account_contract(db, monkeypatch, contract):
    stores = []
    def make_store():
        store = MySQLGameStore(DB_URL)
        stores.append(store)
        return store
    monkeypatch.setattr(contracts, 'InMemoryGameStore', make_store)
    try:
        contract()
    finally:
        for store in stores:
            store.close()


def test_mysql_cancelled_and_expired_rooms_are_excluded(db, monkeypatch):
    store = MySQLGameStore(DB_URL)
    monkeypatch.setattr(contracts, "InMemoryGameStore", lambda: store)
    try:
        contracts.test_cancelled_and_time_expired_waiting_rooms_do_not_reappear_as_playing_history(monkeypatch)
    finally:
        store.close()


def test_mysql_participant_merge_recovery_restart_and_retired_transaction_writes(client, db):
    store = client.app.state.store
    source = client.portal.call(store.register_device, 'source-device')
    target = client.portal.call(store.login_wechat, 'identity', 'target-session',
        datetime.now(timezone.utc) + timedelta(days=1))
    state = client.portal.call(client.app.state.adapter.initialize, 'A')
    host = client.portal.call(store.create_remote_room, state, 'host-hash', 'ABCDEFGH',
        'host-device-123', False, datetime.now() + timedelta(minutes=30), source)
    client.portal.call(store.login_wechat, 'identity', 'new-session',
        datetime.now(timezone.utc) + timedelta(days=1), 'source-device')
    with Session(db) as session:
        assert session.get(RemoteRoomModel, host.game_id).host_user_id == target
    with pytest.raises(ApiError) as failure:
        store._commit_remote_resign(host.game_id, 'host-hash',
            RemoteOperationRequest(expected_version=0, client_request_id='retired-resign-001'), source)
    assert failure.value.code == 'AUTH_INVALID'
    with pytest.raises(ApiError) as failure:
        store._recover_remote_room(host.game_id, source, 'new-token')
    assert failure.value.code == 'AUTH_INVALID'
    restarted = MySQLGameStore(DB_URL)
    try:
        recovered = restarted._recover_remote_room(host.game_id, target, 'rotated-token')
        assert recovered.host_user_id == target and recovered.host_token_hash == 'rotated-token'
        rows, more = restarted._personal_games(target, 10, None, None)
        assert len(rows) == 1 and rows[0]['seat'] == 'A' and not more
    finally:
        restarted.close()


def test_mysql_merge_opposite_seats_rolls_back_without_retiring_source(client, db):
    store = client.app.state.store
    source = client.portal.call(store.register_device, 'source-device')
    target = client.portal.call(store.login_wechat, 'identity', 'target-session',
        datetime.now(timezone.utc) + timedelta(days=1))
    state = client.portal.call(client.app.state.adapter.initialize, 'A')
    host = client.portal.call(store.create_remote_room, state, 'host-hash', 'ABCDEFGH',
        'host-device-123', False, datetime.now() + timedelta(minutes=30), source)
    client.portal.call(store.join_remote_room, 'ABCDEFGH', 'guest-hash', 'guest-device-456', datetime.now(), target)
    with pytest.raises(ApiError) as failure:
        client.portal.call(store.login_wechat, 'identity', 'merged-session',
            datetime.now(timezone.utc) + timedelta(days=1), 'source-device')
    assert failure.value.code == 'REMOTE_ACCOUNT_CONFLICT'
    assert client.portal.call(store.resolve_device, 'source-device') == source
    with Session(db) as session:
        row = session.get(RemoteRoomModel, host.game_id)
        assert (row.host_user_id, row.guest_user_id) == (source, target)


@pytest.mark.parametrize('invalidation', ['retire', 'rotate'])
def test_mysql_review_rechecks_account_and_token_inside_commit(client, db, invalidation):
    a, b = contracts.account(client), contracts.account(client)
    host = contracts.room(client, a)
    guest = client.post('/api/v1/remote/join', headers=b, json={
        'device_id': 'review-guest-device', 'invite_code': host['invite_code']}).json()['data']
    path = '/api/v1/remote/rooms/' + host['game_id']
    client.post(path + '/resign', headers={**b, 'X-Room-Token': guest['token']},
        json={'expected_version': 0, 'client_request_id': 'mysql-review-race-resign'})
    store = client.app.state.store
    owner = client.portal.call(store.get_remote_room, host['game_id']).host_user_id
    original = store.commit_review
    async def invalidate_then_commit(*args, **kwargs):
        if invalidation == 'retire':
            with Session(db) as session, session.begin():
                session.get(UserModel, owner).external_user_id = None
        else:
            await store.recover_remote_room(host['game_id'], owner, 'rotated-hash')
        return await original(*args, **kwargs)
    store.commit_review = invalidate_then_commit
    response = client.post(path + '/review', headers={**a, 'X-Room-Token': host['token']})
    assert response.status_code == (401 if invalidation == 'retire' else 403), response.text
    with Session(db) as session:
        assert session.scalar(select(GameReviewModel).where(GameReviewModel.game_id == host['game_id'])) is None
