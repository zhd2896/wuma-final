"""Actual cloud endgame goes through the canonical worker and real HTTP contracts."""
from dataclasses import replace
import pytest
from backend.tests.test_coach import client
from backend.tests.test_api import seed_position
from backend.app.schemas.game import Move, PositionAnalysis, PlayerState, GameReview, ReviewConfig
from backend.app.schemas.coach import CoachHint
from backend.app.services.coach.policy import CoachHintPolicy
from backend.app.services.coach.fallback import fallback_hint
from backend.app.services.coach.grounding import validate_coach_text

PIECES = {node: "B" for node in ("P01", "P05", "P06", "P14", "P17", "P23", "P25", "P26", "P27")}
PIECES["P28"] = "A"

def position(client, ai_player, level="BEGINNER"):
    game_id = seed_position(client, PIECES, first_player="B", mode="AI", ai_player=ai_player)
    store = client.app.state.store
    game = client.portal.call(store.get_snapshot, game_id)
    state = game.state.model_copy(update={"players": {"A": PlayerState(reserve_count=4), "B": PlayerState(reserve_count=0)}})
    client.portal.call(store.update, game_id, state)
    store._games[game_id] = replace(store._games[game_id], ai_level=level)
    client.app.state.service.settings = replace(client.app.state.service.settings,
        analysis_max_depth=1, analysis_time_limit_ms=1000)
    return game_id

@pytest.mark.parametrize("level", ["BEGINNER", "STANDARD", "ADVANCED"])
def test_real_ai_completes_three_ply_temple_blockade_and_saves_replay(client, level):
    game_id = position(client, "B", level)
    path = f"/api/v1/game/{game_id}"
    moved = client.post(path + "/ai-move", json={})
    assert moved.status_code == 200, moved.text
    state = client.portal.call(client.app.state.store.get_snapshot, game_id).state
    replies = client.portal.call(client.app.state.adapter.legal_moves, state)
    assert len(replies) == 1 and replies[0] == Move(from_node="P28", to_node="P29")
    assert client.post(path + "/move", json={"from_node": "P28", "to_node": "P29"}).status_code == 200
    finish = client.post(path + "/ai-move", json={})
    assert finish.status_code == 200, finish.text
    turn = finish.json()["data"]["turn"]
    assert turn["game_over"] and turn["winner"] == "B" and turn["winner_reason"] == "TEMPLE_TRAP"
    replay = client.get(path + "/replay")
    assert replay.status_code == 200, replay.text
    assert replay.json()["data"]["steps"][-1]["state"] == turn["state"]

def test_real_analysis_and_three_hint_levels_share_proof_without_leaking_future_moves(client):
    game_id = position(client, "A")  # B is the human; coach only serves human turns.
    path = f"/api/v1/game/{game_id}"
    before = client.get(path).json()["data"]
    response = client.post("/api/v1/ai/analyze", json={"game_id": game_id})
    assert response.status_code == 200, response.text
    raw = response.json()["data"]
    proof = next(item for item in raw["threats"] if item["type"] == "FORCED_BLOCKADE_AVAILABLE")
    assert proof["evidence"]["maxPlies"] == 3 and proof["relatedMove"] == raw["bestMove"]
    assert raw["evaluationBreakdown"]["blockade"]["weightedScore"] > 0
    analysis = PositionAnalysis.model_validate({k: v for k, v in raw.items() if k not in ("game_id", "game_version")})
    for level in (1, 2, 3):
        evidence = CoachHintPolicy.build(analysis, level)
        text = fallback_hint(evidence)
        assert validate_coach_text(text, evidence)
        hinted = client.post(path + "/coach/hint", json={"level": level, "expected_version": 0})
        assert hinted.status_code == 200, hinted.text
        hint = hinted.json()["data"]
        assert "围堵" in hint["hintText"] or "封锁" in hint["hintText"]
        if level == 1: assert "P" not in hint["hintText"] and hint["bestMove"] is None
        if level == 2: assert "→" not in hint["hintText"] and hint["bestMove"] is None
        if level == 3:
            assert hint["bestMove"] == raw["bestMove"]
            assert not validate_coach_text("这一步立即获胜", evidence)
            assert validate_coach_text("这步可强制完成围堵", evidence)
        assert not validate_coach_text("这步可强制完成围堵", evidence.model_copy(update={
            "threatTypes": [], "bestMoveThreatTypes": []}))
    assert client.get(path).json()["data"] == before
    assert client.portal.call(client.app.state.store.list_moves, game_id) == []

