"""Idempotent local and AI undo/resign operations."""

from dataclasses import replace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from pydantic import TypeAdapter, ValidationError

from backend.app.core.errors import ApiError
from backend.app.main import create_app
from backend.app.schemas.game import (
    BoardState, ClientRequestId, GameOperationRequest, GameOperationResponse, GameState,
)
from backend.app.schemas.remote import RemoteMoveRequest
from backend.app.services.game_store import InMemoryGameStore, StoredUndoEvent


@pytest.fixture
def client():
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=False)) as test_client:
        yield test_client


def create_game(client: TestClient, *, mode="LOCAL", first_player="A", ai_player=None):
    body = {"mode": mode, "first_player": first_player}
    if ai_player is not None:
        body.update({"ai_player": ai_player, "ai_level": "STANDARD"})
    response = client.post("/api/v1/game", json=body)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def move(client: TestClient, game_id: str, from_node="P01", to_node="P02"):
    response = client.post(f"/api/v1/game/{game_id}/move", json={
        "from_node": from_node, "to_node": to_node,
    })
    assert response.status_code == 200, response.text
    return response.json()["data"]["turn"]


def operation(client: TestClient, game_id: str, kind: str, version: int, request_id: str):
    return client.post(f"/api/v1/game/{game_id}/{kind}", json={
        "expected_version": version, "client_request_id": request_id,
    })


@pytest.mark.parametrize("value", ["request_1", "safe-REQUEST_123", "x" * 64])
def test_client_request_id_is_shared_and_accepts_safe_values(value):
    assert TypeAdapter(ClientRequestId).validate_python(value) == value
    remote = RemoteMoveRequest(
        from_node="P01", to_node="P02", expected_version=0, client_request_id=value)
    assert remote.client_request_id == value


@pytest.mark.parametrize("value", ["short", "has space", "x" * 65, "unsafe!"])
def test_client_request_id_rejects_invalid_values(value):
    with pytest.raises(ValidationError):
        GameOperationRequest(expected_version=0, client_request_id=value)


def test_game_operation_contract_defaults_reverted_turns():
    request = GameOperationRequest(expected_version=0, client_request_id="operation-0001")
    assert request.model_dump() == {
        "expected_version": 0,
        "client_request_id": "operation-0001",
    }
    with pytest.raises(ValidationError):
        GameOperationRequest(expected_version=-1, client_request_id="operation-0001")

    response_fields = GameOperationResponse.model_fields
    assert response_fields["reverted_turns"].default == 0


def test_local_undo_reverts_one_move_and_keeps_revision_monotonic(client):
    created = create_game(client)
    game_id = created["game_id"]
    move(client, game_id)

    undone = operation(client, game_id, "undo", 1, "local-undo-0001")

    assert undone.status_code == 200, undone.text
    result = undone.json()["data"]
    assert result == {
        "version": 2, "ply_count": 0, "state": created["state"], "reverted_turns": 1,
    }
    store = client.app.state.store
    assert client.portal.call(store.list_moves, game_id) == []
    assert store._moves[game_id][0].reverted_revision == 2
    assert client.portal.call(client.app.state.service.replay_game, game_id) == [
        GameState.model_validate(created["state"]),
    ]

    move(client, game_id)
    current = client.get(f"/api/v1/game/{game_id}").json()["data"]
    assert current["version"] == 3 and current["ply_count"] == 1
    assert client.portal.call(store.list_moves, game_id)[0].created_revision == 3


def test_ai_undo_reverts_human_move_before_ai_replies(client):
    created = create_game(client, mode="AI", ai_player="B")
    game_id = created["game_id"]
    move(client, game_id)

    response = operation(client, game_id, "undo", 1, "ai-undo-one-0001")

    assert response.status_code == 200, response.text
    result = response.json()["data"]
    assert result["version"] == 2 and result["ply_count"] == 0
    assert result["reverted_turns"] == 1 and result["state"] == created["state"]
    event = client.app.state.store._undo_events[(game_id, "ai-undo-one-0001")]
    assert event.requester == "A"


