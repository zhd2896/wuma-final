"""Review API exercises real Node search with saved in-memory turn snapshots."""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.app.core.errors import ApiError
from backend.app.main import create_app
from backend.app.schemas.game import BoardState, GameState, Move
from backend.app.services.game_store import InMemoryGameStore


@pytest.fixture
def client():
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=False)) as value:
        yield value


def create_short_game(client, *, finish=True, mode="LOCAL"):
    body = {"first_player": "A", "mode": mode}
    if mode == "AI":
        body.update({"ai_player": "B", "ai_level": "STANDARD"})
    created = client.post("/api/v1/game", json=body)
    assert created.status_code == 200, created.text
    game = created.json()["data"]
    game_id = game["game_id"]
    state = GameState.model_validate(game["state"])
    occupancy = {node: None for node in state.board.occupancy}
    occupancy.update({"P11": "A", "P12": "B", "P08": "B", "P18": "B", "P19": "A"})
    custom = state.model_copy(update={"board": BoardState(occupancy=occupancy)})
    client.portal.call(client.app.state.store.update, game_id, custom)
    if finish:
        moved = client.post(f"/api/v1/game/{game_id}/move",
                            json={"from_node": "P19", "to_node": "P13"})
        assert moved.status_code == 200, moved.text
    return game_id


def test_finished_review_is_idempotent_and_never_changes_the_game(client):
    game_id = create_short_game(client)
    before = client.get(f"/api/v1/game/{game_id}").json()["data"]
    moves_before = client.portal.call(client.app.state.store.list_moves, game_id)
    response = client.post(f"/api/v1/game/{game_id}/review", json={})
    assert response.status_code == 200, response.text
    review = response.json()["data"]
    assert review["reviewedPlayer"] == "A"
    assert review["winner"] == "A" and review["winnerReason"] == "CAPTURE_ALL"
    assert review["reviewConfigVersion"] == 1
    assert review["overallScore"] is None
    assert len(review["moveReviews"]) == 1
    item = review["moveReviews"][0]
    assert item["turn"] == 1 and item["player"] == "A"
    assert item["actualMove"] == {"from": "P19", "to": "P13"}
    assert item["bestScore"] - item["actualMoveScore"] == item["scoreLoss"]
    assert item["scorePerspective"] == "A"
    assert item["category"] in ("GOOD", "NORMAL", "MISTAKE", "BLUNDER")
    assert sum(review[key] for key in ("goodMoves", "normalMoves", "mistakes", "blunders")) == 1
    assert review["bestMoveRate"] == int(item["bestMoveEquivalent"])
    assert client.get(f"/api/v1/game/{game_id}/review").json()["data"] == review
    assert client.post(f"/api/v1/game/{game_id}/review", json={}).json()["data"] == review
    assert client.get(f"/api/v1/game/{game_id}").json()["data"] == before
    assert client.portal.call(client.app.state.store.list_moves, game_id) == moves_before


def test_review_rejects_unfinished_and_unknown_games(client):
    game_id = create_short_game(client, finish=False)
    denied = client.post(f"/api/v1/game/{game_id}/review", json={})
    assert denied.status_code == 409 and denied.json()["code"] == "GAME_NOT_FINISHED"
    missing = client.get("/api/v1/game/missing/review")
    assert missing.status_code == 404 and missing.json()["code"] == "GAME_NOT_FOUND"
    absent = client.get(f"/api/v1/game/{game_id}/review")
    assert absent.status_code == 404 and absent.json()["code"] == "REVIEW_NOT_FOUND"


def test_worker_failure_leaves_no_partial_review(client):
    game_id = create_short_game(client)
    with patch.object(client.app.state.adapter, "review_move",
                      side_effect=ApiError("ENGINE_UNAVAILABLE", "offline")):
        denied = client.post(f"/api/v1/game/{game_id}/review", json={})
    assert denied.status_code == 503 and denied.json()["code"] == "ENGINE_UNAVAILABLE"
    assert client.get(f"/api/v1/game/{game_id}/review").json()["code"] == "REVIEW_NOT_FOUND"


def test_local_review_can_select_the_other_player_without_counting_a_moves(client):
    game_id = create_short_game(client)
    response = client.post(f"/api/v1/game/{game_id}/review", json={"reviewed_player": "B"})
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["reviewedPlayer"] == "B"
    assert data["moveReviews"] == [] and data["bestMoveRate"] == 0
    assert data["goodMoves"] == data["normalMoves"] == data["mistakes"] == data["blunders"] == 0


def test_ai_review_counts_only_human_turns(client):
    game_id = create_short_game(client, finish=False, mode="AI")
    first = client.post(f"/api/v1/game/{game_id}/move",
                        json={"from_node": "P11", "to_node": "P01"})
    assert first.status_code == 200, first.text
    state = GameState.model_validate(first.json()["data"]["turn"]["state"])
    ai_turn = client.portal.call(client.app.state.adapter.execute_turn, state,
                                 Move(from_node="P12", to_node="P07"))
    client.portal.call(client.app.state.store.commit_turn, game_id, 1, ai_turn, "AI")
    final = client.post(f"/api/v1/game/{game_id}/move",
                        json={"from_node": "P19", "to_node": "P13"})
    assert final.status_code == 200, final.text
    response = client.post(f"/api/v1/game/{game_id}/review", json={})
    assert response.status_code == 200, response.text
    review = response.json()["data"]
    assert [item["turn"] for item in review["moveReviews"]] == [1, 3]
    assert all(item["player"] == "A" for item in review["moveReviews"])
    assert sum(review[key] for key in ("goodMoves", "normalMoves", "mistakes", "blunders")) == 2
    denied = client.post(f"/api/v1/game/{game_id}/review", json={"reviewed_player": "B"})
    assert denied.status_code == 422 and denied.json()["code"] == "INVALID_REQUEST"