def test_finished_game_review_and_explanation_use_real_temple_result(client):
    game_id = position(client, "A")
    path = f"/api/v1/game/{game_id}"
    assert client.post(path + "/move", json={"from_node": "P05", "to_node": "P03"}).status_code == 200
    assert client.post(path + "/ai-move", json={}).status_code == 200
    assert client.post(path + "/move", json={"from_node": "P03", "to_node": "P28"}).status_code == 200
    before = client.get(path).json()["data"]
    review = client.post(path + "/review", json={"reviewed_player": "B"})
    assert review.status_code == 200, review.text
    data = review.json()["data"]
    assert data["winner"] == "B" and data["winnerReason"] == "TEMPLE_TRAP"
    first = data["moveReviews"][0]
    assert first["bestMoveEquivalent"] and "围堵" in first["engineExplanation"]
    explanation = client.post(path + "/review/explain", json={"reviewed_player": "B"})
    assert explanation.status_code == 200, explanation.text
    assert "无合法走法" in str(explanation.json()["data"])
    assert client.get(path).json()["data"] == before

def test_legacy_coach_cache_does_not_hide_new_blockade_hint(client):
    game_id = position(client, "A")
    path = f"/api/v1/game/{game_id}/coach/hint"
    first = client.post(path, json={"level": 3, "expected_version": 0})
    assert first.status_code == 200, first.text
    hint = CoachHint.model_validate(first.json()["data"])
    store = client.app.state.store
    store._coach_hints.clear()  # This fixture contains only this test's cache.
    legacy = hint.model_copy(update={"promptVersion": "coach_hint_v1", "hintText": "旧版提示"})
    store._coach_hints[(game_id, 0, "B", 3, "coach_hint_v1")] = legacy
    current = client.post(path, json={"level": 3, "expected_version": 0})
    assert current.status_code == 200, current.text
    assert current.json()["data"]["hintText"] != "旧版提示"
    assert current.json()["data"]["promptVersion"] != "coach_hint_v1"
    assert store._coach_hints[(game_id, 0, "B", 3, "coach_hint_v1")] == legacy

def test_legacy_training_scoring_config_retains_original_static_evaluation(client):
    game_id = position(client, "A")
    before = client.portal.call(client.app.state.store.get_snapshot, game_id).state
    move = Move(from_node="P26", to_node="P03")
    after = client.portal.call(client.app.state.adapter.execute_turn, before, move).state
    legacy = client.portal.call(client.app.state.adapter.review_move, before, after, move,
        ReviewConfig(version=1, max_depth=1, time_limit_ms_per_move=10000))
    assert legacy.evaluationAfter.score == 888
    assert legacy.bestScore < 900_000
    current = client.portal.call(client.app.state.adapter.review_move, before, after, move,
        ReviewConfig(version=2, max_depth=1, time_limit_ms_per_move=10000))
    assert current.bestScore >= 999_997 and current.scoreLoss > 900_000