def test_ai_undo_reverts_latest_human_move_and_ai_reply(client):
    created = create_game(client, mode="AI", ai_player="B")
    game_id = created["game_id"]
    move(client, game_id)
    ai = client.post(f"/api/v1/game/{game_id}/ai-move", json={})
    assert ai.status_code == 200, ai.text

    response = operation(client, game_id, "undo", 2, "ai-undo-two-0001")

    assert response.status_code == 200, response.text
    result = response.json()["data"]
    assert result["version"] == 3 and result["ply_count"] == 0
    assert result["reverted_turns"] == 2 and result["state"] == created["state"]
    assert client.portal.call(client.app.state.store.list_moves, game_id) == []


def test_ai_first_undo_rejects_until_a_human_move_exists(client):
    created = create_game(client, mode="AI", ai_player="A")
    game_id = created["game_id"]
    ai = client.post(f"/api/v1/game/{game_id}/ai-move", json={})
    assert ai.status_code == 200, ai.text

    response = operation(client, game_id, "undo", 1, "ai-no-human-0001")

    assert response.status_code == 409
    assert response.json() == {
        "code": "UNDO_NOT_AVAILABLE", "message": "No move is available to undo", "data": None,
    }
    game = client.get(f"/api/v1/game/{game_id}").json()["data"]
    assert game["version"] == game["ply_count"] == 1


def test_undo_retry_returns_original_result_and_request_reuse_conflicts(client):
    game_id = create_game(client)["game_id"]
    move(client, game_id)
    first = operation(client, game_id, "undo", 1, "retry-undo-0001")
    repeated = operation(client, game_id, "undo", 1, "retry-undo-0001")
    changed_version = operation(client, game_id, "undo", 2, "retry-undo-0001")
    changed_operation = operation(client, game_id, "resign", 1, "retry-undo-0001")

    assert first.status_code == repeated.status_code == 200
    assert repeated.json() == first.json()
    assert changed_version.status_code == changed_operation.status_code == 409
    assert changed_version.json()["code"] == "OPERATION_REQUEST_CONFLICT"
    assert changed_operation.json()["code"] == "OPERATION_REQUEST_CONFLICT"
    assert client.get(f"/api/v1/game/{game_id}").json()["data"]["version"] == 2


def test_new_undo_request_with_stale_version_is_rejected(client):
    game_id = create_game(client)["game_id"]
    move(client, game_id)

    response = operation(client, game_id, "undo", 0, "stale-undo-0001")

    assert response.status_code == 409
    assert response.json() == {
        "code": "GAME_STATE_CONFLICT",
        "message": "Game state changed; retry the operation",
        "data": None,
    }


def test_local_resign_uses_current_player_as_loser_and_is_idempotent(client):
    game_id = create_game(client)["game_id"]
    moved = move(client, game_id)
    assert moved["state"]["current_player"] == "B"

    first = operation(client, game_id, "resign", 1, "local-resign-0001")
    repeated = operation(client, game_id, "resign", 1, "local-resign-0001")

    assert first.status_code == repeated.status_code == 200
    assert repeated.json() == first.json()
    result = first.json()["data"]
    assert result["version"] == 2 and result["ply_count"] == 1
    assert result["reverted_turns"] == 0
    assert result["state"]["game_status"] == "FINISHED"
    assert result["state"]["winner"] == "A"
    assert result["state"]["winner_reason"] == "RESIGN"
    event = client.portal.call(client.app.state.store.get_terminal_event, game_id)
    assert event.actor == "B" and event.winner == "A"


def test_ai_resign_always_uses_human_player_as_loser(client):
    game_id = create_game(client, mode="AI", ai_player="B")["game_id"]
    move(client, game_id)

    response = operation(client, game_id, "resign", 1, "ai-resign-0001")

    assert response.status_code == 200, response.text
    result = response.json()["data"]
    assert result["state"]["current_player"] == "B"
    assert result["state"]["winner"] == "B"
    event = client.portal.call(client.app.state.store.get_terminal_event, game_id)
    assert event.actor == "A" and event.winner == "B"


