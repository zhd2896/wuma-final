"""Canonical blockade turns and teaching survive real MySQL and service restart."""
from dataclasses import replace
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from backend.app.db.models import CoachHintModel
from backend.app.core.config import Settings
from backend.app.main import create_app
from backend.tests.test_mysql_persistence import (
    DB_URL, db, client, pytestmark, seed_position, game_and_moves,
)
from backend.tests.test_ai_blockade import PIECES


def test_mysql_blockade_ai_terminal_history_replay_survive_restart(client, db):
    pieces = {node: "A" if owner == "B" else "B" for node, owner in PIECES.items()}
    game_id = seed_position(client, db, pieces, reserve_a=0, mode="AI", ai_player="A")
    path = f"/api/v1/game/{game_id}"
    first = client.post(path + "/ai-move", json={})
    assert first.status_code == 200, first.text
    assert client.post(path + "/move", json={"from_node": "P28", "to_node": "P29"}).status_code == 200
    end = client.post(path + "/ai-move", json={})
    assert end.status_code == 200, end.text
    turn = end.json()["data"]["turn"]
    assert turn["game_over"] and turn["winner_reason"] == "TEMPLE_TRAP"
    game, moves = game_and_moves(db, game_id)
    assert game.status == "FINISHED" and game.winner == "A"
    assert len(moves) == 3 and moves[-1].winner_reason == "TEMPLE_TRAP"
    assert moves[0].ai_search_result and moves[-1].ai_search_result
    with TestClient(create_app(Settings(database_url=DB_URL))) as restarted:
        restarted.headers["Authorization"] = client.headers["Authorization"]
        assert restarted.get(path).json()["data"]["state"] == turn["state"]
        replay = restarted.get(path + "/replay")
        assert replay.status_code == 200, replay.text
        assert replay.json()["data"]["steps"][-1]["state"] == turn["state"]
        history = restarted.get("/api/v1/me/games?status=FINISHED").json()["data"]["items"]
        assert history[0]["gameId"] == game_id and history[0]["winnerReason"] == "TEMPLE_TRAP"
        restarted.app.state.store.close()


def test_mysql_blockade_coach_review_explanation_survive_restart(client, db):
    pieces = {node: "A" if owner == "B" else "B" for node, owner in PIECES.items()}
    game_id = seed_position(client, db, pieces, reserve_a=0, mode="AI", ai_player="B")
    client.app.state.service.settings = replace(client.app.state.service.settings,
        analysis_max_depth=1, analysis_time_limit_ms=1000)
    path = f"/api/v1/game/{game_id}"
    hints = []
    for level in (1, 2, 3):
        response = client.post(path + "/coach/hint", json={"level": level, "expected_version": 0})
        assert response.status_code == 200, response.text
        hints.append(response.json()["data"])
        assert hints[-1]["promptVersion"] == "coach_hint_v2"
    assert client.post(path + "/move", json={"from_node": "P05", "to_node": "P03"}).status_code == 200
    assert client.post(path + "/ai-move", json={}).status_code == 200
    assert client.post(path + "/move", json={"from_node": "P03", "to_node": "P28"}).status_code == 200
    review = client.post(path + "/review", json={"reviewed_player": "A"})
    assert review.status_code == 200, review.text
    data = review.json()["data"]
    assert data["reviewConfigVersion"] == 2
    assert "围堵" in data["moveReviews"][0]["engineExplanation"]
    explanation = client.post(path + "/review/explain", json={"reviewed_player": "A"})
    assert explanation.status_code == 200, explanation.text
    assert "无合法走法" in str(explanation.json()["data"])
    with TestClient(create_app(Settings(database_url=DB_URL))) as restarted:
        restarted.headers["Authorization"] = client.headers["Authorization"]
        cached = restarted.post(path + "/review", json={"reviewed_player": "A"})
        assert cached.status_code == 200, cached.text
        assert cached.json()["data"] == data
        repeated = restarted.post(path + "/review/explain", json={"reviewed_player": "A"})
        assert repeated.status_code == 200, repeated.text
        assert repeated.json()["data"] == explanation.json()["data"]
        with Session(db) as session:
            stored_hints = session.scalars(select(CoachHintModel).where(CoachHintModel.game_id == game_id)).all()
            assert len(stored_hints) == 3
            assert all(row.prompt_version == "coach_hint_v2" for row in stored_hints)
        restarted.app.state.store.close()


def test_mysql_preexisting_curated_item_accepts_new_engine_policy(client, db):
    from backend.tests import test_ai_blockade
    test_ai_blockade.test_preexisting_v1_curated_item_loads_after_strategy_update(client)