def test_legacy_review_cache_is_preserved_but_new_review_uses_current_strategy(client):
    game_id = position(client, "A")
    path = f"/api/v1/game/{game_id}"
    for move in ({"from_node": "P05", "to_node": "P03"},):
        assert client.post(path + "/move", json=move).status_code == 200
    assert client.post(path + "/ai-move", json={}).status_code == 200
    assert client.post(path + "/move", json={"from_node": "P03", "to_node": "P28"}).status_code == 200
    created = client.post(path + "/review", json={"reviewed_player": "B"})
    assert created.status_code == 200, created.text
    review = GameReview.model_validate(created.json()["data"])
    store = client.app.state.store
    store._reviews.pop((game_id, "B", review.reviewConfigVersion))
    legacy = review.model_copy(update={"id": "legacy-review", "reviewConfigVersion": 1,
        "reviewConfig": review.reviewConfig.model_copy(update={"version": 1})})
    store._reviews[(game_id, "B", 1)] = legacy
    fresh = client.post(path + "/review", json={"reviewed_player": "B"})
    assert fresh.status_code == 200, fresh.text
    assert fresh.json()["data"]["id"] != legacy.id
    assert fresh.json()["data"]["reviewConfigVersion"] == ReviewConfig().version
    assert store._reviews[(game_id, "B", 1)] == legacy

@pytest.mark.parametrize("text", ["这步围堵后一定获胜", "这步能保证围堵成功", "这步必然形成庙困"])
def test_unproved_guaranteed_blockade_synonyms_are_rejected(text):
    from backend.app.services.coach.policy import AllowedCoachEvidence
    evidence = AllowedCoachEvidence(level=3, focusTopics=["围堵"], threatTypes=[],
        candidateFromNodes=[], bestMove=Move(from_node="P05", to_node="P03"))
    assert not validate_coach_text(text, evidence)

def test_preexisting_v1_curated_item_loads_after_strategy_update(client):
    from unittest.mock import patch
    from hashlib import md5
    from datetime import datetime, timezone
    from backend.app.services import training_catalog as catalog
    from backend.app.schemas.training import TrainingItemInternal, TrainingDifficultyBasis
    key, title, pieces, player = catalog.POSITIONS[0]
    adapter = client.app.state.adapter
    state = client.portal.call(adapter.initialize, player)
    state.board.occupancy = {node: pieces.get(node) for node in state.board.occupancy}
    legal = client.portal.call(adapter.legal_moves, state)
    config = ReviewConfig(version=1, max_depth=2, time_limit_ms_per_move=10000, candidate_limit=29)
    turn = client.portal.call(adapter.execute_turn, state, legal[0])
    scored = client.portal.call(adapter.review_move, state, turn.state, legal[0], config)
    legacy = TrainingItemInternal(id=md5(f'wuma-curated-v1-{key}'.encode()).hexdigest(),
        sourceKind='CURATED', title=title, catalogVersion=1, player=player, stateSnapshot=state,
        stateSchemaVersion=1, bestMove=scored.bestMove, bestScore=scored.bestScore,
        trainingTags=['ENDGAME'], difficultyTag=catalog.difficulty(len(legal)),
        difficultyBasis=TrainingDifficultyBasis(kind='ENGINE_ESTIMATE', legalCandidateCount=len(legal),
            scoringDepth=2, configVersion=1), scoringConfig=config, reviewConfigVersion=1,
        scoringDepth=2, createdAt=datetime(2026, 10, 6, tzinfo=timezone.utc))
    store = client.app.state.store
    client.portal.call(store.commit_curated_items, [legacy])
    with patch.object(catalog, 'POSITIONS', (catalog.POSITIONS[0],)), patch.object(catalog, 'LESSONS', ()):
        response = client.get('/api/v1/training?source=CURATED')
        assert response.status_code == 200, response.text
        assert response.json()['data']['items'][0]['id'] == legacy.id
        assert client.portal.call(store.get_training_item, legacy.id) == legacy
        answer = client.post(f'/api/v1/training/{legacy.id}/answer', json={
            'from_node': legacy.bestMove.from_node, 'to_node': legacy.bestMove.to_node,
            'client_attempt_id': 'legacy-curated-upgrade-001'})
        assert answer.status_code == 200, answer.text
        assert answer.json()['data']['result'] == 'CORRECT'