def test_zero_move_resign_replays_and_reviews_without_fabricated_move(client):
    created = create_game(client)
    game_id = created["game_id"]
    resigned = operation(client, game_id, "resign", 0, "zero-resign-0001")
    assert resigned.status_code == 200, resigned.text

    with patch.object(client.app.state.adapter, "review_move",
                      side_effect=AssertionError("zero-move review must not analyze a move")):
        review = client.post(f"/api/v1/game/{game_id}/review", json={})
    frames = client.portal.call(client.app.state.service.replay_game, game_id)

    assert review.status_code == 200, review.text
    assert review.json()["data"]["moveReviews"] == []
    assert review.json()["data"]["winnerReason"] == "RESIGN"
    assert [frame.model_dump(mode="json") for frame in frames] == [
        created["state"], resigned.json()["data"]["state"],
    ]
    assert client.portal.call(client.app.state.store.list_moves, game_id) == []


def test_finished_game_blocks_move_undo_and_new_resign(client):
    game_id = create_game(client)["game_id"]
    resigned = operation(client, game_id, "resign", 0, "finish-resign-0001")
    assert resigned.status_code == 200, resigned.text

    move_response = client.post(f"/api/v1/game/{game_id}/move", json={
        "from_node": "P01", "to_node": "P02",
    })
    undo_response = operation(client, game_id, "undo", 1, "finished-undo-0001")
    resign_response = operation(client, game_id, "resign", 1, "finished-resign-0002")

    for response in (move_response, undo_response, resign_response):
        assert response.status_code == 409
        assert response.json()["code"] == "GAME_ALREADY_FINISHED"


def test_naturally_finished_game_blocks_undo_and_resign(client):
    created = create_game(client)
    game_id = created["game_id"]
    initial = GameState.model_validate(created["state"])
    occupancy = {node: None for node in initial.board.occupancy}
    occupancy.update({"P11": "A", "P12": "B", "P08": "B", "P18": "B", "P19": "A"})
    seeded = initial.model_copy(update={"board": BoardState(occupancy=occupancy)})
    client.portal.call(client.app.state.store.update, game_id, seeded)
    final = move(client, game_id, "P19", "P13")
    assert final["game_over"] is True

    for kind in ("undo", "resign"):
        response = operation(client, game_id, kind, 1, f"natural-{kind}-0001")
        assert response.status_code == 409
        assert response.json()["code"] == "GAME_ALREADY_FINISHED"


def test_remote_games_require_remote_operation_endpoints(client):
    room = client.post("/api/v1/remote/rooms", json={
        "device_id": "operation-host", "public": False,
    }).json()["data"]

    for kind in ("undo", "resign"):
        response = operation(client, room["game_id"], kind, 0, f"remote-{kind}-0001")
        assert response.status_code == 403
        assert response.json()["code"] == "REMOTE_ACTION_REQUIRED"


def test_operation_routes_require_game_owner():
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=True)) as client:
        first = client.post("/api/v1/auth/device").json()["data"]["token"]
        second = client.post("/api/v1/auth/device").json()["data"]["token"]
        client.headers["Authorization"] = "Bearer " + first
        game_id = create_game(client)["game_id"]

        client.headers["Authorization"] = "Bearer " + second
        for kind in ("undo", "resign"):
            response = operation(client, game_id, kind, 0, f"forbidden-{kind}-0001")
            assert response.status_code == 403
            assert response.json()["code"] == "AUTH_FORBIDDEN"

        room = client.post("/api/v1/remote/rooms", json={
            "device_id": "auth-remote-host", "public": False,
        }).json()["data"]
        remote = operation(client, room["game_id"], "undo", 0, "auth-remote-undo")
        assert remote.status_code == 403
        assert remote.json()["code"] == "REMOTE_ACTION_REQUIRED"

        del client.headers["Authorization"]
        assert operation(client, game_id, "undo", 0, "auth-undo-0001").status_code == 401


