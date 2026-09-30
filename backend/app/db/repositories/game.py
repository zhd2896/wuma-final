"""Game row access. Projections are copied from canonical GameState."""

from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from backend.app.core.errors import ApiError
from backend.app.db.models import GameModel, GameTerminalEventModel, utc_now
from backend.app.schemas.game import GameState
from backend.app.services.game_store import StoredGame, StoredTerminalEvent


class GameRepository:
    def __init__(self, session: Session):
        self.session = session

    def create_game(self, state: GameState, mode: str,
                    ai_player: str | None, ai_level: str | None,
                    user_id: str | None = None) -> str:
        game_id = uuid4().hex
        now = utc_now()
        self.session.add(GameModel(
            id=game_id, user_id=user_id, mode=mode, ai_level=ai_level, ai_player=ai_player,
            first_player=state.first_player, current_player=state.current_player,
            winner=state.winner, winner_reason=state.winner_reason,
            status=state.game_status, initial_state=state.model_dump(mode="json"),
            current_state=state.model_dump(mode="json"), state_schema_version=1, version=0,
            ply_count=0,
            started_at=now, finished_at=None, duration_ms=None,
            created_at=now, updated_at=now,
        ))
        return game_id

    def get_game(self, game_id: str, lock: bool = False) -> GameModel:
        query = select(GameModel).where(GameModel.id == game_id)
        if lock:
            query = query.with_for_update()
        row = self.session.scalar(query)
        if row is None:
            raise ApiError("GAME_NOT_FOUND", "Game not found")
        return row

    def get_snapshot(self, game_id: str) -> StoredGame:
        row = self.get_game(game_id)
        return StoredGame(
            game_id=row.id, initial_state=GameState.model_validate(row.initial_state),
            state=GameState.model_validate(row.current_state), version=row.version,
            ply_count=row.ply_count, mode=row.mode, ai_player=row.ai_player,
            ai_level=row.ai_level, user_id=row.user_id)

    def get_terminal_event(self, game_id: str) -> StoredTerminalEvent | None:
        row = self.session.scalar(select(GameTerminalEventModel).where(
            GameTerminalEventModel.game_id == game_id))
        if row is None:
            return None
        try:
            state_before = GameState.model_validate(row.state_before)
            state_after = GameState.model_validate(row.state_after)
        except ValidationError as exc:
            raise ApiError(
                "REPLAY_INTEGRITY_ERROR", "Stored terminal event state is invalid",
            ) from exc
        return StoredTerminalEvent(
            game_id=row.game_id, client_request_id=row.client_request_id,
            revision=row.revision, event_type=row.event_type, actor=row.actor,
            winner=row.winner,
            state_before=state_before, state_after=state_after,
            terminal_event_id=row.id,
        )

    def update_game_state(self, row: GameModel, expected_version: int, state: GameState) -> None:
        now = utc_now()
        is_finished = state.game_status == "FINISHED"
        finished_at = now if is_finished else None
        duration_ms = int((now - row.started_at).total_seconds() * 1000) if is_finished else None
        result = self.session.execute(
            update(GameModel).where(GameModel.id == row.id, GameModel.version == expected_version).values(
                current_state=state.model_dump(mode="json"), current_player=state.current_player,
                status=state.game_status, winner=state.winner, winner_reason=state.winner_reason,
                version=expected_version + 1, ply_count=row.ply_count + 1, updated_at=now,
                finished_at=finished_at, duration_ms=duration_ms,
            )
        )
        if result.rowcount != 1:
            raise ApiError("GAME_STATE_CONFLICT", "Game state changed; retry the move")
