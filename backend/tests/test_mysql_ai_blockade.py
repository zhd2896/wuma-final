"""Canonical blockade turns and teaching survive real MySQL and service restart."""
from dataclasses import replace
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from backend.app.db.models import CoachHintModel, GameModel
from backend.app.core.config import Settings
from backend.app.main import create_app
from backend.tests.test_mysql_persistence import (
    DB_URL, db, client, pytestmark, seed_position, game_and_moves,
)
from backend.tests.test_ai_blockade import PIECES
from backend.app.schemas.game import Move, ReviewConfig, GameState


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
        assert hints[-1]["promptVersion"] == "coach_hint_v3"
    assert client.post(path + "/move", json={"from_node": "P05", "to_node": "P03"}).status_code == 200
    assert client.post(path + "/ai-move", json={}).status_code == 200
    assert client.post(path + "/move", json={"from_node": "P03", "to_node": "P28"}).status_code == 200
    review = client.post(path + "/review", json={"reviewed_player": "A"})
    assert review.status_code == 200, review.text
    data = review.json()["data"]
    assert data["reviewConfigVersion"] == 3
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
            assert all(row.prompt_version == "coach_hint_v3" for row in stored_hints)
        restarted.app.state.store.close()


def test_mysql_preexisting_curated_item_accepts_new_engine_policy(client, db):
    from backend.tests import test_ai_blockade
    test_ai_blockade.test_preexisting_v1_curated_item_loads_after_strategy_update(client)


def test_mysql_screenshot_five_ply_terminal_survives_restart(client, db):
    from backend.tests.test_five_ply_blockade import PIECES as screenshot
    pieces = {node: 'A' if owner == 'B' else 'B' for node, owner in screenshot.items()}
    game_id = seed_position(client, db, pieces, reserve_a=0, mode='AI', ai_player='A')
    path = f'/api/v1/game/{game_id}'
    for _ in range(5):
        state = client.portal.call(client.app.state.store.get_snapshot, game_id).state
        if state.current_player == 'A':
            response = client.post(path + '/ai-move', json={})
        else:
            legal = client.portal.call(client.app.state.adapter.legal_moves, state)
            assert len(legal) == 1
            response = client.post(path + '/move', json=legal[0].model_dump())
        assert response.status_code == 200, response.text
    game, moves = game_and_moves(db, game_id)
    assert game.status == 'FINISHED' and game.winner_reason == 'TEMPLE_TRAP'
    assert len(moves) == 5 and len([m for m in moves if m.ai_search_result]) == 3
    with TestClient(create_app(Settings(database_url=DB_URL))) as restarted:
        restarted.headers['Authorization'] = client.headers['Authorization']
        replay = restarted.get(path + '/replay')
        assert replay.status_code == 200, replay.text
        assert replay.json()['data']['steps'][-1]['state'] == game.current_state
        restarted.app.state.store.close()


def test_mysql_v2_training_scores_keep_original_search_horizon(client, db):
    from backend.tests.test_five_ply_blockade import PIECES as screenshot
    pieces = {node: 'A' if owner == 'B' else 'B' for node, owner in screenshot.items()}
    game_id = seed_position(client, db, pieces, reserve_a=0, mode='AI', ai_player='B')
    state = client.portal.call(client.app.state.store.get_snapshot, game_id).state
    move = Move(from_node='P03', to_node='P26')
    after = client.portal.call(client.app.state.adapter.execute_turn, state, move).state
    old = client.portal.call(client.app.state.adapter.review_move, state, after, move,
        ReviewConfig(version=2, max_depth=1, time_limit_ms_per_move=10000))
    new = client.portal.call(client.app.state.adapter.review_move, state, after, move,
        ReviewConfig(version=3, max_depth=1, time_limit_ms_per_move=10000))
    assert old.bestScore < 900_000 and new.bestScore >= 999_995


def test_mysql_black_first_wing_requires_seven_ply_ai_closure(client, db):
    from backend.tests.test_five_ply_blockade import PIECES as screenshot
    pieces = {node: 'A' if owner == 'B' else 'B' for node, owner in screenshot.items()}
    game_id = seed_position(client, db, pieces, reserve_a=0, mode='AI', ai_player='A')
    with Session(db) as session, session.begin():
        row = session.get(GameModel, game_id)
        state = GameState.model_validate(row.current_state).model_copy(update={'current_player':'B'})
        row.first_player = 'B'
        row.initial_state = state.model_dump()
        row.current_state = state.model_dump()
    path = f'/api/v1/game/{game_id}'
    response = client.post(path + '/move', json={'from_node':'P29','to_node':'P26'})
    assert response.status_code == 200, response.text
    for _ in range(7):
        state = client.portal.call(client.app.state.store.get_snapshot, game_id).state
        if state.game_status == 'FINISHED': break
        if state.current_player == 'A':
            response = client.post(path + '/ai-move',json={})
        else:
            legal = client.portal.call(client.app.state.adapter.legal_moves,state)
            assert len(legal) == 1
            response = client.post(path + '/move',json=legal[0].model_dump())
        assert response.status_code == 200,response.text
    game, moves = game_and_moves(db,game_id)
    assert game.status == 'FINISHED' and game.winner == 'A'
    assert game.winner_reason == 'TEMPLE_TRAP' and len(moves) <= 8
    assert client.get(path + '/replay').status_code == 200
