"""New multi-piece terminal survives real MySQL persistence and remote reads."""
import pytest
from sqlalchemy.orm import Session
from backend.tests.test_mysql_persistence import (
    db, client, pytestmark, seed_position, game_and_moves, new_account_headers,
)
from backend.tests.test_player_immobilization import PIECES
from backend.app.db.models import GameModel
from backend.app.schemas.game import BoardState, GameState


@pytest.mark.parametrize("mode", ["LOCAL", "AI"])
def test_mysql_blockade_terminal_history_and_replay(client, db, mode):
    game_id = seed_position(client, db, PIECES, reserve_a=1, mode=mode,
                            ai_player="A" if mode == "AI" else None)
    endpoint = "ai-move" if mode == "AI" else "move"
    body = {} if mode == "AI" else {"from_node": "P08", "to_node": "P03"}
    response = client.post(f"/api/v1/game/{game_id}/{endpoint}", json=body)
    assert response.status_code == 200, response.text
    turn = response.json()["data"]["turn"]
    assert turn["game_over"] is True
    assert turn["winner"] == "A"
    assert turn["winner_reason"] == "ALL_PIECES_IMMOBILIZED"
    game, moves = game_and_moves(db, game_id)
    assert game.status == "FINISHED" and game.finished_at is not None
    assert game.winner_reason == "ALL_PIECES_IMMOBILIZED"
    assert len(moves) == 1 and moves[0].winner_reason == game.winner_reason
    if mode == "AI":
        assert moves[0].actor_type == "AI" and moves[0].ai_search_result is not None
    history = client.get("/api/v1/me/games?status=FINISHED").json()["data"]["items"]
    assert history[0]["gameId"] == game_id and history[0]["winnerReason"] == game.winner_reason
    replay = client.get(f"/api/v1/game/{game_id}/replay")
    assert replay.status_code == 200, replay.text
    assert replay.json()["data"]["steps"][-1]["state"] == game.current_state
    denied = client.post(f"/api/v1/game/{game_id}/move", json={"from_node": "P26", "to_node": "P03"})
    assert denied.status_code == 409 and denied.json()["code"] == "GAME_ALREADY_FINISHED"


def test_mysql_remote_blockade_finishes_both_seats_history_and_saved_replay(client, db):
    host = client.post("/api/v1/remote/rooms", json={"device_id": "blockade-sql-host", "public": False}).json()["data"]
    guest_auth = new_account_headers(client)
    joined = client.post("/api/v1/remote/join", headers=guest_auth,
                         json={"device_id": "blockade-sql-guest", "invite_code": host["invite_code"]})
    assert joined.status_code == 200, joined.text
    guest = joined.json()["data"]
    game_id = host["game_id"]
    with Session(db) as session, session.begin():
        game = session.get(GameModel, game_id)
        state = GameState.model_validate(game.current_state)
        occupancy = {node: PIECES.get(node) for node in state.board.occupancy}
        custom = state.model_copy(update={"board": BoardState(occupancy=occupancy)})
        game.initial_state = custom.model_dump()
        game.current_state = custom.model_dump()
    host_headers = {"X-Room-Token": host["token"]}
    guest_headers = {**guest_auth, "X-Room-Token": guest["token"]}
    path = f"/api/v1/remote/rooms/{game_id}"
    body = {"from_node": "P08", "to_node": "P03", "expected_version": 0,
            "client_request_id": "blockade-sql-move-001"}
    response = client.post(path + "/move", headers=host_headers, json=body)
    assert response.status_code == 200, response.text
    result = response.json()["data"]
    assert result["turn"]["winner_reason"] == "ALL_PIECES_IMMOBILIZED"
    assert client.post(path + "/move", headers=host_headers, json=body).json()["data"] == result
    with Session(db) as session:
        assert session.get(GameModel, game_id).status == "FINISHED"
    for headers in (host_headers, guest_headers):
        room = client.get(path, headers=headers)
        assert room.status_code == 200, room.text
        assert room.json()["data"]["room_status"] == "FINISHED"
        assert room.json()["data"]["state"]["winner_reason"] == "ALL_PIECES_IMMOBILIZED"
        replay = client.get(path + "/replay", headers=headers)
        assert replay.status_code == 200, replay.text
        assert replay.json()["data"]["steps"][-1]["state"] == result["turn"]["state"]
        history = client.get("/api/v1/me/games?status=FINISHED", headers=headers).json()["data"]["items"]
        assert history[0]["gameId"] == game_id and history[0]["winnerReason"] == "ALL_PIECES_IMMOBILIZED"
