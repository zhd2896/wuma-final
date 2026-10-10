"""User-facing archive identity and authoritative opponent-move continuity."""
from fastapi.testclient import TestClient
from dataclasses import replace
import pytest
from backend.app.main import create_app
from backend.app.services.game_store import InMemoryGameStore
from backend.tests.test_local_import import client, payload
from backend.tests.test_remote import data, playing_room, remote_move, remote_operation


def test_trial_archive_identity_survives_cloud_listing_and_active_replay(client):
    imported = data(client.post('/api/v1/game/import-local', json=payload(clientGameId='trial-archive-001')))
    rows = data(client.get('/api/v1/me/games'))['items']
    assert rows[0]['sourceKind'] == 'TRIAL'
    assert rows[0]['gameId'] == imported['game_id']
    replay = data(client.get(f"/api/v1/game/{imported['game_id']}/replay"))
    assert replay['ply_count'] == 2


def test_room_query_reports_last_effective_turn_and_undo_clears_stale_turn():
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=False)) as c:
        game, host, guest = playing_room(c)
        data(remote_move(c, game, host, 'P01', 'P02', 0, 'ux-move-A-001'))
        room = data(c.get(f'/api/v1/remote/rooms/{game}', headers=guest))
        assert room['last_turn']['version'] == 1
        assert room['last_turn']['ply'] == 1
        assert room['last_turn']['move'] == {'from': 'P01', 'to': 'P02'}
        assert room['last_turn']['captures']['was_applied'] is False
        data(remote_move(c, game, guest, 'P05', 'P04', 1, 'ux-move-B-001'))
        requested = data(remote_operation(c, game, 'undo-requests', host, 2, 'ux-undo-request-001'))
        undo = requested['pending_undo']['id']
        accepted = data(remote_operation(c, game, f'undo-requests/{undo}/accept', guest, 2, 'ux-undo-accept-001'))
        assert accepted['ply_count'] == 0
        assert accepted['last_turn'] is None


@pytest.mark.parametrize('pieces,expected', [
    ({'P11': 'A', 'P12': 'B', 'P19': 'A', 'P25': 'B'}, ['P12']),
    ({'P08': 'B', 'P18': 'B', 'P19': 'A', 'P01': 'B'}, ['P08', 'P18']),
])
def test_room_query_keeps_exact_clamp_and_carry_captures_for_the_other_device(pieces, expected):
    store = InMemoryGameStore()
    with TestClient(create_app(store=store, require_auth=False)) as c:
        game, host, guest = playing_room(c)
        saved = store._games[game]
        state = saved.state.model_copy(deep=True)
        state.board.occupancy = {node: pieces.get(node) for node in state.board.occupancy}
        store._games[game] = replace(saved, state=state, initial_state=state)
        moved = data(remote_move(c, game, host, 'P19', 'P13', 0, 'ux-capture-001'))
        queried = data(c.get(f'/api/v1/remote/rooms/{game}', headers=guest))
        assert queried['last_turn']['captures'] == moved['turn']['captures']
        assert sorted(queried['last_turn']['captures']['captured_nodes']) == sorted(expected)
        assert queried['last_turn']['captures']['reserve_used'] == len(expected)
