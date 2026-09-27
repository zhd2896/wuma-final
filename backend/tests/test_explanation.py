"""Phase 22 explains saved review facts without changing engine conclusions."""

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from backend.app.core.config import Settings
from backend.app.main import create_app
from backend.app.schemas.game import GameReview, Move
from backend.app.services.game_store import InMemoryGameStore
from backend.tests.test_review import create_short_game


class FakeLLMProvider:
    name = "fake"
    model = "deterministic"

    def __init__(self, responses=(), error=None):
        self.responses = list(responses)
        self.error = error
        self.calls = []

    async def generate(self, prompt):
        self.calls.append(prompt)
        if self.error:
            raise self.error
        return self.responses.pop(0)


@pytest.fixture
def make_client():
    clients = []

    def make(provider=None, settings=None):
        settings = settings or Settings(llm_api_key="", llm_base_url="", llm_model="")
        context = TestClient(create_app(settings=settings, store=InMemoryGameStore(),
                                        llm_provider=provider))
        client = context.__enter__()
        clients.append(context)
        return client

    yield make
    for context in clients:
        context.__exit__(None, None, None)


def test_no_key_fallback_is_saved_and_review_unchanged(make_client):
    client = make_client()
    game_id = create_short_game(client)
    review = client.post(f"/api/v1/game/{game_id}/review", json={}).json()["data"]
    before = client.get(f"/api/v1/game/{game_id}").json()["data"]
    path = f"/api/v1/game/{game_id}/review/explain"
    assert client.get(path).json()["code"] == "EXPLANATION_NOT_FOUND"
    first = client.post(path, json={})
    assert first.status_code == 200, first.text
    data = first.json()["data"]
    assert data["review"] == review
    assert data["explanation"]["promptVersion"] == "review_explanation_v1"
    assert data["explanation"]["gameExplanation"]["fallbackUsed"] is True
    assert data["explanation"]["moveExplanations"][0]["fallbackUsed"] is True
    assert data["explanation"]["moveExplanations"][0]["turn"] == 1
    assert client.get(path).json()["data"] == data
    assert client.post(path, json={}).json()["data"] == data
    assert client.get(f"/api/v1/game/{game_id}/review").json()["data"] == review
    assert client.get(f"/api/v1/game/{game_id}").json()["data"] == before


def test_explain_requires_existing_review(make_client):
    client = make_client()
    game_id = create_short_game(client, finish=False)
    path = f"/api/v1/game/{game_id}/review/explain"
    assert client.post(path, json={}).json()["code"] == "REVIEW_NOT_FOUND"
    assert client.get(path).json()["code"] == "REVIEW_NOT_FOUND"


def test_valid_fake_provider_output_is_persisted_and_not_called_again(make_client):
    good = json.dumps({"overall_summary": "本局主要问题是关键回合失分。",
                       "strengths": ["完成了整局对弈。"], "main_problems": ["有需要复盘的失分回合。"],
                       "practice_suggestions": ["比较实际走法与引擎方案。"]}, ensure_ascii=False)
    fake = FakeLLMProvider([good])
    client = make_client(fake)
    game_id = create_short_game(client)
    client.post(f"/api/v1/game/{game_id}/review", json={})
    path = f"/api/v1/game/{game_id}/review/explain"
    first = client.post(path, json={}).json()["data"]
    assert first["explanation"]["gameExplanation"]["fallbackUsed"] is False
    assert first["explanation"]["gameExplanation"]["provider"] == "fake"
    assert len(fake.calls) == 1
    assert client.post(path, json={}).json()["data"] == first
    assert client.get(path).json()["data"] == first
    assert len(fake.calls) == 1


