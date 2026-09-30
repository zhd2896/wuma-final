from types import SimpleNamespace

from sqlalchemy.dialects import mysql

from backend.app.db.repositories.game import GameRepository
from backend.app.db.repositories.remote import RemoteRepository


class RecordingSession:
    def __init__(self, value):
        self.value = value
        self.statement = None

    def scalar(self, statement):
        self.statement = statement
        return self.value


def test_game_repository_can_lock_the_authoritative_game_row():
    row = SimpleNamespace(id="game-1")
    session = RecordingSession(row)

    assert GameRepository(session).get_game("game-1", lock=True) is row
    sql = str(session.statement.compile(dialect=mysql.dialect()))
    assert "FOR UPDATE" in sql


def test_remote_undo_results_use_the_persisted_request_count_for_every_status():
    class NoMoveReadSession:
        def scalars(self, _statement):
            raise AssertionError("resolved undo results must not be recomputed from active moves")

    for status in ("PENDING", "ACCEPTED", "DECLINED", "STALE"):
        row = SimpleNamespace(
            id="undo-1", game_id="game-1", requester="A", responder="B",
            create_client_request_id="create-1", base_revision=2, anchor_turn=1,
            revert_count=2, status=status,
            resolve_client_request_id="resolve-1", resolve_expected_version=2,
            resolve_action="ACCEPT",
        )

        stored = RemoteRepository(NoMoveReadSession()).stored_undo(row)

        assert stored.revert_count == 2
