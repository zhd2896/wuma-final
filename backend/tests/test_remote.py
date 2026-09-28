"""Two independently held room tokens control one authoritative remote game."""

from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.services.game_store import InMemoryGameStore


def data(response, status=200):
    assert response.status_code == status, response.text
    return response.json()["data"]


def test_private_room_two_seats_turns_idempotency_and_reconnect():
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=False)) as client:
        host = data(client.post("/api/v1/remote/rooms", json={
            "device_id": "device-host-123", "public": False,
        }))
        assert host["seat"] == "A" and host["room_status"] == "WAITING"
        assert host["version"] == 0 and host["state"]["current_player"] == "A"
        assert len(host["invite_code"]) == 8 and len(host["token"]) >= 32
        game_id = host["game_id"]
        a = {"X-Room-Token": host["token"]}
        assert data(client.get(f"/api/v1/remote/rooms/{game_id}", headers=a))["seat"] == "A"
        assert client.get(f"/api/v1/remote/rooms/{game_id}").status_code == 403
        assert client.get(f"/api/v1/game/{game_id}").status_code == 403
        assert client.get(f"/api/v1/game/{game_id}/legal-moves").status_code == 403

        guest = data(client.post("/api/v1/remote/join", json={
            "invite_code": host["invite_code"], "device_id": "device-guest-456",
        }))
        assert guest["game_id"] == game_id and guest["seat"] == "B"
        assert guest["room_status"] == "PLAYING" and guest["token"] != host["token"]
        b = {"X-Room-Token": guest["token"]}
        assert client.post("/api/v1/remote/join", json={
            "invite_code": host["invite_code"], "device_id": "third-device-789",
        }).status_code == 409

        path = f"/api/v1/remote/rooms/{game_id}/move"
        first = {"from_node": "P01", "to_node": "P02", "expected_version": 0,
                 "client_request_id": "request-A-0001"}
        assert client.post(path, json=first, headers=b).status_code == 403
        moved = data(client.post(path, json=first, headers=a))
        assert moved["version"] == 1
        assert moved["turn"]["state"]["board"]["occupancy"]["P02"] == "A"
        repeated = data(client.post(path, json=first, headers=a))
        assert repeated == moved
        changed = client.post(path, json={**first, "to_node": "P03"}, headers=a)
        assert changed.status_code == 409 and changed.json()["code"] == "REMOTE_REQUEST_CONFLICT"
        changed_version = client.post(path, json={**first, "expected_version": 1}, headers=a)
        assert changed_version.status_code == 409
        assert changed_version.json()["code"] == "REMOTE_REQUEST_CONFLICT"
        stale = client.post(path, json={**first, "client_request_id": "request-A-0002"}, headers=a)
        assert stale.status_code == 409 and stale.json()["code"] == "GAME_STATE_CONFLICT"
        wrong_turn = client.post(path, json={"from_node": "P02", "to_node": "P03",
                                             "expected_version": 1,
                                             "client_request_id": "request-A-0003"}, headers=a)
        assert wrong_turn.status_code == 403
        assert wrong_turn.json()["code"] == "NOT_YOUR_TURN"
        assert client.post(path, json={"from_node": "P05", "to_node": "P04",
                                       "expected_version": 1,
                                       "client_request_id": "request-X-0001"},
                           headers={"X-Room-Token": "invalid-token"}).status_code == 403
        assert client.post(f"/api/v1/game/{game_id}/move", json={
            "from_node": "P05", "to_node": "P04",
        }).status_code == 403

        guest_view = data(client.get(f"/api/v1/remote/rooms/{game_id}", headers=b))
        assert guest_view["version"] == 1 and guest_view["seat"] == "B"
        assert guest_view["state"]["board"]["occupancy"]["P02"] == "A"
        second = data(client.post(path, json={"from_node": "P05", "to_node": "P04",
                                               "expected_version": 1,
                                               "client_request_id": "request-B-0001"}, headers=b))
        assert second["version"] == 2
        reconnected = data(client.get(f"/api/v1/remote/rooms/{game_id}", headers=a))
        assert reconnected["version"] == 2 and reconnected["seat"] == "A"
        assert reconnected["state"]["board"]["occupancy"]["P04"] == "B"
        assert len(client.portal.call(client.app.state.store.list_moves, game_id)) == 2


