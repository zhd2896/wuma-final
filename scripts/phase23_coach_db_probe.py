"""Read-only MySQL state for the real Coach E2E."""

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from backend.app.db.models import CoachHintModel, GameModel, GameMoveModel


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: phase23_coach_db_probe.py <game_id>")
    url = os.environ.get("WUMA_TEST_DATABASE_URL", "")
    parsed = make_url(url)
    if not parsed.drivername.startswith("mysql") or not (parsed.database or "").endswith("_test"):
        raise SystemExit("WUMA_TEST_DATABASE_URL must point to isolated MySQL *_test")
    engine = create_engine(url, pool_pre_ping=True)
    with Session(engine) as session:
        game = session.get(GameModel, sys.argv[1])
        if game is None:
            raise SystemExit("game missing from isolated test database")
        moves = session.scalars(select(GameMoveModel).where(GameMoveModel.game_id == game.id)).all()
        hints = session.scalars(select(CoachHintModel).where(
            CoachHintModel.game_id == game.id).order_by(CoachHintModel.hint_level)).all()
        print(json.dumps({"current_state": game.current_state, "version": game.version,
                          "game_moves_count": len(moves), "hint_levels": [h.hint_level for h in hints],
                          "hint_texts": [h.hint_text for h in hints],
                          "fallback_used": [h.fallback_used for h in hints],
                          "best_moves": [h.best_move for h in hints]}, ensure_ascii=False))
    engine.dispose()


if __name__ == "__main__":
    main()
