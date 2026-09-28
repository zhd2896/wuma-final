"""Coach level boundaries over the real Node position analyzer."""

import asyncio
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.core.errors import ApiError
from backend.app.core.config import Settings
from backend.app.schemas.game import BoardState, Move, PositionAnalysis
from backend.app.services.game_store import InMemoryGameStore
from backend.app.services.coach.policy import CoachHintPolicy
from backend.app.services.coach.grounding import validate_coach_text
from backend.app.services.coach.prompt import CoachPromptBuilder


class FakeProvider:
    name = "fake"
    model = "fake-model"

    def __init__(self, result: str):
        self.result = result
        self.calls = []

    async def generate(self, prompt):
        self.calls.append(prompt)
        return self.result


@pytest.fixture
def client():
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=False)) as test_client:
        yield test_client


def create_ai(client):
    response = client.post("/api/v1/game", json={"mode": "AI", "first_player": "A",
                                                "ai_player": "B", "ai_level": "STANDARD"})
    assert response.status_code == 200, response.text
    return response.json()["data"]["game_id"]


def hint(client, game_id, level, version=0):
    return client.post(f"/api/v1/game/{game_id}/coach/hint",
                       json={"level": level, "expected_version": version})


def test_policy_cuts_evidence_before_provider_and_grounding_rejects_leaks(client):
    game_id = create_ai(client)
    analysis = client.post("/api/v1/ai/analyze", json={"game_id": game_id}).json()["data"]
    best = analysis["bestMove"]
    assert best is not None
    evidence = PositionAnalysis.model_validate({key: value for key, value in analysis.items()
                                                if key not in ("game_id", "game_version")})
    first = CoachHintPolicy.build(evidence, 1)
    second = CoachHintPolicy.build(evidence, 2)
    third = CoachHintPolicy.build(evidence, 3)
    assert best["from"] not in str(first.model_dump())
    assert best["to"] not in str(first.model_dump())
    assert "bestMove" not in CoachPromptBuilder.build(second).user
    assert best["to"] not in CoachPromptBuilder.build(second).user
    assert third.bestMove == evidence.bestMove
    assert not validate_coach_text(f'建议走 {best["from"]}→{best["to"]}', first)
    assert not validate_coach_text(f'把 {best["from"]} 移到 {best["to"]}', second)
    assert validate_coach_text(f'建议走 {best["from"]}→{best["to"]}', third)
    assert not validate_coach_text('建议走 P29→P28', third)
    assert not validate_coach_text('这一步有 90% 胜率', third)
    other = next((item.move for item in evidence.candidateMoves
                  if item.move != evidence.bestMove), None)
    assert other is not None
    assert not validate_coach_text(
        f'应该走 {other.from_node}→{other.to_node}', third)
    assert not validate_coach_text(
        f'请从{other.from_node}走到{other.to_node}', third)
    vulnerability_only = third.model_copy(update={
        "threatTypes": ["VULNERABILITY"], "bestMoveThreatTypes": []})
    assert not validate_coach_text('我方当前可以吃子', vulnerability_only)
    capture_elsewhere = third.model_copy(update={
        "threatTypes": ["CAPTURE_AVAILABLE"], "bestMoveThreatTypes": []})
    assert not validate_coach_text('这步可以捕获对方棋子', capture_elsewhere)


def test_no_key_levels_cache_and_move_are_read_only(client):
    game_id = create_ai(client)
    before = client.get(f"/api/v1/game/{game_id}").json()["data"]
    levels = [hint(client, game_id, level).json()["data"] for level in (1, 2, 3)]
    assert all(item["fallbackUsed"] for item in levels)
    assert all(item["gameVersion"] == 0 and item["analyzedPlayer"] == "A" for item in levels)
    assert levels[0]["bestMove"] is None and levels[0]["candidateFromNodes"] == []
    assert levels[1]["bestMove"] is None and levels[1]["candidateFromNodes"]
    assert levels[2]["bestMove"] is not None
    assert all("P0" not in item["hintText"] for item in levels[:1])
    assert len({item["hintText"] for item in levels}) == 3
    assert hint(client, game_id, 3).json()["data"] == levels[2]
    assert client.get(f"/api/v1/game/{game_id}").json()["data"] == before
    assert client.portal.call(client.app.state.store.list_moves, game_id) == []
    moved = client.post(f"/api/v1/game/{game_id}/move",
                        json={"from_node": "P01", "to_node": "P02"})
    assert moved.status_code == 200
    stale = hint(client, game_id, 3)
    assert stale.status_code == 409 and stale.json()["code"] == "GAME_STATE_CONFLICT"
    ai_turn = hint(client, game_id, 1, 1)
    assert ai_turn.status_code == 409 and ai_turn.json()["code"] == "NOT_PLAYER_TURN"


