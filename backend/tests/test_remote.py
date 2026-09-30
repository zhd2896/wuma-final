"""Two independently held room tokens control one authoritative remote game."""

from fastapi.testclient import TestClient
import pytest

from backend.app.main import create_app
from backend.app.services.game_store import InMemoryGameStore


def data(response, status=200):
    assert response.status_code == status, response.text
    return response.json()["data"]


def playing_room(client):
    host = data(client.post("/api/v1/remote/rooms", json={
        "device_id": "operations-host-123", "public": False,
    }))
    guest = data(client.post("/api/v1/remote/join", json={
        "invite_code": host["invite_code"], "device_id": "operations-guest-456",
    }))
    return (host["game_id"], {"X-Room-Token": host["token"]},
            {"X-Room-Token": guest["token"]})


def remote_move(client, game_id, headers, source, destination, version, request_id):
    return client.post(f"/api/v1/remote/rooms/{game_id}/move", headers=headers, json={
        "from_node": source, "to_node": destination,
        "expected_version": version, "client_request_id": request_id,
    })


def remote_operation(client, game_id, path, headers, version, request_id):
    return client.post(f"/api/v1/remote/rooms/{game_id}/{path}", headers=headers, json={
        "expected_version": version, "client_request_id": request_id,
    })


def test_private_room_two_seats_turns_idempotency_and_reconnect():
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=False)) as client:
        host = data(client.post("/api/v1/remote/rooms", json={
            "device_id": "device-host-123", "public": False,
        }))
        assert host["seat"] == "A" and host["room_status"] == "WAITING"
        assert host["version"] == host["ply_count"] == 0
        assert host["state"]["current_player"] == "A"
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
        assert moved["version"] == moved["ply_count"] == 1
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
        assert guest_view["version"] == guest_view["ply_count"] == 1
        assert guest_view["seat"] == "B"
        assert guest_view["state"]["board"]["occupancy"]["P02"] == "A"
        second = data(client.post(path, json={"from_node": "P05", "to_node": "P04",
                                               "expected_version": 1,
                                               "client_request_id": "request-B-0001"}, headers=b))
        assert second["version"] == second["ply_count"] == 2
        reconnected = data(client.get(f"/api/v1/remote/rooms/{game_id}", headers=a))
        assert reconnected["version"] == reconnected["ply_count"] == 2
        assert reconnected["seat"] == "A"
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
            assert moved["version"] == moved["ply_count"] == index + 1
        views = [data(client.get(path, headers={"X-Room-Token": item["token"]}))
                 for item in (host, guest)]
        assert views[0]["state"] == views[1]["state"]
        assert views[0]["version"] == views[1]["version"] == len(fixture)
        assert views[0]["ply_count"] == views[1]["ply_count"] == len(fixture)
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


def test_remote_undo_requires_requesters_active_move():
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=False)) as client:
        game_id, a, b = playing_room(client)
        for headers in (a, b):
            response = remote_operation(client, game_id, "undo-requests", headers, 0,
                                        f"no-anchor-{headers['X-Room-Token'][-8:]}")
            assert response.status_code == 409
            assert response.json()["code"] == "UNDO_NOT_AVAILABLE"


def test_pending_remote_undo_freezes_moves_and_survives_reconnect():
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=False)) as client:
        game_id, a, b = playing_room(client)
        data(remote_move(client, game_id, a, "P01", "P02", 0, "pending-move-a1"))

        created = data(remote_operation(client, game_id, "undo-requests", a, 1,
                                        "pending-create-a1"))
        pending = created["pending_undo"]
        assert pending == {
            "id": pending["id"], "requester": "A", "responder": "B",
            "base_revision": 1, "anchor_turn": 1, "revert_count": 1,
            "status": "PENDING",
        }
        assert data(client.get(f"/api/v1/remote/rooms/{game_id}", headers=b))["pending_undo"] == pending

        legal = client.get(f"/api/v1/remote/rooms/{game_id}/legal-moves", headers=b)
        move = remote_move(client, game_id, b, "P05", "P04", 1, "pending-move-b1")
        second = remote_operation(client, game_id, "undo-requests", b, 1,
                                  "pending-create-b1")
        for response in (legal, move, second):
            assert response.status_code == 409
            assert response.json()["code"] == "REMOTE_UNDO_PENDING"


