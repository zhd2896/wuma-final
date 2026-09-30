from types import SimpleNamespace

from sqlalchemy.dialects import mysql

from backend.app.db.repositories.game import GameRepository


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