@pytest.mark.parametrize("response", [
    "not-json", "{}", "", "{\"overall_summary\":\"\"}",
    json.dumps({"overall_summary": "过长" * 200, "strengths": [],
                "main_problems": [], "practice_suggestions": []}, ensure_ascii=False),
    json.dumps({"overall_summary": "P25→P29 是最佳走法", "strengths": [],
                "main_problems": [], "practice_suggestions": []}, ensure_ascii=False),
    json.dumps({"overall_summary": "你的胜率为 80%", "strengths": [],
                "main_problems": [], "practice_suggestions": []}, ensure_ascii=False),
    json.dumps({"overall_summary": "这一步完成了夹吃", "strengths": [],
                "main_problems": [], "practice_suggestions": []}, ensure_ascii=False),
])
def test_invalid_provider_output_uses_fallback(make_client, response):
    fake = FakeLLMProvider([response])
    client = make_client(fake)
    game_id = create_short_game(client)
    client.post(f"/api/v1/game/{game_id}/review", json={})
    result = client.post(f"/api/v1/game/{game_id}/review/explain", json={})
    assert result.status_code == 200, result.text
    assert result.json()["data"]["explanation"]["gameExplanation"]["fallbackUsed"] is True


@pytest.mark.parametrize("error", [TimeoutError(), RuntimeError("provider unavailable")])
def test_provider_failure_uses_fallback(make_client, error):
    client = make_client(FakeLLMProvider(error=error))
    game_id = create_short_game(client)
    review = client.post(f"/api/v1/game/{game_id}/review", json={}).json()["data"]
    result = client.post(f"/api/v1/game/{game_id}/review/explain", json={})
    assert result.status_code == 200
    assert result.json()["data"]["review"] == review
    assert result.json()["data"]["explanation"]["gameExplanation"]["fallbackUsed"] is True


def test_grounding_rejects_unsupported_move_category_probability_and_capture():
    from backend.app.services.review_explanation.grounding import validate_game_text, validate_move_text

    actual = ("P18", "P13")
    best = ("P18", "P03")
    assert validate_move_text("实际走法相对最佳方案损失了评分。", actual, best, "BLUNDER")
    assert validate_move_text("比较实际走法和最佳走法。", actual, best, "BLUNDER")
    for claim in ("P25→P29 是最佳走法", "这是一步 GOOD", "你的胜率为 80%",
                  "这一步完成了夹吃", "P18→P29 很好", "P18→P29很好",
                  "实际这一步是最佳走法", "P18→P13 也是最佳走法",
                  "实际走法与最佳走法同分", "没有评分损失", "损失了 10 分",
                  "实际走法比最佳走法更强"):
        assert not validate_move_text(claim, actual, best, "BLUNDER"), claim
    for claim in ("玩家B取得最终胜利。", "本局表现完美。", "有三手严重失误。"):
        assert not validate_game_text(claim), claim


def test_priority_move_uses_grounded_fake_text_without_changing_review(make_client):
    move_text = json.dumps({"headline": "关键回合", "explanation": "实际走法损失了引擎评分。",
                            "suggestion": "比较实际走法和最佳走法。"}, ensure_ascii=False)
    fake = FakeLLMProvider([move_text])
    client = make_client(fake)
    game_id = create_short_game(client)
    review = GameReview.model_validate(
        client.post(f"/api/v1/game/{game_id}/review", json={}).json()["data"])
    priority = review.moveReviews[0].model_copy(update={"category": "BLUNDER"})
    changed = review.model_copy(update={"moveReviews": [priority], "turningPoints": [priority.turn]})
    result = client.portal.call(client.app.state.explanation_service._move, priority, changed)
    assert result.fallbackUsed is False
    assert result.explanation == "实际走法损失了引擎评分。"
    assert len(fake.calls) == 1
    assert "state_before" not in fake.calls[0].user
    assert "category" in fake.calls[0].user
    assert client.get(f"/api/v1/game/{game_id}/review").json()["data"]["moveReviews"][0]["category"] == review.moveReviews[0].category


def test_non_turning_move_uses_template_without_provider_call(make_client):
    fake = FakeLLMProvider([])
    client = make_client(fake)
    game_id = create_short_game(client)
    review = GameReview.model_validate(
        client.post(f"/api/v1/game/{game_id}/review", json={}).json()["data"])
    move = review.moveReviews[0].model_copy(update={"category": "BLUNDER"})
    changed = review.model_copy(update={"moveReviews": [move], "turningPoints": []})
    result = client.portal.call(client.app.state.explanation_service._move, move, changed)
    assert result.fallbackUsed is True
    assert fake.calls == []


