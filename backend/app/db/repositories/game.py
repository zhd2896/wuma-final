"""Game row access. Projections are copied from canonical GameState."""

from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from backend.app.core.errors import ApiError
from backend.app.db.models import GameModel, utc_now
from backend.app.schemas.game import GameState
from backend.app.services.game_store import StoredGame


class GameRepository:
    def __init__(self, session: Session):
        self.session = session

    def create_game(self, state: GameState, mode: str,
                    ai_player: str | None, ai_level: str | None) -> str:
        game_id = uuid4().hex
        now = utc_now()
        self.session.add(GameModel(
            id=game_id, user_id=None, mode=mode, ai_level=ai_level, ai_player=ai_player,
            first_player=state.first_player, current_player=state.current_player,
            winner=state.winner, winner_reason=state.winner_reason,
            status=state.game_status, initial_state=state.model_dump(mode="json"),
            current_state=state.model_dump(mode="json"), state_schema_version=1, version=0,
            started_at=now, finished_at=None, duration_ms=None,
            created_at=now, updated_at=now,
        ))
        return game_id

    def get_game(self, game_id: str) -> GameModel:
        row = self.session.scalar(select(GameModel).where(GameModel.id == game_id))
        if row is None:
            raise ApiError("GAME_NOT_FOUND", "Game not found")
        return row

    def get_snapshot(self, game_id: str) -> StoredGame:
        row = self.get_game(game_id)
        return StoredGame(row.id, GameState.model_validate(row.initial_state),
                          GameState.model_validate(row.current_state), row.version,
                          row.mode, row.ai_player, row.ai_level)

    def update_game_state(self, row: GameModel, expected_version: int, state: GameState) -> None:
        now = utc_now()
        is_finished = state.game_status == "FINISHED"
        finished_at = now if is_finished else None
        duration_ms = int((now - row.started_at).total_seconds() * 1000) if is_finished else None
        result = self.session.execute(
            update(GameModel).where(GameModel.id == row.id, GameModel.version == expected_version).values(
                current_state=state.model_dump(mode="json"), current_player=state.current_player,
                status=state.game_status, winner=state.winner, winner_reason=state.winner_reason,
                version=expected_version + 1, updated_at=now,
                finished_at=finished_at, duration_ms=duration_ms,
            )
        )
        if result.rowcount != 1:
            raise ApiError("GAME_STATE_CONFLICT", "Game state changed; retry the move")
