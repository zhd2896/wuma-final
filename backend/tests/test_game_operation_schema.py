"""Fast schema and in-memory coverage for revisioned game operations."""

import importlib.util
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Index, UniqueConstraint

from backend.app.db import models
from backend.app.db.repositories.game import GameRepository
from backend.app.core.errors import ApiError
from backend.app.main import create_app
from backend.app.services.game_store import InMemoryGameStore, StoredTerminalEvent


def _unique_columns(table) -> set[tuple[str, ...]]:
    return {
        tuple(column.name for column in constraint.columns)
        for constraint in table.constraints
        if isinstance(constraint, UniqueConstraint)
    }


def _indexes(table) -> dict[str, tuple[str, ...]]:
    return {
        index.name: tuple(column.name for column in index.columns)
        for index in table.indexes
        if isinstance(index, Index)
    }


def _migration_module(revision="0011_game_operations"):
    path = Path(__file__).parents[1] / "alembic" / "versions" / f"{revision}.py"
    assert path.exists(), f"{revision} migration is missing"
    spec = importlib.util.spec_from_file_location(f"migration_{revision}", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_game_and_move_models_track_revisions_and_active_plies():
    game_columns = models.GameModel.__table__.c
    assert game_columns.ply_count.nullable is False
    assert game_columns.ply_count.default.arg == 0

    move_table = models.GameMoveModel.__table__
    assert move_table.c.created_revision.nullable is False
    assert move_table.c.reverted_revision.nullable is True
    assert ("game_id", "created_revision") in _unique_columns(move_table)
    assert ("game_id", "turn_number") not in _unique_columns(move_table)
    assert ("game_id", "client_request_id") in _unique_columns(move_table)
    assert _indexes(move_table)["ix_game_moves_active_turn"] == (
        "game_id", "reverted_revision", "turn_number")


def test_operation_event_models_expose_idempotency_constraints_and_status_index():
    undo_table = models.GameUndoEventModel.__table__
    assert set(undo_table.c.keys()) == {
        "id", "game_id", "client_request_id", "requester", "before_revision",
        "after_revision", "anchor_turn", "reverted_count", "state_after", "created_at",
    }
    assert ("game_id", "client_request_id") in _unique_columns(undo_table)

    terminal_table = models.GameTerminalEventModel.__table__
    assert set(terminal_table.c.keys()) == {
        "id", "game_id", "client_request_id", "revision", "event_type", "actor",
        "winner", "state_before", "state_after", "created_at",
    }
    assert ("game_id",) in _unique_columns(terminal_table)
    assert ("game_id", "client_request_id") in _unique_columns(terminal_table)

    remote_table = models.RemoteUndoRequestModel.__table__
    assert set(remote_table.c.keys()) == {
        "id", "game_id", "requester", "responder", "create_client_request_id",
        "resolve_client_request_id", "resolve_expected_version", "resolve_action",
        "base_revision", "anchor_turn", "revert_count", "status",
        "created_at", "resolved_at",
    }
    assert remote_table.c.resolve_client_request_id.nullable is True
    assert remote_table.c.resolved_at.nullable is True
    assert ("game_id", "create_client_request_id") in _unique_columns(remote_table)
    assert ("game_id", "resolve_client_request_id") in _unique_columns(remote_table)
    assert _indexes(remote_table)["ix_remote_undo_requests_game_status"] == (
        "game_id", "status")


def test_in_memory_move_uses_ply_count_and_state_revision():
    store = InMemoryGameStore()
    with TestClient(create_app(store=store, require_auth=False)) as client:
        created = client.post("/api/v1/game", json={"first_player": "A", "mode": "LOCAL"})
        assert created.status_code == 200, created.text
        game_id = created.json()["data"]["game_id"]
        moved = client.post(
            f"/api/v1/game/{game_id}/move",
            json={"from_node": "P01", "to_node": "P02"},
        )
        assert moved.status_code == 200, moved.text
        game = client.portal.call(store.get_snapshot, game_id)
        move = client.portal.call(store.list_moves, game_id)[0]

    assert game.version == 1
    assert game.ply_count == 1
    assert move.turn_number == 1
    assert move.created_revision == 1
    assert move.reverted_revision is None
    assert move.client_request_id is None


def test_remote_retry_uses_created_revision_when_revision_and_ply_diverge():
    store = InMemoryGameStore()
    with TestClient(create_app(store=store, require_auth=False)) as client:
        host = client.post("/api/v1/remote/rooms", json={
            "device_id": "revision-host", "public": False,
        }).json()["data"]
        joined = client.post("/api/v1/remote/join", json={
            "invite_code": host["invite_code"], "device_id": "revision-guest",
        })
        assert joined.status_code == 200, joined.text
        path = f"/api/v1/remote/rooms/{host['game_id']}/move"
        headers = {"X-Room-Token": host["token"]}
        body = {
            "from_node": "P01", "to_node": "P02", "expected_version": 0,
            "client_request_id": "revision-retry-0001",
        }
        moved = client.post(path, json=body, headers=headers)
        assert moved.status_code == 200, moved.text

        key = (host["game_id"], body["client_request_id"])
        store._remote_requests[key] = replace(
            store._remote_requests[key], created_revision=3)
        retried = client.post(
            path, json={**body, "expected_version": 2}, headers=headers)
        store._games[host["game_id"]] = replace(
            store._games[host["game_id"]], version=4, ply_count=1)
        room = client.get(
            f"/api/v1/remote/rooms/{host['game_id']}", headers=headers)

    assert retried.status_code == 200, retried.text
    assert retried.json()["data"]["version"] == 3
    assert retried.json()["data"]["ply_count"] == 1
    assert room.status_code == 200, room.text
    assert room.json()["data"]["version"] == 4
    assert room.json()["data"]["ply_count"] == 1


def test_in_memory_replay_uses_only_active_plies_when_revision_is_higher():
    store = InMemoryGameStore()
    with TestClient(create_app(store=store, require_auth=False)) as client:
        created = client.post("/api/v1/game", json={"first_player": "A", "mode": "LOCAL"})
        game_id = created.json()["data"]["game_id"]
        moved = client.post(
            f"/api/v1/game/{game_id}/move",
            json={"from_node": "P01", "to_node": "P02"},
        )
        assert moved.status_code == 200, moved.text

        original = store._moves[game_id][0]
        store._moves[game_id] = [
            replace(original, reverted_revision=3),
            replace(original, game_move_id=2, created_revision=4,
                    client_request_id="active-branch-0001"),
        ]
        store._games[game_id] = replace(
            store._games[game_id], version=4, ply_count=1,
            state=original.turn.state,
        )

        active = client.portal.call(store.list_moves, game_id)
        frames = client.portal.call(client.app.state.service.replay_game, game_id)

    assert [(move.turn_number, move.created_revision, move.reverted_revision,
             move.client_request_id) for move in active] == [
        (1, 4, None, "active-branch-0001"),
    ]
    assert frames == [original.turn.before_state, original.turn.state]


@pytest.mark.parametrize("corruption", ["count", "turn", "chain", "final"])
def test_replay_rejects_active_history_corruption(corruption):
    store = InMemoryGameStore()
    with TestClient(create_app(store=store, require_auth=False)) as client:
        created = client.post("/api/v1/game", json={"first_player": "A", "mode": "LOCAL"})
        game_id = created.json()["data"]["game_id"]
        moved = client.post(f"/api/v1/game/{game_id}/move", json={
            "from_node": "P01", "to_node": "P02",
        })
        assert moved.status_code == 200, moved.text
        move = store._moves[game_id][0]
        game = store._games[game_id]
        if corruption == "count":
            store._games[game_id] = replace(game, version=4, ply_count=2)
        elif corruption == "turn":
            store._moves[game_id] = [replace(move, turn_number=2)]
        elif corruption == "chain":
            store._moves[game_id] = [replace(
                move, turn=move.turn.model_copy(update={"before_state": move.turn.state}))]
        else:
            store._games[game_id] = replace(game, version=2, state=game.initial_state)
            store._terminal_events[game_id] = StoredTerminalEvent(
                game_id=game_id, client_request_id="wrong-resign-proof-0001",
                revision=1, event_type="RESIGN", actor="A", winner="B",
                state_before=move.turn.state, state_after=game.initial_state,
            )

        with pytest.raises(ApiError) as error:
            client.portal.call(client.app.state.service.replay_game, game_id)

    assert error.value.code == "REPLAY_INTEGRITY_ERROR"


def test_terminal_event_repository_maps_malformed_state_to_replay_integrity_error():
    class MalformedEventSession:
        def scalar(self, _statement):
            return SimpleNamespace(
                id=1, game_id="corrupt-terminal-game",
                client_request_id="corrupt-terminal-event-0001",
                revision=3, event_type="RESIGN", actor="A", winner="B",
                state_before={"malformed": True}, state_after={"malformed": True},
            )

    with pytest.raises(ApiError) as error:
        GameRepository(MalformedEventSession()).get_terminal_event("corrupt-terminal-game")

    assert error.value.code == "REPLAY_INTEGRITY_ERROR"


def test_game_operations_migration_is_the_new_head():
    operations = _migration_module()
    idempotency = _migration_module("0012_remote_undo_idempotency")
    revert_count = _migration_module("0013_remote_undo_revert_count")
    assert operations.revision == "0011_game_operations"
    assert operations.down_revision == "0010_personal_history_indexes"
    assert idempotency.revision == "0012_remote_undo_idempotency"
    assert idempotency.down_revision == operations.revision
    assert revert_count.revision == "0013_remote_undo_revert_count"
    assert revert_count.down_revision == idempotency.revision


def test_migration_downgrade_guard_rejects_branched_turns(monkeypatch):
    migration = _migration_module()

    class DuplicateResult:
        def mappings(self):
            return self

        def first(self):
            return {"game_id": "game-1", "turn_number": 2, "duplicate_count": 2}

    class DuplicateBind:
        def execute(self, _statement):
            return DuplicateResult()

    monkeypatch.setattr(migration.op, "get_bind", lambda: DuplicateBind())
    with pytest.raises(RuntimeError, match="branched duplicate"):
        migration._guard_downgrade_against_branched_moves()


def test_migration_downgrade_guard_rejects_other_revision_audit_state(monkeypatch):
    migration = _migration_module()

    class NoDuplicateResult:
        def mappings(self):
            return self

        def first(self):
            return None

    class AuditStateResult:
        def scalar_one(self):
            return 1

    class AuditStateBind:
        def __init__(self):
            self.calls = 0

        def execute(self, _statement):
            self.calls += 1
            return NoDuplicateResult() if self.calls == 1 else AuditStateResult()

    monkeypatch.setattr(migration.op, "get_bind", lambda: AuditStateBind())
    with pytest.raises(RuntimeError, match="post-0011 audit state"):
        migration._guard_downgrade_against_branched_moves()
