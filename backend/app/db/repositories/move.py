"""Persist full turn snapshots, including capture and real AI search output."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.errors import ApiError
from backend.app.db.models import GameMoveModel, utc_now
from backend.app.schemas.game import SearchResult, TurnResult
from backend.app.services.game_store import StoredMove


class MoveRepository:
    def __init__(self, session: Session):
        self.session = session

    def create_move(self, game_id: str, turn_number: int, turn: TurnResult,
                    actor_type: str, search: SearchResult | None,
                    client_request_id: str | None = None) -> None:
        self.session.add(GameMoveModel(
            game_id=game_id, turn_number=turn_number,
            player=turn.before_state.current_player, actor_type=actor_type,
            client_request_id=client_request_id,
            from_node=turn.move.from_node, to_node=turn.move.to_node,
            board_before=turn.board_before.model_dump(mode="json"),
            board_after=turn.board_after.model_dump(mode="json"),
            reserve_a_before=turn.reserve_before["A"], reserve_b_before=turn.reserve_before["B"],
            reserve_a_after=turn.reserve_after["A"], reserve_b_after=turn.reserve_after["B"],
            capture_result=turn.capture.model_dump(mode="json"), winner=turn.winner,
            winner_reason=turn.winner_reason, game_over=turn.game_over,
            state_before=turn.before_state.model_dump(mode="json"),
            state_after=turn.state.model_dump(mode="json"),
            state_schema_version=1, turn_result=turn.model_dump(mode="json", by_alias=True),
            ai_search_result=search.model_dump(mode="json", by_alias=True) if search else None,
            created_at=utc_now(),
        ))

    def list_moves(self, game_id: str) -> list[StoredMove]:
        rows = self.session.scalars(
            select(GameMoveModel).where(GameMoveModel.game_id == game_id)
            .order_by(GameMoveModel.turn_number)
        ).all()
        result = []
        for row in rows:
            turn = TurnResult.model_validate(row.turn_result)
            if (row.state_schema_version != 1
                    or row.from_node != turn.move.from_node
                    or row.to_node != turn.move.to_node
                    or row.player != turn.before_state.current_player
                    or row.state_before != turn.before_state.model_dump(mode="json")
                    or row.state_after != turn.state.model_dump(mode="json")
                    or row.board_before != turn.board_before.model_dump(mode="json")
                    or row.board_after != turn.board_after.model_dump(mode="json")
                    or row.capture_result != turn.capture.model_dump(mode="json")):
                raise ApiError("REPLAY_INTEGRITY_ERROR", "Stored turn snapshots disagree")
            result.append(StoredMove(row.turn_number, row.actor_type, turn,
                                     SearchResult.model_validate(row.ai_search_result)
                                     if row.ai_search_result is not None else None, row.id))
        return result
