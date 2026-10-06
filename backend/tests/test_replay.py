"""Stored chronological replay, permissions and perspective filters."""
from dataclasses import replace
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient
from backend.app.main import create_app
from backend.app.schemas.game import GameState
from backend.app.services.game_store import InMemoryGameStore
from backend.tests.test_review import create_short_game
from backend.tests.test_remote_accounts import account, room


@pytest.fixture
def client():
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=False)) as value:
        yield value


def replay_assertions(client, game_id):
    store = client.app.state.store
    before = client.portal.call(store.get_snapshot, game_id)
    moves = client.portal.call(store.list_moves, game_id)
    reviews = dict(getattr(store, '_reviews', {}))
    with patch.object(client.app.state.adapter, 'execute_turn', side_effect=AssertionError('History must use saved snapshots')):
        response = client.get(f'/api/v1/game/{game_id}/replay')
    assert response.status_code == 200, response.text
    data = response.json()['data']
    assert data['version'] == before.version and data['ply_count'] == before.ply_count
    assert data['initial_state'] == before.initial_state.model_dump(mode='json')
    active = [item for item in moves if item.reverted_revision is None]
    steps = [step for step in data['steps'] if step['kind'] == 'MOVE']
    assert len(steps) == len(active) == before.ply_count
    for step, item in zip(steps, active):
        assert step['ply'] == item.turn_number
        assert step['version'] == item.created_revision
        assert step['move'] == item.turn.move.model_dump(by_alias=True)
        assert step['capture'] == item.turn.capture.model_dump(mode='json')
        assert step['state'] == item.turn.state.model_dump(mode='json')
        assert step['player'] == item.turn.before_state.current_player
    assert data['steps'][-1]['state'] == before.state.model_dump(mode='json')
    assert client.portal.call(store.get_snapshot, game_id) == before
    assert client.portal.call(store.list_moves, game_id) == moves
    assert getattr(store, '_reviews', {}) == reviews
    return data


def test_replay_natural_end_keeps_real_capture_and_reserves(client):
    data = replay_assertions(client, create_short_game(client))
    assert [step['kind'] for step in data['steps']] == ['MOVE']
    assert data['steps'][0]['capture']['was_applied'] is True
    assert data['steps'][0]['state']['game_status'] == 'FINISHED'


def test_replay_undo_shows_effective_branch_and_separate_resign(client):
    game_id = client.post('/api/v1/game', json={'mode': 'LOCAL'}).json()['data']['game_id']
    base = f'/api/v1/game/{game_id}'
    assert client.post(base + '/move', json={'from_node': 'P01', 'to_node': 'P02'}).status_code == 200
    assert client.post(base + '/undo', json={'expected_version': 1, 'client_request_id': 'replay-undo-001'}).status_code == 200
    assert client.post(base + '/move', json={'from_node': 'P01', 'to_node': 'P19'}).status_code == 200
    assert client.post(base + '/resign', json={'expected_version': 3, 'client_request_id': 'replay-resign-001'}).status_code == 200
    data = replay_assertions(client, game_id)
    assert [step['kind'] for step in data['steps']] == ['MOVE', 'RESIGN']
    assert [step['ply'] for step in data['steps']] == [1, 1]
    assert [step['version'] for step in data['steps']] == [3, 4]
    assert data['steps'][1]['move'] is None and data['steps'][1]['capture'] is None
    assert data['steps'][0]['move']['to'] == 'P19'


def test_replay_synced_import_zero_move_resign_has_initial_and_terminal(client):
    client.app.state.require_auth = True
    headers = account(client)
    client.headers.update(headers)
    game = client.post('/api/v1/game/import-local', headers=headers, json={
        'clientGameId': 'replay-local-zero', 'firstPlayer': 'B', 'moves': [], 'resigningPlayer': 'B'}).json()['data']
    data = replay_assertions(client, game['game_id'])
    assert data['version'] == 1 and data['ply_count'] == 0
    assert len(data['steps']) == 1 and data['steps'][0]['kind'] == 'RESIGN'
    assert data['steps'][0]['ply'] == 0 and data['steps'][0]['player'] == 'B'


@pytest.mark.parametrize('corruption', ['count', 'number', 'before', 'final'])
def test_replay_rejects_corrupt_history(client, corruption):
    game_id = create_short_game(client)
    store = client.app.state.store
    if corruption == 'count':
        store._games[game_id] = replace(store._games[game_id], ply_count=2)
    elif corruption == 'final':
        old = store._games[game_id]
        store._games[game_id] = replace(old, state=old.initial_state)
    else:
        item = store._moves[game_id][0]
        store._moves[game_id][0] = replace(item, turn_number=2) if corruption == 'number' else replace(
            item, turn=item.turn.model_copy(update={'before_state': item.turn.state}))
    response = client.get(f'/api/v1/game/{game_id}/replay')
    assert response.status_code == 500 and response.json()['code'] == 'REPLAY_INTEGRITY_ERROR'