def test_public_matching_self_join_prevention_and_host_cancellation():
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=False)) as client:
        waiting = data(client.post("/api/v1/remote/match", json={
            "device_id": "same-device-123",
        }))
        assert waiting["seat"] == "A" and waiting["room_status"] == "WAITING"
        same_device = data(client.post("/api/v1/remote/match", json={
            "device_id": "same-device-123",
        }))
        assert same_device["game_id"] != waiting["game_id"]
        guest = data(client.post("/api/v1/remote/match", json={
            "device_id": "other-device-456",
        }))
        assert guest["game_id"] == waiting["game_id"]
        assert guest["seat"] == "B" and guest["room_status"] == "PLAYING"
        assert client.post(f"/api/v1/remote/rooms/{waiting['game_id']}/cancel",
                           headers={"X-Room-Token": waiting["token"]}).status_code == 409
        cancelled = data(client.post(f"/api/v1/remote/rooms/{same_device['game_id']}/cancel",
                                     headers={"X-Room-Token": same_device["token"]}))
        assert cancelled["room_status"] == "CANCELLED"
        assert client.post("/api/v1/remote/join", json={
            "invite_code": same_device["invite_code"], "device_id": "late-device-789",
        }).status_code == 409


def test_two_remote_seats_reach_the_same_authoritative_terminal():
    fixture = [
        ("P01", "P19"), ("P05", "P01"), ("P16", "P18"), ("P01", "P07"),
        ("P18", "P13"), ("P07", "P03"), ("P11", "P17"), ("P10", "P07"),
        ("P06", "P11"), ("P15", "P14"), ("P17", "P22"), ("P14", "P04"),
        ("P19", "P23"), ("P20", "P17"),
    ]
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=False)) as client:
        host = data(client.post("/api/v1/remote/rooms", json={
            "device_id": "terminal-host-123"}))
        guest = data(client.post("/api/v1/remote/join", json={
            "invite_code": host["invite_code"], "device_id": "terminal-guest-456"}))
        game_id = host["game_id"]
        path = f"/api/v1/remote/rooms/{game_id}"
        for index, (source, destination) in enumerate(fixture):
            token = host["token"] if index % 2 == 0 else guest["token"]
            moved = data(client.post(f"{path}/move", headers={"X-Room-Token": token},
                                     json={"from_node": source, "to_node": destination,
                                           "expected_version": index,
                                           "client_request_id": f"terminal-move-{index:04d}"}))
            assert moved["version"] == index + 1
        views = [data(client.get(path, headers={"X-Room-Token": item["token"]}))
                 for item in (host, guest)]
        assert views[0]["state"] == views[1]["state"]
        assert views[0]["version"] == views[1]["version"] == len(fixture)
        assert views[0]["room_status"] == views[1]["room_status"] == "FINISHED"
        assert views[0]["state"]["winner"] in ("A", "B")
        assert client.get(f"/api/v1/game/{game_id}/review").status_code == 403
        assert client.post(f"/api/v1/game/{game_id}/review", json={}).status_code == 403
        assert client.get(f"/api/v1/game/{game_id}/review/explain").status_code == 403
        assert client.post("/api/v1/ai/analyze", json={"game_id": game_id}).status_code == 403
        assert client.post(f"{path}/move", headers={"X-Room-Token": host["token"]},
                           json={"from_node": "P01", "to_node": "P02",
                                 "expected_version": len(fixture),
                                 "client_request_id": "terminal-move-extra"}).status_code == 409
