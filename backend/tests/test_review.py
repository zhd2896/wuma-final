"""Review API exercises real Node search with saved in-memory turn snapshots."""

from datetime import UTC, datetime
from dataclasses import replace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.app.core.errors import ApiError
from backend.app.main import create_app
from backend.app.schemas.game import BoardState, GameReview, GameState, Move
from backend.app.services.game_store import InMemoryGameStore, StoredTerminalEvent
from backend.app.services.review_explanation.fallback import fallback_game


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


def test_fallback_review_explains_resignation():
    review = GameReview(
        id="review-resign",
        gameId="game-resign",
        reviewedPlayer="A",
        overallScore=None,
        goodMoves=0,
        normalMoves=0,
        mistakes=0,
        blunders=0,
        bestMoveRate=0,
        turningPoints=[],
        winner="A",
        winnerReason="RESIGN",
        reviewConfig={},
        reviewConfigVersion=1,
        moveReviews=[],
        createdAt=datetime.now(UTC),
    )

    explanation = fallback_game(review)

    assert "认输" in explanation.overall_summary


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


def test_zero_move_resignation_requires_matching_terminal_event_and_fabricates_no_move(client):
    store = client.app.state.store
    created = client.post("/api/v1/game", json={"first_player": "A", "mode": "LOCAL"})
    game_id = created.json()["data"]["game_id"]
    original = store._games[game_id]
    resigned = original.state.model_copy(update={
        "game_status": "FINISHED", "winner": "B", "winner_reason": "RESIGN",
    })
    store._games[game_id] = replace(
        original, state=resigned, version=1, ply_count=0,
    )
    store._terminal_events[game_id] = StoredTerminalEvent(
        game_id=game_id, client_request_id="resign-zero-0001",
        revision=1, event_type="RESIGN", actor="A", winner="B",
        state_before=original.initial_state, state_after=resigned,
    )

    with patch.object(client.app.state.adapter, "review_move",
                      side_effect=AssertionError("zero-move review must not call the adapter")):
        response = client.post(f"/api/v1/game/{game_id}/review", json={})
    frames = client.portal.call(client.app.state.service.replay_game, game_id)

    assert response.status_code == 200, response.text
    review = response.json()["data"]
    assert review["winner"] == "B" and review["winnerReason"] == "RESIGN"
    assert review["moveReviews"] == []
    assert frames == [original.initial_state, resigned]


def test_resignation_replay_rejects_winner_as_terminal_event_actor(client):
    store = client.app.state.store
    created = client.post("/api/v1/game", json={"first_player": "A", "mode": "LOCAL"})
    game_id = created.json()["data"]["game_id"]
    original = store._games[game_id]
    resigned = original.state.model_copy(update={
        "game_status": "FINISHED", "winner": "B", "winner_reason": "RESIGN",
    })
    store._games[game_id] = replace(
        original, state=resigned, version=1, ply_count=0,
    )
    store._terminal_events[game_id] = StoredTerminalEvent(
        game_id=game_id, client_request_id="resign-winner-actor-0001",
        revision=1, event_type="RESIGN", actor="B", winner="B",
        state_before=original.initial_state, state_after=resigned,
    )

    with pytest.raises(ApiError) as error:
        client.portal.call(client.app.state.service.replay_game, game_id)

    assert error.value.code == "REPLAY_INTEGRITY_ERROR"


def test_resignation_replay_rejects_already_finished_terminal_event_prestate(client):
    store = client.app.state.store
    created = client.post("/api/v1/game", json={"first_player": "A", "mode": "LOCAL"})
    game_id = created.json()["data"]["game_id"]
    original = store._games[game_id]
    before = original.initial_state.model_copy(update={"game_status": "FINISHED"})
    after = before.model_copy(update={"winner": "B", "winner_reason": "RESIGN"})
    store._games[game_id] = replace(
        original, initial_state=before, state=after, version=1, ply_count=0,
    )
    store._terminal_events[game_id] = StoredTerminalEvent(
        game_id=game_id, client_request_id="resign-finished-before-0001",
        revision=1, event_type="RESIGN", actor="A", winner="B",
        state_before=before, state_after=after,
    )

    with pytest.raises(ApiError) as error:
        client.portal.call(client.app.state.service.replay_game, game_id)

    assert error.value.code == "REPLAY_INTEGRITY_ERROR"


@pytest.mark.parametrize("mutation", ["board", "players"])
def test_resignation_replay_rejects_state_changes_beyond_terminal_metadata(client, mutation):
    store = client.app.state.store
    created = client.post("/api/v1/game", json={"first_player": "A", "mode": "LOCAL"})
    game_id = created.json()["data"]["game_id"]
    original = store._games[game_id]
    before = original.initial_state
    changes = {"game_status": "FINISHED", "winner": "B", "winner_reason": "RESIGN"}
    if mutation == "board":
        occupancy = dict(before.board.occupancy)
        occupancy["P01"] = None
        changes["board"] = BoardState(occupancy=occupancy)
    else:
        players = dict(before.players)
        players["A"] = players["A"].model_copy(update={"reserve_count": 3})
        changes["players"] = players
    after = before.model_copy(update=changes)
    store._games[game_id] = replace(
        original, state=after, version=1, ply_count=0,
    )
    store._terminal_events[game_id] = StoredTerminalEvent(
        game_id=game_id, client_request_id=f"resign-{mutation}-mutation-0001",
        revision=1, event_type="RESIGN", actor="A", winner="B",
        state_before=before, state_after=after,
    )

    with pytest.raises(ApiError) as error:
        client.portal.call(client.app.state.service.replay_game, game_id)

    assert error.value.code == "REPLAY_INTEGRITY_ERROR"