def test_operation_routes_are_published(client):
    paths = client.get("/openapi.json").json()["paths"]
    assert "/api/v1/game/{game_id}/undo" in paths
    assert "/api/v1/game/{game_id}/resign" in paths


def test_analysis_commit_requires_playing_state_after_resign(client):
    created = create_game(client)
    game_id = created["game_id"]
    state = GameState.model_validate(created["state"])
    analysis = client.portal.call(
        client.app.state.adapter.analyze_position, state, 1, 500, 1)
    resigned = operation(client, game_id, "resign", 0, "analysis-resign-0001")
    assert resigned.status_code == 200, resigned.text

    with pytest.raises(ApiError) as error:
        client.portal.call(client.app.state.store.commit_analysis, game_id, 1, analysis)

    assert error.value.code == "GAME_STATE_CONFLICT"
    assert client.app.state.store._analyses[game_id] == []


def test_store_records_typed_undo_event(client):
    game_id = create_game(client)["game_id"]
    move(client, game_id)
    response = operation(client, game_id, "undo", 1, "typed-undo-0001")
    assert response.status_code == 200, response.text

    event = client.app.state.store._undo_events[(game_id, "typed-undo-0001")]
    assert isinstance(event, StoredUndoEvent)
    assert (event.before_revision, event.after_revision, event.anchor_turn,
            event.reverted_count) == (1, 2, 1, 1)


def test_undo_response_state_is_isolated_from_snapshot_event_and_retry(client):
    store = client.app.state.store
    game_id = create_game(client)["game_id"]
    move(client, game_id)
    request = GameOperationRequest(
        expected_version=1, client_request_id="copy-undo-0001")
    response = client.portal.call(store.commit_undo, game_id, request)

    response.state.board.occupancy["P01"] = None

    stored = store._games[game_id]
    event = store._undo_events[(game_id, request.client_request_id)]
    retried = client.portal.call(store.commit_undo, game_id, request)
    assert stored.state.board.occupancy["P01"] == "A"
    assert event.state_after.board.occupancy["P01"] == "A"
    assert retried.state.board.occupancy["P01"] == "A"


def test_resign_response_event_and_replay_reads_are_isolated(client):
    store = client.app.state.store
    game_id = create_game(client)["game_id"]
    request = GameOperationRequest(
        expected_version=0, client_request_id="copy-resign-0001")
    response = client.portal.call(store.commit_resign, game_id, request)

    response.state.board.occupancy["P01"] = None
    event = client.portal.call(store.get_terminal_event, game_id)
    event.state_before.board.occupancy["P05"] = None
    event.state_after.board.occupancy["P01"] = None
    frames = client.portal.call(client.app.state.service.replay_game, game_id)
    frames[0].board.occupancy["P06"] = None
    frames[-1].board.occupancy["P11"] = None

    stored = store._games[game_id]
    stored_event = store._terminal_events[game_id]
    assert stored.state.board.occupancy["P01"] == "A"
    assert stored.initial_state.board.occupancy["P06"] == "A"
    assert stored_event.state_before.board.occupancy["P05"] == "B"
    assert stored_event.state_after.board.occupancy["P01"] == "A"
    assert stored_event.state_after.board.occupancy["P11"] == "A"


def test_snapshot_and_move_reads_do_not_expose_stored_operation_state(client):
    store = client.app.state.store
    game_id = create_game(client)["game_id"]
    move(client, game_id)

    snapshot = client.portal.call(store.get_snapshot, game_id)
    moves = client.portal.call(store.list_moves, game_id)
    snapshot.state.board.occupancy["P02"] = None
    moves[0].turn.state.board.occupancy["P02"] = None

    assert store._games[game_id].state.board.occupancy["P02"] == "A"
    assert store._moves[game_id][0].turn.state.board.occupancy["P02"] == "A"
