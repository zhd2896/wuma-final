"""Training questions come from actual reviewed turns; answers never mutate games."""

from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.services.game_store import InMemoryGameStore


MOVES = [
    ("P01", "P19"), ("P05", "P01"), ("P16", "P18"), ("P01", "P07"),
    ("P18", "P13"), ("P07", "P03"), ("P11", "P17"), ("P10", "P07"),
    ("P06", "P11"), ("P15", "P14"), ("P17", "P22"), ("P14", "P04"),
    ("P19", "P23"), ("P20", "P17"),
]


def finished_review(client):
    created = client.post("/api/v1/game", json={"first_player": "A", "mode": "LOCAL"})
    game_id = created.json()["data"]["game_id"]
    for source, target in MOVES:
        response = client.post(f"/api/v1/game/{game_id}/move",
                               json={"from_node": source, "to_node": target})
        assert response.status_code == 200, response.text
    review = client.post(f"/api/v1/game/{game_id}/review", json={})
    assert review.status_code == 200, review.text
    return game_id, review.json()["data"]


def test_real_review_generates_hidden_questions_and_scores_repeatable_attempts():
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=False)) as client:
        game_id, review = finished_review(client)
        before = client.get(f"/api/v1/game/{game_id}").json()["data"]
        before_moves = client.portal.call(client.app.state.store.list_moves, game_id)
        path = f"/api/v1/game/{game_id}/training"
        generated = client.post(path, json={})
        assert generated.status_code == 200, generated.text
        questions = generated.json()["data"]["items"]
        assert len(questions) == sum(move["category"] in ("MISTAKE", "BLUNDER")
                                     for move in review["moveReviews"])
        assert all(item["sourceCategory"] in ("MISTAKE", "BLUNDER") for item in questions)
        assert all("bestMove" not in item and "bestScore" not in item and
                   "originalMove" not in item for item in questions)
        assert client.post(path, json={}).json()["data"]["items"] == questions
        listed = client.get("/api/v1/training?limit=20&category=BLUNDER&training_type=BEST_MOVE")
        assert listed.status_code == 200
        expected_blunders = {item["id"] for item in questions if item["sourceCategory"] == "BLUNDER"}
        assert listed.json()["data"]["total"] == len(expected_blunders)
        assert {item["id"] for item in listed.json()["data"]["items"]} == expected_blunders
        assert "bestMove" not in listed.text and "bestScore" not in listed.text
        question = questions[0]
        detail = client.get(f'/api/v1/training/{question["id"]}')
        assert detail.status_code == 200
        assert "bestMove" not in detail.text and "bestScore" not in detail.text
        source = next(move for move in review["moveReviews"]
                      if move["turn"] == question["sourceTurn"])
        stored = client.portal.call(client.app.state.store.get_training_item, question["id"])
        assert stored.bestMove.model_dump(by_alias=True) == source["bestMove"]
        assert stored.bestScore == source["bestScore"]
        assert stored.originalMove.model_dump(by_alias=True) == source["actualMove"]
        assert stored.stateSnapshot.model_dump() == before_moves[source["turn"] - 1].turn.before_state.model_dump()
        assert stored.player == source["player"]
        assert stored.sourceMoveId == source["gameMoveId"]
        assert stored.scoringDepth == source["searchDepth"]
        assert stored.generationVersion == 1
        answer_path = f'/api/v1/training/{question["id"]}/answer'
        best = source["bestMove"]
        correct_body = {"from_node": best["from"], "to_node": best["to"],
                        "client_attempt_id": "correct-attempt-0001"}
        correct = client.post(answer_path, json=correct_body)
        assert correct.status_code == 200, correct.text
        result = correct.json()["data"]
        assert result["result"] == "CORRECT" and result["bestMoveEquivalent"] is True
        assert result["scoreLoss"] == 0 and result["bestMove"] == best
        assert result["searchDepth"] == source["searchDepth"]
        assert client.post(answer_path, json=correct_body).json()["data"] == result
        original = source["actualMove"]
        worse = client.post(answer_path, json={"from_node": original["from"],
                                               "to_node": original["to"],
                                               "client_attempt_id": "worse-attempt-0001"})
        assert worse.status_code == 200, worse.text
        suboptimal = worse.json()["data"]
        assert suboptimal["result"] == "SUBOPTIMAL"
        assert suboptimal["bestMoveEquivalent"] is False
        assert suboptimal["scoreLoss"] > 0
        assert suboptimal["submittedMove"] == original
        invalid = client.post(answer_path, json={"from_node": "P01", "to_node": "P01",
                                                 "client_attempt_id": "invalid-attempt-0001"})
        assert invalid.status_code == 400 and invalid.json()["code"] == "INVALID_MOVE"
        assert len(client.app.state.store._training_records) == 2
        assert client.get(f"/api/v1/game/{game_id}").json()["data"] == before
        assert client.portal.call(client.app.state.store.list_moves, game_id) == before_moves


def test_same_score_different_move_is_correct_without_string_matching():
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=False)) as client:
        game_id, _ = finished_review(client)
        question = client.post(f"/api/v1/game/{game_id}/training", json={}).json()["data"]["items"][0]
        item = client.portal.call(client.app.state.store.get_training_item, question["id"])
        legal = client.portal.call(client.app.state.adapter.legal_moves, item.stateSnapshot)
        alternate = next(move for move in legal if move != item.bestMove)
        real_review_move = client.app.state.adapter.review_move

        async def tied_score(*args):
            scored = await real_review_move(*args)
            return scored.model_copy(update={"actualMoveScore": item.bestScore,
                                             "scoreLoss": 0, "bestMoveEquivalent": True})

        with patch.object(client.app.state.adapter, "review_move", side_effect=tied_score):
            response = client.post(f'/api/v1/training/{question["id"]}/answer', json={
                "from_node": alternate.from_node, "to_node": alternate.to_node,
                "client_attempt_id": "tie-attempt-0001"})
        assert response.status_code == 200, response.text
        answer = response.json()["data"]
        assert answer["submittedMove"] != answer["bestMove"]
        assert answer["result"] == "CORRECT"
        assert answer["bestMoveEquivalent"] is True and answer["scoreLoss"] == 0