def test_remote_accept_undo_reverts_one_move_and_is_idempotent():
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=False)) as client:
        game_id, a, b = playing_room(client)
        data(remote_move(client, game_id, a, "P01", "P02", 0, "one-move-a1"))
        created = data(remote_operation(client, game_id, "undo-requests", a, 1,
                                        "one-create-a1"))
        request_id = created["pending_undo"]["id"]

        denied = remote_operation(client, game_id,
                                  f"undo-requests/{request_id}/accept", a, 1,
                                  "one-denied-a1")
        assert denied.status_code == 403
        assert denied.json()["code"] == "REMOTE_ACCESS_DENIED"

        first = data(remote_operation(client, game_id,
                                      f"undo-requests/{request_id}/accept", b, 1,
                                      "one-accept-b1"))
        repeated = data(remote_operation(client, game_id,
                                         f"undo-requests/{request_id}/accept", b, 1,
                                         "one-accept-b1"))
        assert repeated == first
        assert first["version"] == 2
        assert first["ply_count"] == 0
        assert first["pending_undo"] is None
        assert first["state"]["current_player"] == "A"
        assert len(client.portal.call(client.app.state.store.list_moves, game_id)) == 0
        frames = client.portal.call(client.app.state.service.replay_game, game_id)
        assert len(frames) == 1 and frames[0] == client.portal.call(
            client.app.state.store.get_snapshot, game_id).state
        old_move_retry = remote_move(
            client, game_id, a, "P01", "P02", 0, "one-move-a1")
        assert old_move_retry.status_code == 409
        assert old_move_retry.json()["code"] == "REMOTE_REQUEST_CONFLICT"


def test_remote_accept_undo_reverts_requesters_move_and_opponents_reply():
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=False)) as client:
        game_id, a, b = playing_room(client)
        data(remote_move(client, game_id, a, "P01", "P02", 0, "two-move-a1"))
        data(remote_move(client, game_id, b, "P05", "P04", 1, "two-move-b1"))
        created = data(remote_operation(client, game_id, "undo-requests", a, 2,
                                        "two-create-a1"))
        pending = created["pending_undo"]
        assert pending["anchor_turn"] == 1
        assert pending["revert_count"] == 2

        accepted = data(remote_operation(
            client, game_id, f"undo-requests/{pending['id']}/accept", b, 2,
            "two-accept-b1"))
        assert accepted["version"] == 3
        assert accepted["ply_count"] == 0
        assert accepted["state"]["board"]["occupancy"]["P01"] == "A"
        assert accepted["state"]["board"]["occupancy"]["P05"] == "B"


def test_remote_decline_keeps_revision_and_enforces_idempotency_conflicts():
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=False)) as client:
        game_id, a, b = playing_room(client)
        data(remote_move(client, game_id, a, "P01", "P02", 0, "decline-move-a1"))
        first_create = data(remote_operation(client, game_id, "undo-requests", a, 1,
                                             "decline-create-a1"))
        repeated_create = data(remote_operation(client, game_id, "undo-requests", a, 1,
                                                "decline-create-a1"))
        assert repeated_create == first_create
        changed_create = remote_operation(client, game_id, "undo-requests", a, 0,
                                          "decline-create-a1")
        create_as_resign = remote_operation(client, game_id, "resign", a, 1,
                                            "decline-create-a1")
        for response in (changed_create, create_as_resign):
            assert response.status_code == 409
            assert response.json()["code"] == "REMOTE_REQUEST_CONFLICT"
        request_id = first_create["pending_undo"]["id"]

        declined = data(remote_operation(
            client, game_id, f"undo-requests/{request_id}/decline", b, 1,
            "decline-resolve-b1"))
        repeated = data(remote_operation(
            client, game_id, f"undo-requests/{request_id}/decline", b, 1,
            "decline-resolve-b1"))
        assert repeated == declined
        assert declined["version"] == declined["ply_count"] == 1
        assert declined["pending_undo"] is None

        changed_action = remote_operation(
            client, game_id, f"undo-requests/{request_id}/accept", b, 1,
            "decline-resolve-b1")
        changed_version = remote_operation(
            client, game_id, f"undo-requests/{request_id}/decline", b, 0,
            "decline-resolve-b1")
        reused_for_resign = remote_operation(client, game_id, "resign", b, 1,
                                             "decline-resolve-b1")
        for response in (changed_action, changed_version, reused_for_resign):
            assert response.status_code == 409
            assert response.json()["code"] == "REMOTE_REQUEST_CONFLICT"
        continued = data(remote_move(
            client, game_id, b, "P05", "P04", 1, "decline-move-b1"))
        assert continued["version"] == continued["ply_count"] == 2