def test_exhausted_total_budget_falls_back_without_more_provider_calls(make_client):
    fake = FakeLLMProvider([])
    client = make_client(fake)
    game_id = create_short_game(client)
    review = GameReview.model_validate(
        client.post(f"/api/v1/game/{game_id}/review", json={}).json()["data"])
    move = review.moveReviews[0].model_copy(update={"category": "BLUNDER"})
    priority = review.model_copy(update={"moveReviews": [move], "turningPoints": [move.turn]})

    async def exhausted():
        deadline = asyncio.get_running_loop().time() - 1
        service = client.app.state.explanation_service
        return await service._game(priority, deadline), await service._move(move, priority, deadline)

    game_text, move_text = client.portal.call(exhausted)
    assert game_text.fallbackUsed and move_text.fallbackUsed
    assert fake.calls == []


def test_real_async_timeout_enters_fallback(make_client):
    class SlowProvider(FakeLLMProvider):
        async def generate(self, prompt):
            self.calls.append(prompt)
            await asyncio.sleep(1)
            return "{}"

    fake = SlowProvider()
    client = make_client(fake, Settings(llm_api_key="", llm_base_url="", llm_model="",
                                        llm_timeout_seconds=0.01))
    game_id = create_short_game(client)
    client.post(f"/api/v1/game/{game_id}/review", json={})
    response = client.post(f"/api/v1/game/{game_id}/review/explain", json={})
    assert response.status_code == 200
    assert response.json()["data"]["explanation"]["gameExplanation"]["fallbackUsed"] is True
    assert len(fake.calls) >= 1


def test_equal_score_alternative_has_truthful_fallback(make_client):
    from backend.app.services.review_explanation.fallback import fallback_move

    client = make_client()
    game_id = create_short_game(client)
    review = GameReview.model_validate(
        client.post(f"/api/v1/game/{game_id}/review", json={}).json()["data"])
    original = review.moveReviews[0]
    alternative = Move.model_validate({"from": "P11", "to": "P01"})
    move = original.model_copy(update={"bestMove": alternative, "scoreLoss": 0,
                                       "bestMoveEquivalent": True, "category": "GOOD"})
    assert "等价最佳选择" in fallback_move(move).explanation


@pytest.mark.parametrize("claim", ["P25→P29 是最佳走法", "这是一步 GOOD",
                                   "你的胜率为 80%", "这一步完成了夹吃",
                                   "实际走法与最佳走法同分"])
def test_priority_move_hallucination_uses_fallback(make_client, claim):
    raw = json.dumps({"headline": "关键回合", "explanation": claim,
                      "suggestion": "比较实际走法和最佳走法。"}, ensure_ascii=False)
    fake = FakeLLMProvider([raw])
    client = make_client(fake)
    game_id = create_short_game(client)
    review = GameReview.model_validate(
        client.post(f"/api/v1/game/{game_id}/review", json={}).json()["data"])
    priority = review.moveReviews[0].model_copy(update={"category": "BLUNDER",
                                                  "scoreLoss": 220,
                                                  "bestMoveEquivalent": False})
    changed = review.model_copy(update={"moveReviews": [priority], "turningPoints": [priority.turn]})
    result = client.portal.call(client.app.state.explanation_service._move, priority, changed)
    assert result.fallbackUsed is True
    assert result.provider == "fallback"


@pytest.mark.parametrize("payload", [
    {"headline": "关键回合", "suggestion": "比较实际走法。"},
    {"headline": "关键回合", "explanation": "过长" * 150,
     "suggestion": "比较实际走法。"},
])
def test_priority_move_invalid_schema_uses_fallback(make_client, payload):
    fake = FakeLLMProvider([json.dumps(payload, ensure_ascii=False)])
    client = make_client(fake)
    game_id = create_short_game(client)
    review = GameReview.model_validate(
        client.post(f"/api/v1/game/{game_id}/review", json={}).json()["data"])
    priority = review.moveReviews[0].model_copy(update={"category": "BLUNDER"})
    changed = review.model_copy(update={"moveReviews": [priority], "turningPoints": [priority.turn]})
    result = client.portal.call(client.app.state.explanation_service._move, priority, changed)
    assert result.fallbackUsed is True
