"""Read-only MySQL evidence for the Phase 21 WeChat E2E."""

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from backend.app.db.models import (GameModel, GameMoveModel, GameReviewModel,
                                    MoveReviewModel, ReviewExplanationModel, UserModel)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: phase21_review_db_probe.py <game_id>")
    url = os.environ.get("WUMA_TEST_DATABASE_URL", "")
    if not url:
        raise SystemExit("WUMA_TEST_DATABASE_URL is required")
    parsed = make_url(url)
    if not parsed.drivername.startswith("mysql") or not (parsed.database or "").endswith("_test"):
        raise SystemExit("WUMA_TEST_DATABASE_URL must point to isolated MySQL *_test")
    engine = create_engine(url, pool_pre_ping=True)
    with Session(engine) as session:
        game = session.get(GameModel, sys.argv[1])
        if game is None:
            raise SystemExit("fixture game missing from test database")
        owner = session.get(UserModel, game.user_id) if game.user_id else None
        owner_kind = "wechat" if owner and (owner.external_user_id or "").startswith("wechat:") else "other"
        moves = session.scalars(select(GameMoveModel).where(
            GameMoveModel.game_id == game.id).order_by(GameMoveModel.turn_number)).all()
        reviews = session.scalars(select(GameReviewModel).where(
            GameReviewModel.game_id == game.id)).all()
        review_rows = session.scalars(select(MoveReviewModel).where(
            MoveReviewModel.game_review_id.in_([item.id for item in reviews]))
            .order_by(MoveReviewModel.turn_number)).all() if reviews else []
        explanations = (session.scalars(select(ReviewExplanationModel).where(
            ReviewExplanationModel.game_review_id.in_([item.id for item in reviews]))).all()
            if reviews else [])
        print(json.dumps({
            "user_id": game.user_id,
            "owner_kind": owner_kind,
            "current_state": game.current_state,
            "version": game.version,
            "game_moves_count": len(moves),
            "game_review_count": len(reviews),
            "move_review_count": len(review_rows),
            "move_review_turns": [row.turn_number for row in review_rows],
            "move_review_source_ids": [row.game_move_id for row in review_rows],
            "game_move_ids": [row.id for row in moves],
            "review_config_versions": [row.review_config_version for row in reviews],
            "explanation_count": len(explanations),
            "explanation_prompt_versions": [row.prompt_version for row in explanations],
            "explanation_fallback_used": [row.fallback_used for row in explanations],
            "explanation_created_at": [row.created_at.isoformat() for row in explanations],
        }, ensure_ascii=False))
    engine.dispose()


if __name__ == "__main__":
    main()