def test_replay_requires_owner_and_remote_requires_both_account_and_seat():
    with TestClient(create_app(store=InMemoryGameStore())) as client:
        a, b, stranger = account(client), account(client), account(client)
        game_id = client.post('/api/v1/game', headers=a, json={'mode': 'LOCAL'}).json()['data']['game_id']
        path = f'/api/v1/game/{game_id}/replay'
        assert client.get(path).status_code == 401
        assert client.get(path, headers=stranger).status_code == 403
        assert client.get(path, headers=a).status_code == 200
        host = room(client, a)
        guest = client.post('/api/v1/remote/join', headers=b, json={
            'device_id': 'replay-guest-device', 'invite_code': host['invite_code']}).json()['data']
        remote = f'/api/v1/remote/rooms/{host["game_id"]}/replay'
        for headers in [stranger, {**stranger, 'X-Room-Token': host['token']},
                        {**a, 'X-Room-Token': guest['token']}, {**a, 'X-Room-Token': 'bad'}]:
            assert client.get(remote, headers=headers).status_code == 403
        for headers, token in [(a, host['token']), (b, guest['token'])]:
            assert client.get(remote, headers={**headers, 'X-Room-Token': token}).status_code == 200
            denied = client.get(f'/api/v1/game/{host["game_id"]}/replay', headers=headers)
            assert denied.status_code == 403 and denied.json()['code'] == 'REMOTE_ACTION_REQUIRED'

@pytest.mark.parametrize('revision', [0, 99])
def test_replay_rejects_move_revision_outside_header(client, revision):
    game_id = create_short_game(client)
    store = client.app.state.store
    store._moves[game_id][0] = replace(store._moves[game_id][0], created_revision=revision)
    response = client.get(f'/api/v1/game/{game_id}/replay')
    assert response.status_code == 500 and response.json()['code'] == 'REPLAY_INTEGRITY_ERROR'


def test_replay_rejects_repeated_revision_but_allows_undo_header_gap(client):
    game_id = client.post('/api/v1/game', json={'mode': 'LOCAL'}).json()['data']['game_id']
    base = f'/api/v1/game/{game_id}'
    assert client.post(base + '/move', json={'from_node': 'P01', 'to_node': 'P02'}).status_code == 200
    assert client.post(base + '/move', json={'from_node': 'P05', 'to_node': 'P04'}).status_code == 200
    store = client.app.state.store
    second = store._moves[game_id][1]
    store._moves[game_id][1] = replace(second, created_revision=1)
    denied = client.get(base + '/replay')
    assert denied.status_code == 500 and denied.json()['code'] == 'REPLAY_INTEGRITY_ERROR'
    store._moves[game_id][1] = second
    assert client.post(base + '/undo', json={'expected_version': 2, 'client_request_id': 'replay-version-gap'}).status_code == 200
    response = client.get(base + '/replay')
    assert response.status_code == 200
    data = response.json()['data']
    assert data['version'] == 3 and data['steps'][0]['version'] == 1 and data['ply_count'] == 1

def test_replay_natural_terminal_revision_must_match_header(client):
    game_id = create_short_game(client)
    store = client.app.state.store
    store._games[game_id] = replace(store._games[game_id], version=2)
    response = client.get(f'/api/v1/game/{game_id}/replay')
    assert response.status_code == 500 and response.json()['code'] == 'REPLAY_INTEGRITY_ERROR'


def test_new_replay_requires_legacy_seat_claim_before_account_access():
    store = InMemoryGameStore()
    with TestClient(create_app(store=store, require_auth=False)) as legacy:
        host = room(legacy, {})
        assert legacy.get(f'/api/v1/remote/rooms/{host["game_id"]}/replay', headers={'X-Room-Token': host['token']}).status_code == 200
    with TestClient(create_app(store=store)) as client:
        headers = account(client)
        path = f'/api/v1/remote/rooms/{host["game_id"]}'
        credential = {**headers, 'X-Room-Token': host['token']}
        assert client.get(path, headers=credential).status_code == 200  # Existing probe enables claim.
        response = client.get(path + '/replay', headers=credential)
        assert response.status_code == 403 and response.json()['code'] == 'REMOTE_ACCESS_DENIED'
        claimed = client.post(path + '/claim', headers=credential)
        assert claimed.status_code == 200, claimed.text
        token = claimed.json()['data']['token']
        assert client.get(path + '/replay', headers={**headers, 'X-Room-Token': token}).status_code == 200
