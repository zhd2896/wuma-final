"""Anonymous device identity and ownership at the HTTP boundary."""

from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.services.game_store import InMemoryGameStore
from backend.tests.test_training import finished_review


def test_device_account_recovers_and_isolates_games():
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=True)) as client:
        assert client.get("/api/v1/me/profile").status_code == 401
        first = client.post("/api/v1/auth/device").json()["data"]
        second = client.post("/api/v1/auth/device").json()["data"]
        assert first["userId"] != second["userId"]
        assert first["token"] != second["token"]
        client.headers["Authorization"] = "Bearer " + first["token"]
        assert client.get("/api/v1/me/profile").json()["data"]["games"] == 0
        game_id = client.post("/api/v1/game", json={"mode": "AI", "first_player": "A"}).json()["data"]["game_id"]
        assert client.get("/api/v1/me/profile").json()["data"]["games"] == 1
        assert client.get("/api/v1/me/games").json()["data"]["items"][0]["gameId"] == game_id
        client.headers["Authorization"] = "Bearer " + second["token"]
        assert client.get("/api/v1/me/profile").json()["data"]["games"] == 0
        assert client.get(f"/api/v1/game/{game_id}").status_code == 403
        assert client.post(f"/api/v1/game/{game_id}/move", json={"from_node": "P01", "to_node": "P02"}).status_code == 403
        assert client.post("/api/v1/ai/analyze", json={"game_id": game_id}).status_code == 403
        assert client.get(f"/api/v1/game/{game_id}/review").status_code == 403
        client.headers["Authorization"] = "Bearer " + first["token"]
        assert client.get(f"/api/v1/game/{game_id}").status_code == 200


def test_account_game_cursor_has_no_duplicates():
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=True)) as client:
        token = client.post("/api/v1/auth/device").json()["data"]["token"]
        client.headers["Authorization"] = "Bearer " + token
        created = [client.post("/api/v1/game", json={"mode": "AI", "first_player": "A"}).json()["data"]["game_id"] for _ in range(3)]
        first = client.get("/api/v1/me/games?limit=2").json()["data"]
        second = client.get("/api/v1/me/games", params={"limit": 2, "cursor": first["nextCursor"]}).json()["data"]
        ids = [row["gameId"] for row in first["items"] + second["items"]]
        assert set(ids) == set(created) and len(ids) == 3
        assert second["nextCursor"] is None
        assert client.get("/api/v1/me/games?status=FINISHED").json()["data"]["items"] == []
        assert client.get("/api/v1/me/games?cursor=not-base64").status_code == 422
        client.headers["Authorization"] = "Bearer " + 'f' * 64
        assert client.get("/api/v1/me/games").status_code == 401


def test_training_and_legacy_data_stay_outside_other_accounts():
    store = InMemoryGameStore()
    with TestClient(create_app(store=store, require_auth=True)) as client:
        old_id = client.portal.call(store.create,
                                    client.portal.call(client.app.state.adapter.initialize, "A"))
        first = client.post("/api/v1/auth/device").json()["data"]["token"]
        second = client.post("/api/v1/auth/device").json()["data"]["token"]
        client.headers["Authorization"] = "Bearer " + first
        assert client.get(f"/api/v1/game/{old_id}").status_code == 403
        game_id, review = finished_review(client)
        questions = client.post(f"/api/v1/game/{game_id}/training", json={}).json()["data"]["items"]
        assert questions
        question = questions[0]
        best = next(move["bestMove"] for move in review["moveReviews"]
                    if move["turn"] == question["sourceTurn"])
        answered = client.post(f'/api/v1/training/{question["id"]}/answer', json={
            "from_node": best["from"], "to_node": best["to"],
            "client_attempt_id": "account-training-0001"})
        assert answered.status_code == 200, answered.text
        assert client.get("/api/v1/me/profile").json()["data"]["training"] == 1
        client.headers["Authorization"] = "Bearer " + second
        assert client.get("/api/v1/training").json()["data"]["total"] == 0
        assert client.get(f'/api/v1/training/{question["id"]}').status_code == 403
        assert client.post(f'/api/v1/training/{question["id"]}/answer', json={
            "from_node": best["from"], "to_node": best["to"],
            "client_attempt_id": "account-training-0002"}).status_code == 403
        assert client.get("/api/v1/me/profile").json()["data"]["training"] == 0
