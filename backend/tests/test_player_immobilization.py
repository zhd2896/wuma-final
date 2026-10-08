"""Real shared worker adjudicates multiple blocked pieces at the turn boundary."""
import pytest
from dataclasses import replace
from fastapi.testclient import TestClient
from backend.tests.test_api import client, seed_position
from backend.tests.test_remote import data, playing_room, remote_move
from backend.app.main import create_app
from backend.app.services.game_store import InMemoryGameStore
from backend.app.schemas.game import BoardState

PIECES = {"P26": "B", "P29": "B", "P27": "A", "P28": "A", "P08": "A",
          "P05": "A", "P10": "A", "P15": "A", "P20": "A", "P25": "A"}


@pytest.mark.parametrize("mode", ["LOCAL", "AI"])
def test_last_exit_blockade_ends_before_next_player_can_move(client, mode):
    game_id = seed_position(client, PIECES, mode=mode, ai_player="B" if mode == "AI" else None)
    response = client.post(f"/api/v1/game/{game_id}/move", json={"from_node": "P08", "to_node": "P03"})
    assert response.status_code == 200, response.text
    turn = response.json()["data"]["turn"]
    assert turn["game_over"] is True
    assert turn["winner"] == "A"
    assert turn["winner_reason"] == "ALL_PIECES_IMMOBILIZED"
    assert turn["state"]["current_player"] == "B"
    replay = client.get(f"/api/v1/game/{game_id}/replay")
    assert replay.status_code == 200, replay.text
    assert replay.json()["data"]["steps"][-1]["state"] == turn["state"]
    for endpoint, body in [("move", {"from_node": "P26", "to_node": "P03"}), ("ai-move", {})]:
        denied = client.post(f"/api/v1/game/{game_id}/{endpoint}", json=body)
        assert denied.status_code == 409
        assert denied.json()["code"] == "GAME_ALREADY_FINISHED"


def test_remote_both_seats_observe_finished_blockade_and_move_retry_is_idempotent():
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=False)) as client:
        game_id, host, guest = playing_room(client)
        snapshot = client.portal.call(client.app.state.store.get_snapshot, game_id)
        occupancy = {node: PIECES.get(node) for node in snapshot.state.board.occupancy}
        state = snapshot.state.model_copy(update={"board": BoardState(occupancy=occupancy)})
        client.portal.call(client.app.state.store.update, game_id, state)
        response = remote_move(client, game_id, host, "P08", "P03", 0, "blocked-room-001")
        result = data(response)
        assert result["turn"]["winner_reason"] == "ALL_PIECES_IMMOBILIZED"
        assert result["turn"]["game_over"] is True
        repeated = remote_move(client, game_id, host, "P08", "P03", 0, "blocked-room-001")
        assert data(repeated) == result
        for headers in (host, guest):
            room = data(client.get(f"/api/v1/remote/rooms/{game_id}", headers=headers))
            assert room["room_status"] == "FINISHED"
            assert room["state"]["winner"] == "A"
            assert room["state"]["winner_reason"] == "ALL_PIECES_IMMOBILIZED"
        denied = remote_move(client, game_id, guest, "P26", "P03", 1, "blocked-room-002")
        assert denied.status_code == 409
        assert denied.json()["code"] == "GAME_ALREADY_FINISHED"
        stored = client.portal.call(client.app.state.store.list_moves, game_id)
        assert len(stored) == 1
        assert stored[0].turn.state.winner_reason == "ALL_PIECES_IMMOBILIZED"


def test_legacy_blockade_then_resignation_can_generate_review_without_rewriting_history(client):
    game_id = seed_position(client, PIECES)
    result = client.post(f"/api/v1/game/{game_id}/move", json={"from_node": "P08", "to_node": "P03"})
    assert result.status_code == 200, result.text
    store = client.app.state.store
    snapshot = client.portal.call(store.get_snapshot, game_id)
    legacy_state = snapshot.state.model_copy(update={"game_status": "PLAYING", "winner": None, "winner_reason": None})
    # Reconstruct the persisted pre-rule-change transition, not a new legal move.
    store._games[game_id] = replace(snapshot, state=legacy_state)
    recorded = store._moves[game_id][0]
    legacy_turn = recorded.turn.model_copy(update={"state": legacy_state, "game_over": False,
                                                 "winner": None, "winner_reason": None})
    store._moves[game_id] = [replace(recorded, turn=legacy_turn)]
    resigned = client.post(f"/api/v1/game/{game_id}/resign", json={"expected_version": 1,
                            "client_request_id": "legacy-blockade-resign-001"})
    assert resigned.status_code == 200, resigned.text
    before = client.get(f"/api/v1/game/{game_id}").json()["data"]
    replay_before = client.get(f"/api/v1/game/{game_id}/replay").json()["data"]
    assert replay_before["steps"][0]["state"]["game_status"] == "PLAYING"
    assert replay_before["steps"][-1]["state"]["winner_reason"] == "RESIGN"
    reviewed = client.post(f"/api/v1/game/{game_id}/review", json={"reviewed_player": "A"})
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()["data"]["winnerReason"] == "RESIGN"
    assert "现行规则" in reviewed.json()["data"]["moveReviews"][0]["engineExplanation"]
    assert client.get(f"/api/v1/game/{game_id}").json()["data"] == before
    assert client.get(f"/api/v1/game/{game_id}/replay").json()["data"] == replay_before