def test_remote_undo_becomes_stale_if_authoritative_revision_changes():
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=False)) as client:
        game_id, a, b = playing_room(client)
        data(remote_move(client, game_id, a, "P01", "P02", 0, "stale-move-a1"))
        created = data(remote_operation(client, game_id, "undo-requests", a, 1,
                                        "stale-create-a1"))
        request_id = created["pending_undo"]["id"]
        # Simulate an out-of-band state change to exercise defensive stale handling.
        game = client.app.state.store._games[game_id]
        client.app.state.store._games[game_id] = game.__class__(
            **{**game.__dict__, "version": 2})

        stale = remote_operation(client, game_id,
                                 f"undo-requests/{request_id}/accept", b, 1,
                                 "stale-accept-b1")
        assert stale.status_code == 409
        assert stale.json()["code"] == "GAME_STATE_CONFLICT"
        retried = remote_operation(client, game_id,
                                   f"undo-requests/{request_id}/accept", b, 1,
                                   "stale-accept-b1")
        assert retried.status_code == 409
        assert retried.json()["code"] == "GAME_STATE_CONFLICT"
        assert client.app.state.store._remote_undo_requests[request_id].status == "STALE"
        assert data(client.get(f"/api/v1/remote/rooms/{game_id}", headers=a))["pending_undo"] is None


@pytest.mark.parametrize(("loser_seat", "winner"), [("A", "B"), ("B", "A")])
def test_remote_resign_during_pending_undo_creates_replayable_terminal(loser_seat, winner):
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=False)) as client:
        game_id, a, b = playing_room(client)
        data(remote_move(client, game_id, a, "P01", "P02", 0, "resign-move-a1"))
        created = data(remote_operation(client, game_id, "undo-requests", a, 1,
                                        "resign-create-a1"))
        request_id = created["pending_undo"]["id"]

        loser_headers = a if loser_seat == "A" else b
        resign_id = f"resign-seat-{loser_seat.lower()}1"
        resigned = data(remote_operation(client, game_id, "resign", loser_headers, 1,
                                         resign_id))
        repeated = data(remote_operation(client, game_id, "resign", loser_headers, 1,
                                         resign_id))
        assert repeated == resigned
        assert resigned["version"] == 2 and resigned["ply_count"] == 1
        assert resigned["room_status"] == "FINISHED"
        assert resigned["pending_undo"] is None
        assert resigned["state"]["winner"] == winner
        assert resigned["state"]["winner_reason"] == "RESIGN"
        assert client.app.state.store._remote_undo_requests[request_id].status == "STALE"
        frames = client.portal.call(client.app.state.service.replay_game, game_id)
        assert len(frames) == 3 and frames[-1].winner_reason == "RESIGN"

        for path, headers in (("undo-requests", a), ("resign", a)):
            blocked = remote_operation(client, game_id, path, headers, 2,
                                       f"finished-{path.replace('-', '')}-a1")
            assert blocked.status_code == 409
            assert blocked.json()["code"] == "GAME_ALREADY_FINISHED"
        resolve = remote_operation(client, game_id,
                                   f"undo-requests/{request_id}/accept", b, 1,
                                   "finished-accept-b1")
        assert resolve.status_code == 409
        assert resolve.json()["code"] == "GAME_ALREADY_FINISHED"


def test_remote_operations_require_valid_seat_and_reject_stale_versions():
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=False)) as client:
        game_id, a, _b = playing_room(client)
        data(remote_move(client, game_id, a, "P01", "P02", 0, "auth-move-a1"))
        invalid = {"X-Room-Token": "invalid-token"}
        for path in ("undo-requests", "resign"):
            denied = remote_operation(client, game_id, path, invalid, 1,
                                      f"auth-{path.replace('-', '')}-x1")
            assert denied.status_code == 403
            assert denied.json()["code"] == "REMOTE_ACCESS_DENIED"
            stale = remote_operation(client, game_id, path, a, 0,
                                     f"version-{path.replace('-', '')}-a1")
            assert stale.status_code == 409
            assert stale.json()["code"] == "GAME_STATE_CONFLICT"