def test_provider_leaks_fallback_and_cache_avoids_repeat_calls():
    provider = FakeProvider('{"hintText":"建议走 P06→P07"}')
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=False, llm_provider=provider)) as client:
        game_id = create_ai(client)
        first = hint(client, game_id, 1)
        assert first.status_code == 200, first.text
        assert first.json()["data"]["fallbackUsed"] is True
        assert len(provider.calls) == 1
        assert "bestMove" not in provider.calls[0].user
        assert hint(client, game_id, 1).json()["data"] == first.json()["data"]
        assert len(provider.calls) == 1
        provider.result = '{"hintText":"把 P06 移到 P07"}'
        second = hint(client, game_id, 2)
        assert second.status_code == 200 and second.json()["data"]["fallbackUsed"] is True
        assert "bestMove" not in provider.calls[1].user
        provider.result = '{"hintText":"建议走 P29→P28"}'
        third = hint(client, game_id, 3)
        assert third.status_code == 200 and third.json()["data"]["fallbackUsed"] is True


def test_invalid_level_finished_and_engine_failure(client):
    game_id = create_ai(client)
    assert hint(client, game_id, 4).json()["code"] == "INVALID_HINT_LEVEL"
    with patch.object(client.app.state.adapter, "analyze_position",
                      side_effect=ApiError("ENGINE_UNAVAILABLE", "offline")):
        failed = hint(client, game_id, 1)
    assert failed.status_code == 503 and failed.json()["code"] == "ENGINE_UNAVAILABLE"
    state = client.app.state.store._games[game_id].state
    finished = state.model_copy(update={"game_status": "FINISHED", "winner": "A",
                                        "winner_reason": "CAPTURE_ALL"})
    client.portal.call(client.app.state.store.update, game_id, finished)
    denied = hint(client, game_id, 1)
    assert denied.status_code == 409 and denied.json()["code"] == "GAME_ALREADY_FINISHED"


def test_valid_provider_keeps_engine_best_move():
    provider = FakeProvider('{"hintText":"稍后提供解释"}')
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=False, llm_provider=provider)) as client:
        game_id = create_ai(client)
        analysis = client.post("/api/v1/ai/analyze", json={"game_id": game_id}).json()["data"]
        best = analysis["bestMove"]
        provider.result = (f'{{"hintText":"当前推荐走 {best["from"]}→{best["to"]}，'
                           '这是引擎给出的行动。"}')
        response = hint(client, game_id, 3)
        assert response.status_code == 200, response.text
        data = response.json()["data"]
        assert data["bestMove"] == best
        assert data["fallbackUsed"] is False
        assert data["provider"] == "fake"
        assert len(provider.calls) == 1
        second_id = create_ai(client)
        second_analysis = client.post("/api/v1/ai/analyze",
                                      json={"game_id": second_id}).json()["data"]
        other = next(item["move"] for item in second_analysis["candidateMoves"]
                     if item["move"] != second_analysis["bestMove"])
        provider.result = f'{{"hintText":"应该走 {other["from"]}→{other["to"]}"}}'
        wrong = hint(client, second_id, 3)
        assert wrong.status_code == 200 and wrong.json()["data"]["fallbackUsed"] is True
        assert wrong.json()["data"]["bestMove"] == second_analysis["bestMove"]


def test_provider_timeout_falls_back_without_losing_engine_hint():
    class SlowProvider(FakeProvider):
        async def generate(self, prompt):
            await asyncio.sleep(0.05)
            return self.result

    provider = SlowProvider('{"hintText":"延迟回复"}')
    with TestClient(create_app(settings=Settings(llm_timeout_seconds=0.001),
                               store=InMemoryGameStore(), require_auth=False, llm_provider=provider)) as client:
        game_id = create_ai(client)
        response = hint(client, game_id, 3)
        assert response.status_code == 200, response.text
        assert response.json()["data"]["fallbackUsed"] is True
        assert response.json()["data"]["bestMove"] is not None


def test_level_one_uses_real_engine_threat_without_nodes(client):
    game_id = create_ai(client)
    store = client.app.state.store
    state = store._games[game_id].state
    occupancy = {node: None for node in state.board.occupancy}
    occupancy.update({"P11": "A", "P12": "B", "P08": "B", "P18": "B", "P19": "A"})
    client.portal.call(store.update, game_id,
                       state.model_copy(update={"board": BoardState(occupancy=occupancy)}))
    analysis = client.post("/api/v1/ai/analyze", json={"game_id": game_id}).json()["data"]
    assert analysis["threats"]
    first = hint(client, game_id, 1).json()["data"]
    assert first["fallbackUsed"] is True
    assert first["focusTopics"]
    assert "P11" not in first["hintText"] and "P19" not in first["hintText"]
    assert first["bestMove"] is None


def test_move_during_analysis_rejects_stale_hint(client):
    game_id = create_ai(client)
    original = client.app.state.adapter.analyze_position

    async def move_during_search(state, *args):
        analysis = await original(state, *args)
        turn = await client.app.state.adapter.execute_turn(
            state, Move(from_node="P01", to_node="P02"))
        await client.app.state.store.commit_turn(game_id, 0, turn, "HUMAN")
        return analysis

    with patch.object(client.app.state.adapter, "analyze_position",
                      side_effect=move_during_search):
        response = hint(client, game_id, 3)
    assert response.status_code == 409 and response.json()["code"] == "GAME_STATE_CONFLICT"
    assert client.app.state.store._coach_hints == {}
