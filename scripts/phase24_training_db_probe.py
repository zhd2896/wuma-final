"""Read-only isolated MySQL evidence for Phase 24 training."""

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from backend.app.db.models import (GameModel, GameMoveModel, GameReviewModel,
                                   MoveReviewModel, TrainingItemModel, TrainingRecordModel)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: phase24_training_db_probe.py <game_id>")
    url = os.environ.get("WUMA_TEST_DATABASE_URL", "")
    parsed = make_url(url)
    if not parsed.drivername.startswith("mysql") or not (parsed.database or "").endswith("_test"):
        raise SystemExit("WUMA_TEST_DATABASE_URL must point to isolated MySQL *_test")
    engine = create_engine(url, pool_pre_ping=True)
    with Session(engine) as session:
        game = session.get(GameModel, sys.argv[1])
        if game is None:
            raise SystemExit("fixture game missing")
        moves = session.scalars(select(GameMoveModel).where(
            GameMoveModel.game_id == game.id).order_by(GameMoveModel.turn_number)).all()
        reviews = session.scalars(select(GameReviewModel).where(
            GameReviewModel.game_id == game.id)).all()
        review_rows = (session.scalars(select(MoveReviewModel).where(
            MoveReviewModel.game_review_id.in_([row.id for row in reviews]))).all()
            if reviews else [])
        items = session.scalars(select(TrainingItemModel).where(
            TrainingItemModel.source_game_id == game.id)).all()
        records = (session.scalars(select(TrainingRecordModel).where(
            TrainingRecordModel.training_item_id.in_([item.id for item in items]))
            .order_by(TrainingRecordModel.answered_at)).all() if items else [])
        print(json.dumps({
            "current_state": game.current_state,
            "version": game.version,
            "game_moves_count": len(moves),
            "game_review_count": len(reviews),
            "move_review_count": len(review_rows),
            "training_items_count": len(items),
            "training_records_count": len(records),
            "items": [{
                "id": item.id, "sourceGameId": item.source_game_id,
                "sourceTurn": item.source_turn, "sourceCategory": item.source_category,
                "player": item.player, "sourceMoveId": item.source_move_id,
                "sourceMoveReviewId": item.source_move_review_id,
                "stateMatchesMove": item.state_snapshot == next(
                    move.state_before for move in moves if move.id == item.source_move_id),
                "reviewRowExists": item.source_move_review_id in {row.id for row in review_rows},
                "bestMove": item.best_move, "bestScore": item.best_score,
            } for item in items],
            "records": [{
                "id": row.id, "trainingId": row.training_item_id,
                "clientAttemptId": row.client_attempt_id,
                "submittedMove": row.submitted_move, "legal": row.legal,
                "bestMoveEquivalent": row.best_move_equivalent,
                "bestScore": row.best_score,
                "submittedMoveScore": row.submitted_move_score,
                "scoreLoss": row.score_loss, "result": row.result,
                "searchDepth": row.search_depth,
            } for row in records],
        }, ensure_ascii=False))
    engine.dispose()


if __name__ == "__main__":
    main()
