"""Run with WUMA_TEST_DATABASE_URL set to a dedicated migrated MySQL 8 database."""

import os
import hashlib
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, delete, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from backend.app.core.config import Settings
from backend.app.core.errors import ApiError
from backend.app.db.models import (AiAnalysisModel, CoachHintModel, TrainingItemModel,
                                    TrainingRecordModel, GameModel, GameMoveModel,
                                    GameReviewModel, MoveReviewModel,
                                    ReviewExplanationModel, RemoteRoomModel, UserModel,
                                    GameTerminalEventModel, GameUndoEventModel,
                                    RemoteUndoRequestModel, AuthSessionModel, LocalGameImportModel, utc_now)
from backend.app.db.repositories.move import MoveRepository
from backend.app.db.repositories.mysql_store import MySQLGameStore
from backend.app.main import create_app
from backend.app.schemas.game import BoardState, GameOperationRequest, GameState, Move
from backend.app.schemas.remote import RemoteOperationRequest
from backend.app.services.remote_service import token_hash


DB_URL = os.getenv("WUMA_TEST_DATABASE_URL")
if DB_URL:
    parsed_url = make_url(DB_URL)
    if not parsed_url.drivername.startswith("mysql") or not (parsed_url.database or "").endswith("_test"):
        raise RuntimeError("WUMA_TEST_DATABASE_URL must name a MySQL database ending in _test")
pytestmark = pytest.mark.skipif(not DB_URL, reason="isolated MySQL 8 test database not configured")


@pytest.fixture
def db():
    engine = create_engine(DB_URL)
    with Session(engine) as session, session.begin():
        session.execute(delete(AuthSessionModel))
        session.execute(delete(TrainingRecordModel))
        session.execute(delete(TrainingItemModel))
        session.execute(delete(CoachHintModel))
        session.execute(delete(ReviewExplanationModel))
        session.execute(delete(MoveReviewModel))
        session.execute(delete(GameReviewModel))
        session.execute(delete(AiAnalysisModel))
        session.execute(delete(RemoteUndoRequestModel))
        session.execute(delete(GameUndoEventModel))
        session.execute(delete(GameTerminalEventModel))
        session.execute(delete(GameMoveModel))
        session.execute(delete(RemoteRoomModel))
        session.execute(delete(LocalGameImportModel))
        session.execute(delete(GameModel))
        session.execute(delete(UserModel))
    yield engine
    engine.dispose()


@pytest.fixture
def client(db):
    with TestClient(create_app(Settings(database_url=DB_URL))) as test_client:
        token = test_client.post("/api/v1/auth/device").json()["data"]["token"]
        test_client.headers["Authorization"] = "Bearer " + token
        yield test_client
        test_client.app.state.store.close()


def new_account_headers(client):
    token = client.post("/api/v1/auth/device").json()["data"]["token"]
    return {"Authorization": "Bearer " + token}


def create_game(client, mode="LOCAL", first_player="A", ai_player=None):
    body = {"first_player": first_player, "mode": mode}
    if ai_player is not None:
        body.update({"ai_player": ai_player, "ai_level": "STANDARD"})
    response = client.post("/api/v1/game", json=body)
    assert response.status_code == 200, response.text
    return response.json()["data"]["game_id"]


@pytest.mark.parametrize('level', ['BEGINNER', 'STANDARD', 'ADVANCED'])
def test_ai_level_sql_persists_history_and_restart(client, db, level):
    response = client.post('/api/v1/game', json={'mode':'AI','ai_player':'A','ai_level':level})
    assert response.status_code == 200,response.text
    game = response.json()['data']
    with Session(db) as session:
        assert session.get(GameModel,game['game_id']).ai_level == level
    assert client.get('/api/v1/me/games').json()['data']['items'][0]['aiLevel'] == level
    with TestClient(create_app(Settings(database_url=DB_URL))) as restarted:
        restarted.headers['Authorization'] = client.headers['Authorization']
        assert restarted.get('/api/v1/game/'+game['game_id']).json()['data']['ai_level'] == level
        adapter = restarted.app.state.adapter
        with patch.object(adapter,'ai_move',wraps=adapter.ai_move) as search:
            moved = restarted.post('/api/v1/game/'+game['game_id']+'/ai-move',json={})
            assert moved.status_code == 200,moved.text
            assert search.call_args.args[1:] == {'BEGINNER':(2,500),'STANDARD':(4,1000),'ADVANCED':(6,2000)}[level]
        restarted.app.state.store.close()


def test_personal_accounts_filter_mysql_history_and_survive_restart(client, db):
    first_auth = client.headers["Authorization"]
    first_ids = [create_game(client, mode="AI") for _ in range(3)]
    first_page = client.get("/api/v1/me/games?limit=2").json()["data"]
    assert len(first_page["items"]) == 2 and first_page["nextCursor"]
    next_page = client.get("/api/v1/me/games", params={
        "limit": 2, "cursor": first_page["nextCursor"]}).json()["data"]
    assert {row["gameId"] for row in first_page["items"] + next_page["items"]} == set(first_ids)
    second_token = client.post("/api/v1/auth/device").json()["data"]["token"]
    client.headers["Authorization"] = "Bearer " + second_token
    second_id = create_game(client, mode="AI")
    assert [row["gameId"] for row in client.get("/api/v1/me/games").json()["data"]["items"]] == [second_id]
    assert client.get(f"/api/v1/game/{first_ids[0]}").status_code == 403
    assert client.post(f"/api/v1/game/{first_ids[0]}/move", json={
        "from_node": "P01", "to_node": "P02"}).status_code == 403
    with Session(db) as session:
        first_owner = session.get(GameModel, first_ids[0]).user_id
        second_owner = session.get(GameModel, second_id).user_id
        assert first_owner != second_owner and first_owner and second_owner
    client.headers["Authorization"] = first_auth
    with TestClient(create_app(Settings(database_url=DB_URL))) as restarted:
        restarted.headers["Authorization"] = first_auth
        assert restarted.get("/api/v1/me/profile").json()["data"]["games"] == 3
        assert restarted.get(f"/api/v1/game/{first_ids[0]}").status_code == 200
        restarted.app.state.store.close()


def test_remote_room_persists_two_seats_and_idempotent_turn(client, db):
    host_response = client.post("/api/v1/remote/rooms", json={
        "device_id": "mysql-host-device", "public": False})
    assert host_response.status_code == 200, host_response.text
    host = host_response.json()["data"]
    assert host["version"] == host["ply_count"] == 0
    game_id = host["game_id"]
    guest_headers = new_account_headers(client)
    guest_response = client.post("/api/v1/remote/join", headers=guest_headers, json={
        "invite_code": host["invite_code"], "device_id": "mysql-guest-device"})
    assert guest_response.status_code == 200, guest_response.text
    guest = guest_response.json()["data"]
    assert guest["game_id"] == game_id and guest["seat"] == "B"
    with Session(db) as session:
        room = session.get(RemoteRoomModel, game_id)
        assert room.host_token_hash != host["token"]
        assert room.guest_token_hash != guest["token"]
        assert room.status == "PLAYING"
    body = {"from_node": "P01", "to_node": "P02", "expected_version": 0,
            "client_request_id": "mysql-request-0001"}
    headers = {"X-Room-Token": host["token"]}
    path = f"/api/v1/remote/rooms/{game_id}/move"
    moved = client.post(path, json=body, headers=headers)
    assert moved.status_code == 200, moved.text
    assert moved.json()["data"]["version"] == moved.json()["data"]["ply_count"] == 1
    assert client.post(path, json=body, headers=headers).json()["data"] == moved.json()["data"]
    row, moves = game_and_moves(db, game_id)
    assert row.mode == "REMOTE" and row.version == row.ply_count == 1 and len(moves) == 1
    assert moves[0].client_request_id == "mysql-request-0001"
    assert moves[0].turn_number == moves[0].created_revision == 1
    assert moves[0].reverted_revision is None
    with TestClient(create_app(Settings(database_url=DB_URL))) as restarted:
        restarted.headers["Authorization"] = guest_headers["Authorization"]
        fetched = restarted.get(f"/api/v1/remote/rooms/{game_id}",
                                headers={**guest_headers, "X-Room-Token": guest["token"]})
        assert fetched.status_code == 200, fetched.text
        assert fetched.json()["data"]["seat"] == "B"
        assert fetched.json()["data"]["version"] == fetched.json()["data"]["ply_count"] == 1
        restarted.app.state.store.close()


def test_simultaneous_public_match_pairs_two_devices(client, db):
    barrier = Barrier(2)

    def match(device_id):
        headers = new_account_headers(client)
        barrier.wait()
        response = client.post("/api/v1/remote/match", headers=headers, json={"device_id": device_id})
        assert response.status_code == 200, response.text
        return response.json()["data"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(match, f"match-device-{number}") for number in (1, 2)]
        rooms = [future.result() for future in futures]
    assert rooms[0]["game_id"] == rooms[1]["game_id"]
    assert {room["seat"] for room in rooms} == {"A", "B"}


def seed_position(client, db, pieces, reserve_a=4, mode="LOCAL", ai_player=None):
    """Seed an isolated starting position; every recorded transition still comes from Engine."""
    game_id = create_game(client, mode=mode, ai_player=ai_player)
    with Session(db) as session, session.begin():
        row = session.get(GameModel, game_id)
        state = GameState.model_validate(row.current_state)
        occupancy = {node: None for node in state.board.occupancy}
        occupancy.update(pieces)
        players = state.players.copy()
        players["A"] = players["A"].model_copy(update={"reserve_count": reserve_a})
        fixture = state.model_copy(update={"board": BoardState(occupancy=occupancy), "players": players})
        row.initial_state = fixture.model_dump()
        row.current_state = fixture.model_dump()
    return game_id


def game_and_moves(db, game_id):
    with Session(db) as session:
        row = session.get(GameModel, game_id)
        moves = session.scalars(select(GameMoveModel).where(GameMoveModel.game_id == game_id)
                                .order_by(GameMoveModel.turn_number)).all()
        session.expunge_all()
        return row, moves


def test_analysis_persists_versioned_result_without_changing_game_or_moves(client, db):
    game_id = create_game(client, mode="AI", ai_player="B")
    before, before_moves = game_and_moves(db, game_id)
    response = client.post("/api/v1/ai/analyze", json={"game_id": game_id})
    assert response.status_code == 200, response.text
    analysis = response.json()["data"]
    after, after_moves = game_and_moves(db, game_id)
    assert after.current_state == before.current_state and after.version == before.version == 0
    assert before_moves == after_moves == []
    with Session(db) as session:
        rows = session.execute(text("SELECT game_version, analyzed_player, best_move, "
                                    "best_score, score_perspective, candidate_moves, "
                                    "search_depth, nodes_searched, tt_hits, timed_out "
                                    "FROM ai_analysis WHERE game_id = :id"), {"id": game_id}).all()
    assert len(rows) == 1
    assert rows[0].game_version == 0
    assert rows[0].analyzed_player == rows[0].score_perspective == "A"
    assert rows[0].best_score == analysis["bestScore"]
    assert len(analysis["candidateMoves"]) >= 2
    again = client.post("/api/v1/ai/analyze", json={"game_id": game_id})
    assert again.status_code == 200
    with Session(db) as session:
        count = session.scalar(text("SELECT COUNT(*) FROM ai_analysis WHERE game_id = :id"),
                               {"id": game_id})
    assert count == 2


def test_analysis_detects_game_change_during_search_and_does_not_save_stale_result(client, db):
    game_id = create_game(client)
    adapter = client.app.state.adapter
    original = adapter.analyze_position

    async def moving_analysis(state, max_depth, time_limit_ms, candidate_limit):
        result = await original(state, max_depth, time_limit_ms, candidate_limit)
        turn = await adapter.execute_turn(state, Move(from_node="P01", to_node="P02"))
        await client.app.state.store.commit_turn(game_id, 0, turn, "HUMAN")
        return result

    with patch.object(adapter, "analyze_position", side_effect=moving_analysis):
        response = client.post("/api/v1/ai/analyze", json={"game_id": game_id})
    assert response.status_code == 409 and response.json()["code"] == "GAME_STATE_CONFLICT"
    row, moves = game_and_moves(db, game_id)
    assert row.version == 1 and len(moves) == 1
    with Session(db) as session:
        count = session.scalar(text("SELECT COUNT(*) FROM ai_analysis WHERE game_id = :id"),
                               {"id": game_id})
    assert count == 0


def test_create_get_and_json_roundtrip(client, db):
    game_id = create_game(client)
    row, moves = game_and_moves(db, game_id)
    response = client.get(f"/api/v1/game/{game_id}").json()["data"]
    state = response["state"]
    assert response["version"] == response["ply_count"] == 0
    assert row.initial_state == row.current_state == state
    assert row.version == row.ply_count == 0 and moves == []
    assert row.user_id is not None and row.state_schema_version == 1
    assert row.finished_at is None and row.duration_ms is None
    assert client.get(f"/api/v1/game/{game_id}/legal-moves").json()["data"]["moves"]
    assert client.get("/api/v1/game/missing").status_code == 404


def test_move_invalid_move_replay_and_restart_continue(client, db):
    game_id = create_game(client)
    invalid = client.post(f"/api/v1/game/{game_id}/move", json={"from_node": "P01", "to_node": "P06"})
    assert invalid.status_code == 400
    row, moves = game_and_moves(db, game_id)
    assert row.version == 0 and moves == []
    first = client.post(f"/api/v1/game/{game_id}/move", json={"from_node": "P01", "to_node": "P02"})
    assert first.status_code == 200, first.text
    row, moves = game_and_moves(db, game_id)
    assert row.version == row.ply_count == 1 and len(moves) == 1
    assert moves[0].state_before == row.initial_state
    assert moves[0].state_after == row.current_state
    assert moves[0].turn_result["state"] == row.current_state
    assert moves[0].player == "A" and moves[0].actor_type == "HUMAN"
    assert moves[0].turn_number == moves[0].created_revision == 1
    assert moves[0].reverted_revision is None and row.current_player == "B"
    assert client.portal.call(client.app.state.service.replay_game, game_id)[-1].model_dump() == row.current_state

    with TestClient(create_app(Settings(database_url=DB_URL))) as restarted:
        restarted.headers["Authorization"] = client.headers["Authorization"]
        assert restarted.get(f"/api/v1/game/{game_id}").json()["data"]["state"] == row.current_state
        legal = restarted.get(f"/api/v1/game/{game_id}/legal-moves").json()["data"]["moves"]
        assert legal
        next_move = legal[0]
        continued = restarted.post(f"/api/v1/game/{game_id}/move",
                                   json={"from_node": next_move["from"], "to_node": next_move["to"]})
        assert continued.status_code == 200, continued.text
        assert len(restarted.portal.call(restarted.app.state.service.replay_game, game_id)) == 3
        restarted.app.state.store.close()
    row, moves = game_and_moves(db, game_id)
    assert row.version == row.ply_count == 2
    assert [move.turn_number for move in moves] == [1, 2]
    assert [move.created_revision for move in moves] == [1, 2]
    assert moves[0].state_after == moves[1].state_before
    assert moves[-1].state_after == row.current_state


def test_ai_move_persists_real_search_result(client, db):
    game_id = create_game(client, mode="AI", ai_player="A")
    response = client.post(f"/api/v1/game/{game_id}/ai-move", json={})
    assert response.status_code == 200, response.text
    search = response.json()["data"]["search"]
    row, moves = game_and_moves(db, game_id)
    assert row.version == 1 and len(moves) == 1
    assert moves[0].actor_type == "AI"
    assert {key: value for key, value in moves[0].ai_search_result.items()
            if key != "thinkingTimeMs"} == {key: value for key, value in search.items()
                                            if key != "thinkingTimeMs"}
    assert moves[0].ai_search_result["thinkingTimeMs"] == pytest.approx(search["thinkingTimeMs"])
    assert moves[0].ai_search_result["algorithm"] == "ITERATIVE_DEEPENING_ALPHA_BETA"
    assert row.mode == "AI" and row.ai_player == "A" and row.ai_level == "STANDARD"
    assert search["bestMove"] == {"from": moves[0].from_node, "to": moves[0].to_node}


def test_two_human_ai_rounds_persist_contiguous_moves_and_resume(client, db):
    game_id = create_game(client, mode="AI", ai_player="B")
    for _round in range(2):
        human_legal = client.get(f"/api/v1/game/{game_id}/legal-moves").json()["data"]["moves"]
        human = client.post(f"/api/v1/game/{game_id}/move", json={
            "from_node": human_legal[0]["from"], "to_node": human_legal[0]["to"]})
        assert human.status_code == 200, human.text
        ai_legal = client.get(f"/api/v1/game/{game_id}/legal-moves").json()["data"]["moves"]
        ai = client.post(f"/api/v1/game/{game_id}/ai-move", json={})
        assert ai.status_code == 200, ai.text
        assert ai.json()["data"]["search"]["bestMove"] in ai_legal
        assert ai.json()["data"]["search"]["scorePerspective"] == "B"
    row, moves = game_and_moves(db, game_id)
    assert row.mode == "AI" and row.ai_player == "B" and row.ai_level == "STANDARD"
    assert row.current_player == "A" and row.version == 4
    assert [move.turn_number for move in moves] == [1, 2, 3, 4]
    assert [move.actor_type for move in moves] == ["HUMAN", "AI", "HUMAN", "AI"]
    assert all(moves[index].ai_search_result is None for index in (0, 2))
    assert all(moves[index].ai_search_result is not None for index in (1, 3))
    assert all(moves[index].ai_search_result["bestMove"] == {
        "from": moves[index].from_node, "to": moves[index].to_node} for index in (1, 3))
    with Session(db) as session:
        raw_nulls = session.execute(text(
            "SELECT ai_search_result IS NULL FROM game_moves WHERE game_id = :game_id "
            "ORDER BY turn_number"), {"game_id": game_id}).scalars().all()
    assert raw_nulls == [1, 0, 1, 0]
    with TestClient(create_app(Settings(database_url=DB_URL))) as reopened:
        reopened.headers["Authorization"] = client.headers["Authorization"]
        restored = reopened.get(f"/api/v1/game/{game_id}").json()["data"]
        assert restored["human_player"] == "A" and restored["ai_player"] == "B"
        assert restored["state"] == row.current_state
        reopened.app.state.store.close()


def test_ai_capture_terminal_persists_real_search_and_winner(client, db):
    game_id = seed_position(client, db,
                            {"P11": "A", "P12": "B", "P08": "B", "P18": "B", "P19": "A"},
                            mode="AI", ai_player="A")
    before = client.get(f"/api/v1/game/{game_id}").json()["data"]["state"]
    legal = client.get(f"/api/v1/game/{game_id}/legal-moves").json()["data"]["moves"]
    response = client.post(f"/api/v1/game/{game_id}/ai-move", json={})
    assert response.status_code == 200, response.text
    result = response.json()["data"]
    row, moves = game_and_moves(db, game_id)
    assert result["search"]["bestMove"] in legal
    assert result["search"]["scorePerspective"] == "A"
    assert result["turn"]["before_state"] == before
    assert result["turn"]["game_over"] is True
    assert result["turn"]["winner_reason"] == "CAPTURE_ALL"
    assert row.status == "FINISHED" and row.winner == "A"
    assert row.winner_reason == "CAPTURE_ALL" and row.finished_at is not None
    assert moves[0].actor_type == "AI" and moves[0].turn_number == 1
    assert moves[0].ai_search_result["bestMove"] == {
        "from": moves[0].from_node, "to": moves[0].to_node}
    assert moves[0].capture_result["was_applied"] is True
    assert moves[0].reserve_a_after < moves[0].reserve_a_before
    denied = client.post(f"/api/v1/game/{game_id}/ai-move", json={})
    assert denied.status_code == 409 and denied.json()["code"] == "GAME_ALREADY_FINISHED"


@pytest.mark.parametrize("pieces,move,reason", [
    ({"P11": "A", "P12": "B", "P08": "B", "P18": "B", "P19": "A"},
     ("P19", "P13"), "CAPTURE_ALL"),
    ({"P27": "B", "P26": "A", "P28": "A", "P29": "A", "P03": "A", "P21": "A"},
     ("P21", "P22"), "TEMPLE_TRAP"),
    ({"P03": "B", "P02": "A", "P04": "A", "P27": "A", "P08": "A", "P09": "A",
      "P07": "A", "P26": "A", "P28": "A", "P21": "A"},
     ("P21", "P22"), "LONE_PIECE_IMMOBILIZED"),
    ({"P26": "B", "P29": "B", "P27": "A", "P28": "A", "P08": "A", "P05": "A",
      "P10": "A", "P15": "A", "P20": "A", "P25": "A"},
     ("P08", "P03"), "ALL_PIECES_IMMOBILIZED"),
])
def test_terminal_reasons_and_replay(client, db, pieces, move, reason):
    game_id = seed_position(client, db, pieces)
    response = client.post(f"/api/v1/game/{game_id}/move",
                           json={"from_node": move[0], "to_node": move[1]})
    assert response.status_code == 200, response.text
    turn = response.json()["data"]["turn"]
    row, moves = game_and_moves(db, game_id)
    assert row.status == "FINISHED" and row.winner_reason == reason
    assert row.current_state["winner_reason"] == reason
    assert row.finished_at is not None and row.duration_ms >= 0
    assert moves[0].winner_reason == reason and moves[0].capture_result == turn["capture"]
    assert client.portal.call(client.app.state.service.replay_game, game_id)[-1].model_dump() == row.current_state
    assert client.post(f"/api/v1/game/{game_id}/move",
                       json={"from_node": move[1], "to_node": move[0]}).status_code == 409
    if reason == "ALL_PIECES_IMMOBILIZED":
        history = client.get("/api/v1/me/games?status=FINISHED").json()["data"]["items"]
        assert history[0]["gameId"] == game_id
        assert history[0]["winnerReason"] == reason
        replay = client.get(f"/api/v1/game/{game_id}/replay")
        assert replay.status_code == 200, replay.text
        assert replay.json()["data"]["steps"][-1]["state"] == row.current_state
    if reason == "CAPTURE_ALL":
        assert moves[0].capture_result["was_applied"] is True
        assert moves[0].reserve_a_after < moves[0].reserve_a_before


def test_reserve_insufficient_move_is_still_recorded(client, db):
    game_id = seed_position(client, db, {"P11": "A", "P12": "B", "P08": "B", "P18": "B", "P19": "A"}, 0)
    response = client.post(f"/api/v1/game/{game_id}/move", json={"from_node": "P19", "to_node": "P13"})
    assert response.status_code == 200, response.text
    row, moves = game_and_moves(db, game_id)
    assert row.version == 1 and len(moves) == 1
    assert moves[0].capture_result["failure_reason"] == "INSUFFICIENT_RESERVE"
    assert moves[0].capture_result["was_applied"] is False
    assert moves[0].reserve_a_before == moves[0].reserve_a_after == 0
    assert moves[0].state_after == row.current_state


def test_three_turn_replay_contains_normal_moves_capture_reserve_and_terminal(client, db):
    game_id = seed_position(client, db, {"P11": "A", "P12": "B", "P08": "B", "P18": "B", "P19": "A"})
    for source, target in [("P11", "P01"), ("P12", "P07"), ("P19", "P13")]:
        response = client.post(f"/api/v1/game/{game_id}/move",
                               json={"from_node": source, "to_node": target})
        assert response.status_code == 200, response.text
    row, moves = game_and_moves(db, game_id)
    assert [move.turn_number for move in moves] == [1, 2, 3]
    assert [move.player for move in moves] == ["A", "B", "A"]
    assert not moves[0].capture_result["was_applied"]
    assert not moves[1].capture_result["was_applied"]
    assert moves[2].capture_result["was_applied"]
    assert moves[2].reserve_a_after < moves[2].reserve_a_before
    assert row.status == "FINISHED" and row.winner_reason == "CAPTURE_ALL"
    frames = client.portal.call(client.app.state.service.replay_game, game_id)
    assert len(frames) == 4
    assert frames[-1].model_dump() == row.current_state
    assert all(moves[i].state_after == moves[i + 1].state_before for i in range(2))


def test_stale_version_conflict_and_atomic_rollback(client, db):
    game_id = create_game(client)
    original = client.get(f"/api/v1/game/{game_id}").json()["data"]["state"]
    real_create_move = MoveRepository.create_move

    def fail_after_insert(repository, *args):
        real_create_move(repository, *args)
        repository.session.flush()  # INSERT has reached MySQL inside the transaction.
        raise RuntimeError("failure after insert")

    with patch.object(MoveRepository, "create_move", fail_after_insert):
        with pytest.raises(RuntimeError, match="failure after insert"):
            client.app.state.store._commit_turn(
                game_id, 0,
                _real_turn(client, game_id), "HUMAN", None,
            )
    row, moves = game_and_moves(db, game_id)
    assert row.version == 0 and row.current_state == original and moves == []

    turn = _real_turn(client, game_id)
    store1 = MySQLGameStore(DB_URL)
    store2 = MySQLGameStore(DB_URL)
    try:
        store1._commit_turn(game_id, 0, turn, "HUMAN", None)
        with pytest.raises(ApiError) as error:
            store2._commit_turn(game_id, 0, turn, "HUMAN", None)
        assert error.value.code == "GAME_STATE_CONFLICT"
    finally:
        store1.close()
        store2.close()
    row, moves = game_and_moves(db, game_id)
    assert row.version == 1 and len(moves) == 1


def test_mysql_local_undo_is_atomic_idempotent_and_persists_tombstones(client, db):
    game_id = create_game(client)
    moved = client.post(f"/api/v1/game/{game_id}/move", json={
        "from_node": "P01", "to_node": "P02",
    })
    assert moved.status_code == 200, moved.text
    body = {"expected_version": 1, "client_request_id": "mysql-undo-local-0001"}
    first = client.post(f"/api/v1/game/{game_id}/undo", json=body)
    assert first.status_code == 200, first.text
    assert first.json()["data"]["version"] == 2
    assert first.json()["data"]["ply_count"] == 0
    assert first.json()["data"]["reverted_turns"] == 1
    assert client.post(f"/api/v1/game/{game_id}/undo", json=body).json() == first.json()
    reused = client.post(f"/api/v1/game/{game_id}/resign", json=body)
    assert reused.status_code == 409
    assert reused.json()["code"] == "OPERATION_REQUEST_CONFLICT"
    with Session(db) as session:
        game = session.get(GameModel, game_id)
        moves = session.scalars(select(GameMoveModel).where(
            GameMoveModel.game_id == game_id)).all()
        events = session.scalars(select(GameUndoEventModel).where(
            GameUndoEventModel.game_id == game_id)).all()
    assert game.version == 2 and game.ply_count == 0
    assert len(moves) == 1 and moves[0].reverted_revision == 2
    assert len(events) == 1 and events[0].reverted_count == 1


def test_mysql_ai_undo_reverts_the_human_anchor_and_ai_reply(client, db):
    game_id = create_game(client, mode="AI", ai_player="B")
    assert client.post(f"/api/v1/game/{game_id}/move", json={
        "from_node": "P01", "to_node": "P02",
    }).status_code == 200
    ai = client.post(f"/api/v1/game/{game_id}/ai-move", json={})
    assert ai.status_code == 200, ai.text
    undone = client.post(f"/api/v1/game/{game_id}/undo", json={
        "expected_version": 2, "client_request_id": "mysql-ai-undo-0001",
    })
    assert undone.status_code == 200, undone.text
    assert undone.json()["data"]["version"] == 3
    assert undone.json()["data"]["ply_count"] == 0
    assert undone.json()["data"]["reverted_turns"] == 2
    with Session(db) as session:
        moves = session.scalars(select(GameMoveModel).where(
            GameMoveModel.game_id == game_id).order_by(GameMoveModel.turn_number)).all()
        event = session.scalar(select(GameUndoEventModel).where(
            GameUndoEventModel.game_id == game_id))
    assert [move.reverted_revision for move in moves] == [3, 3]
    assert event.requester == "A" and event.anchor_turn == 1


def test_mysql_undo_event_failure_rolls_back_state_and_move_marker(client, db):
    game_id = create_game(client)
    assert client.post(f"/api/v1/game/{game_id}/move", json={
        "from_node": "P01", "to_node": "P02",
    }).status_code == 200
    real_flush = Session.flush

    def fail_event_flush(session, *args, **kwargs):
        if any(isinstance(item, GameUndoEventModel) for item in session.new):
            real_flush(session, *args, **kwargs)
            raise RuntimeError("failure after undo event insert")
        return real_flush(session, *args, **kwargs)

    with patch.object(Session, "flush", fail_event_flush):
        with pytest.raises(RuntimeError, match="failure after undo event insert"):
            client.app.state.store._commit_undo(
                game_id,
                GameOperationRequest(expected_version=1,
                                     client_request_id="mysql-undo-rollback-0001"),
            )
    row, moves = game_and_moves(db, game_id)
    assert row.version == 1 and row.ply_count == 1
    assert len(moves) == 1 and moves[0].reverted_revision is None
    with Session(db) as session:
        assert session.scalar(select(GameUndoEventModel).where(
            GameUndoEventModel.game_id == game_id)) is None


def test_mysql_remote_pending_undo_is_rechecked_inside_move_transaction(client, db):
    host = client.post("/api/v1/remote/rooms", json={
        "device_id": "mysql-pending-host", "public": False,
    }).json()["data"]
    guest_headers = new_account_headers(client)
    guest = client.post("/api/v1/remote/join", headers=guest_headers, json={
        "invite_code": host["invite_code"], "device_id": "mysql-pending-guest",
    }).json()["data"]
    game_id = host["game_id"]
    first = client.post(f"/api/v1/remote/rooms/{game_id}/move",
                        headers={"X-Room-Token": host["token"]}, json={
        "from_node": "P01", "to_node": "P02", "expected_version": 0,
        "client_request_id": "mysql-pending-anchor-0001",
    })
    assert first.status_code == 200, first.text
    created = client.post(f"/api/v1/remote/rooms/{game_id}/undo-requests",
                          headers={"X-Room-Token": host["token"]}, json={
        "expected_version": 1, "client_request_id": "mysql-pending-create-0001",
    })
    assert created.status_code == 200, created.text
    stale_preflight_state = GameState.model_validate(first.json()["data"]["turn"]["state"])
    turn = client.portal.call(client.app.state.adapter.execute_turn, stale_preflight_state,
                              Move(from_node="P05", to_node="P04"))
    with pytest.raises(ApiError) as error:
        client.app.state.store._commit_remote_turn(
            game_id, token_hash(guest["token"]), 1,
            "mysql-racing-move-0001", turn,
        )
    assert error.value.code == "REMOTE_UNDO_PENDING"
    row, moves = game_and_moves(db, game_id)
    assert row.version == row.ply_count == 1
    assert len(moves) == 1


def test_mysql_reverted_remote_request_is_a_permanent_tombstone(client, db):
    host = client.post("/api/v1/remote/rooms", json={
        "device_id": "mysql-tombstone-host", "public": False,
    }).json()["data"]
    guest_headers = new_account_headers(client)
    guest = client.post("/api/v1/remote/join", headers=guest_headers, json={
        "invite_code": host["invite_code"], "device_id": "mysql-tombstone-guest",
    }).json()["data"]
    game_id = host["game_id"]
    move_body = {"from_node": "P01", "to_node": "P02", "expected_version": 0,
                 "client_request_id": "mysql-tombstone-move-0001"}
    path = f"/api/v1/remote/rooms/{game_id}"
    assert client.post(path + "/move", headers={"X-Room-Token": host["token"]},
                       json=move_body).status_code == 200
    created = client.post(path + "/undo-requests",
                          headers={"X-Room-Token": host["token"]}, json={
        "expected_version": 1, "client_request_id": "mysql-tombstone-create-0001",
    }).json()["data"]["pending_undo"]
    accepted = client.post(path + f"/undo-requests/{created['id']}/accept",
                           headers={**guest_headers, "X-Room-Token": guest["token"]}, json={
        "expected_version": 1, "client_request_id": "mysql-tombstone-accept-0001",
    })
    assert accepted.status_code == 200, accepted.text
    retried = client.post(path + "/move", headers={"X-Room-Token": host["token"]},
                          json=move_body)
    assert retried.status_code == 409
    assert retried.json()["code"] == "REMOTE_REQUEST_CONFLICT"


def test_mysql_remote_operation_retries_return_identical_revert_counts(client, db):
    def playing_room(prefix):
        host = client.post("/api/v1/remote/rooms", json={
            "device_id": f"{prefix}-host-device", "public": False,
        }).json()["data"]
        guest_headers = new_account_headers(client)
        guest = client.post("/api/v1/remote/join", headers=guest_headers, json={
            "invite_code": host["invite_code"],
            "device_id": f"{prefix}-guest-device",
        }).json()["data"]
        return host, guest, guest_headers

    host, guest, guest_headers = playing_room("mysql-idem-accept")
    game_id = host["game_id"]
    path = f"/api/v1/remote/rooms/{game_id}/move"
    assert client.post(path, headers={"X-Room-Token": host["token"]}, json={
        "from_node": "P01", "to_node": "P02", "expected_version": 0,
        "client_request_id": "mysql-idem-accept-move-a",
    }).status_code == 200
    assert client.post(path, headers={**guest_headers, "X-Room-Token": guest["token"]}, json={
        "from_node": "P05", "to_node": "P04", "expected_version": 1,
        "client_request_id": "mysql-idem-accept-move-b",
    }).status_code == 200
    created = client.portal.call(
        client.app.state.store.create_remote_undo, game_id,
        token_hash(host["token"]),
        RemoteOperationRequest(expected_version=2,
                               client_request_id="mysql-idem-accept-create"),
    )
    resolve = RemoteOperationRequest(
        expected_version=2, client_request_id="mysql-idem-accept-resolve")
    first = client.portal.call(
        client.app.state.store.resolve_remote_undo, game_id, created.id,
        token_hash(guest["token"]), resolve, "ACCEPT")
    retry = client.portal.call(
        client.app.state.store.resolve_remote_undo, game_id, created.id,
        token_hash(guest["token"]), resolve, "ACCEPT")
    assert first == retry
    assert first.revert_count == 2

    host, guest, guest_headers = playing_room("mysql-idem-decline")
    game_id = host["game_id"]
    assert client.post(f"/api/v1/remote/rooms/{game_id}/move",
                       headers={"X-Room-Token": host["token"]}, json={
        "from_node": "P01", "to_node": "P02", "expected_version": 0,
        "client_request_id": "mysql-idem-decline-move-a",
    }).status_code == 200
    created = client.portal.call(
        client.app.state.store.create_remote_undo, game_id,
        token_hash(host["token"]),
        RemoteOperationRequest(expected_version=1,
                               client_request_id="mysql-idem-decline-create"),
    )
    resolve = RemoteOperationRequest(
        expected_version=1, client_request_id="mysql-idem-decline-resolve")
    first = client.portal.call(
        client.app.state.store.resolve_remote_undo, game_id, created.id,
        token_hash(guest["token"]), resolve, "DECLINE")
    retry = client.portal.call(
        client.app.state.store.resolve_remote_undo, game_id, created.id,
        token_hash(guest["token"]), resolve, "DECLINE")
    assert first == retry
    assert first.revert_count == 1

    host, guest, guest_headers = playing_room("mysql-idem-stale")
    game_id = host["game_id"]
    assert client.post(f"/api/v1/remote/rooms/{game_id}/move",
                       headers={"X-Room-Token": host["token"]}, json={
        "from_node": "P01", "to_node": "P02", "expected_version": 0,
        "client_request_id": "mysql-idem-stale-move-a",
    }).status_code == 200
    created = client.portal.call(
        client.app.state.store.create_remote_undo, game_id,
        token_hash(host["token"]),
        RemoteOperationRequest(expected_version=1,
                               client_request_id="mysql-idem-stale-create"),
    )
    with Session(db) as session, session.begin():
        session.get(GameModel, game_id).version = 2
    resolve = RemoteOperationRequest(
        expected_version=1, client_request_id="mysql-idem-stale-resolve")
    first = client.app.state.store._resolve_remote_undo(
        game_id, created.id, token_hash(guest["token"]), resolve, "ACCEPT")
    retry = client.app.state.store._resolve_remote_undo(
        game_id, created.id, token_hash(guest["token"]), resolve, "ACCEPT")
    assert first == retry
    assert first[0].status == "STALE" and first[0].revert_count == 1
    assert first[1] is True


def test_mysql_undo_and_resign_race_has_one_atomic_winner(client, db):
    game_id = create_game(client)
    assert client.post(f"/api/v1/game/{game_id}/move", json={
        "from_node": "P01", "to_node": "P02",
    }).status_code == 200
    barrier = Barrier(2)

    def operate(operation, request_id):
        barrier.wait()
        return client.post(f"/api/v1/game/{game_id}/{operation}", json={
            "expected_version": 1, "client_request_id": request_id,
        })

    with ThreadPoolExecutor(max_workers=2) as pool:
        undo = pool.submit(operate, "undo", "mysql-race-undo-0001")
        resign = pool.submit(operate, "resign", "mysql-race-resign-0001")
        responses = [undo.result(), resign.result()]
    assert sorted(response.status_code for response in responses) == [200, 409]
    with Session(db) as session:
        game = session.get(GameModel, game_id)
        undo_events = session.scalars(select(GameUndoEventModel).where(
            GameUndoEventModel.game_id == game_id)).all()
        terminal_events = session.scalars(select(GameTerminalEventModel).where(
            GameTerminalEventModel.game_id == game_id)).all()
        move = session.scalar(select(GameMoveModel).where(
            GameMoveModel.game_id == game_id))
    assert game.version == 2
    assert len(undo_events) + len(terminal_events) == 1
    if undo_events:
        assert game.status == "PLAYING" and game.ply_count == 0
        assert move.reverted_revision == 2
    else:
        assert game.status == "FINISHED" and game.winner_reason == "RESIGN"
        assert game.ply_count == 1 and move.reverted_revision is None


def test_mysql_remote_resign_event_failure_rolls_back_game_and_pending_request(client, db):
    host = client.post("/api/v1/remote/rooms", json={
        "device_id": "mysql-resign-host", "public": False,
    }).json()["data"]
    guest_headers = new_account_headers(client)
    guest = client.post("/api/v1/remote/join", headers=guest_headers, json={
        "invite_code": host["invite_code"], "device_id": "mysql-resign-guest",
    }).json()["data"]
    game_id = host["game_id"]
    assert client.post(f"/api/v1/remote/rooms/{game_id}/move",
                       headers={"X-Room-Token": host["token"]}, json={
        "from_node": "P01", "to_node": "P02", "expected_version": 0,
        "client_request_id": "mysql-resign-anchor-0001",
    }).status_code == 200
    assert client.post(f"/api/v1/remote/rooms/{game_id}/undo-requests",
                       headers={"X-Room-Token": host["token"]}, json={
        "expected_version": 1, "client_request_id": "mysql-resign-pending-0001",
    }).status_code == 200
    real_flush = Session.flush

    def fail_terminal_flush(session, *args, **kwargs):
        if any(isinstance(item, GameTerminalEventModel) for item in session.new):
            real_flush(session, *args, **kwargs)
            raise RuntimeError("failure after terminal event insert")
        return real_flush(session, *args, **kwargs)

    with patch.object(Session, "flush", fail_terminal_flush):
        with pytest.raises(RuntimeError, match="failure after terminal event insert"):
            client.app.state.store._commit_remote_resign(
                game_id, token_hash(guest["token"]),
                RemoteOperationRequest(expected_version=1,
                                       client_request_id="mysql-resign-rollback-0001"),
            )
    with Session(db) as session:
        game = session.get(GameModel, game_id)
        pending = session.scalar(select(RemoteUndoRequestModel).where(
            RemoteUndoRequestModel.game_id == game_id))
        terminal = session.scalar(select(GameTerminalEventModel).where(
            GameTerminalEventModel.game_id == game_id))
    assert game.status == "PLAYING" and game.version == 1 and game.ply_count == 1
    assert pending.status == "PENDING"
    assert terminal is None


def _real_turn(client, game_id):
    state = GameState.model_validate(client.get(f"/api/v1/game/{game_id}").json()["data"]["state"])
    from backend.app.schemas.game import Move
    return client.portal.call(client.app.state.adapter.execute_turn, state,
                              Move(from_node="P01", to_node="P02"))


def test_turn_numbers_can_branch_but_created_revisions_stay_unique(client, db):
    game_id = create_game(client)
    response = client.post(f"/api/v1/game/{game_id}/move", json={"from_node": "P01", "to_node": "P02"})
    assert response.status_code == 200
    with Session(db) as session, session.begin():
        original = session.scalar(select(GameMoveModel).where(GameMoveModel.game_id == game_id))
        branched = {column.name: getattr(original, column.name)
                    for column in GameMoveModel.__table__.columns if column.name != "id"}
        branched["created_revision"] = 2
        session.add(GameMoveModel(**branched))
        session.flush()
    assert len(game_and_moves(db, game_id)[1]) == 2

    with pytest.raises(IntegrityError):
        with Session(db) as session, session.begin():
            original = session.scalar(select(GameMoveModel).where(GameMoveModel.game_id == game_id))
            copy = {column.name: getattr(original, column.name) for column in GameMoveModel.__table__.columns
                    if column.name != "id"}
            session.add(GameMoveModel(**copy))
            session.flush()
    assert len(game_and_moves(db, game_id)[1]) == 2


def test_mysql_replay_and_history_use_only_active_plies(client, db):
    game_id = create_game(client, mode="AI")
    response = client.post(f"/api/v1/game/{game_id}/move", json={
        "from_node": "P01", "to_node": "P02",
    })
    assert response.status_code == 200, response.text
    with Session(db) as session, session.begin():
        game = session.get(GameModel, game_id)
        original = session.scalar(select(GameMoveModel).where(
            GameMoveModel.game_id == game_id))
        original.reverted_revision = 3
        branch = {column.name: getattr(original, column.name)
                  for column in GameMoveModel.__table__.columns if column.name != "id"}
        branch.update({
            "created_revision": 4,
            "reverted_revision": None,
            "client_request_id": "mysql-active-branch-0001",
        })
        session.add(GameMoveModel(**branch))
        game.version = 4
        game.ply_count = 1

    moves = client.portal.call(client.app.state.store.list_moves, game_id)
    frames = client.portal.call(client.app.state.service.replay_game, game_id)
    snapshot = client.get(f"/api/v1/game/{game_id}").json()["data"]
    history = client.get("/api/v1/me/games").json()["data"]["items"]

    assert [(move.turn_number, move.created_revision, move.reverted_revision,
             move.client_request_id) for move in moves] == [
        (1, 4, None, "mysql-active-branch-0001"),
    ]
    assert len(frames) == 2 and frames[-1].model_dump(mode="json") == snapshot["state"]
    assert snapshot["version"] == 4 and snapshot["ply_count"] == 1
    assert next(item for item in history if item["gameId"] == game_id)["turns"] == 1


def test_mysql_zero_move_resignation_replay_requires_terminal_event(client, db):
    game_id = create_game(client)
    with Session(db) as session, session.begin():
        game = session.get(GameModel, game_id)
        before = GameState.model_validate(game.current_state)
        after = before.model_copy(update={
            "game_status": "FINISHED", "winner": "B", "winner_reason": "RESIGN",
        })
        game.current_state = after.model_dump(mode="json")
        game.status = "FINISHED"
        game.winner = "B"
        game.winner_reason = "RESIGN"
        game.version = 1
        game.ply_count = 0
        session.add(GameTerminalEventModel(
            game_id=game_id, client_request_id="mysql-resign-zero-0001",
            revision=1, event_type="RESIGN", actor="A", winner="B",
            state_before=before.model_dump(mode="json"),
            state_after=after.model_dump(mode="json"), created_at=utc_now(),
        ))

    frames = client.portal.call(client.app.state.service.replay_game, game_id)
    review = client.post(f"/api/v1/game/{game_id}/review", json={})

    assert [frame.model_dump(mode="json") for frame in frames] == [
        before.model_dump(mode="json"), after.model_dump(mode="json"),
    ]
    assert review.status_code == 200, review.text
    assert review.json()["data"]["winnerReason"] == "RESIGN"
    assert review.json()["data"]["moveReviews"] == []

def test_replay_rejects_disagreeing_snapshots(client, db):
    game_id = create_game(client)
    response = client.post(f"/api/v1/game/{game_id}/move", json={"from_node": "P01", "to_node": "P02"})
    assert response.status_code == 200
    with Session(db) as session, session.begin():
        row = session.scalar(select(GameMoveModel).where(GameMoveModel.game_id == game_id))
        corrupt = dict(row.state_after)
        corrupt["current_player"] = "A"
        row.state_after = corrupt
    with pytest.raises(ApiError) as error:
        client.portal.call(client.app.state.service.replay_game, game_id)
    assert error.value.code == "REPLAY_INTEGRITY_ERROR"


def test_review_persists_atomic_ordered_rows_and_reuses_same_config(client, db):
    unfinished_id = create_game(client)
    unfinished = client.post(f"/api/v1/game/{unfinished_id}/review", json={})
    assert unfinished.status_code == 409 and unfinished.json()["code"] == "GAME_NOT_FINISHED"
    with Session(db) as session:
        assert session.scalar(select(GameReviewModel).where(
            GameReviewModel.game_id == unfinished_id)) is None
    game_id = seed_position(client, db, {"P11": "A", "P12": "B", "P08": "B",
                                         "P18": "B", "P19": "A"})
    for source, target in [("P11", "P01"), ("P12", "P07"), ("P19", "P13")]:
        moved = client.post(f"/api/v1/game/{game_id}/move",
                            json={"from_node": source, "to_node": target})
        assert moved.status_code == 200, moved.text
    before, moves_before = game_and_moves(db, game_id)
    original = client.app.state.adapter.review_move
    calls = 0

    async def fail_second(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise ApiError("ENGINE_UNAVAILABLE", "offline")
        return await original(*args, **kwargs)

    with patch.object(client.app.state.adapter, "review_move", side_effect=fail_second):
        failed = client.post(f"/api/v1/game/{game_id}/review", json={})
    assert failed.status_code == 503 and failed.json()["code"] == "ENGINE_UNAVAILABLE"
    with Session(db) as session:
        assert session.scalar(select(GameReviewModel).where(GameReviewModel.game_id == game_id)) is None
    original_commit = client.app.state.store.commit_review

    async def invalid_second_fk(review, expected_version, user_id=None, remote_token_hash=None):
        bad_move = review.moveReviews[1].model_copy(update={"gameMoveId": 999999999})
        invalid = review.model_copy(update={"moveReviews": [review.moveReviews[0], bad_move]})
        return await original_commit(invalid, expected_version,
                                     user_id=user_id, remote_token_hash=remote_token_hash)

    with patch.object(client.app.state.store, "commit_review", side_effect=invalid_second_fk):
        rolled_back = client.post(f"/api/v1/game/{game_id}/review", json={})
    assert rolled_back.status_code == 503 and rolled_back.json()["code"] == "DATABASE_UNAVAILABLE"
    with Session(db) as session:
        assert session.scalar(select(GameReviewModel).where(GameReviewModel.game_id == game_id)) is None
        assert session.scalar(select(MoveReviewModel).join(GameReviewModel).where(
            GameReviewModel.game_id == game_id)) is None
    created = client.post(f"/api/v1/game/{game_id}/review", json={})
    assert created.status_code == 200, created.text
    review = created.json()["data"]
    assert [item["turn"] for item in review["moveReviews"]] == [1, 3]
    assert review["reviewConfigVersion"] == 2
    assert review["winnerReason"] == "CAPTURE_ALL"
    assert client.post(f"/api/v1/game/{game_id}/review", json={}).json()["data"] == review
    assert client.get(f"/api/v1/game/{game_id}/review").json()["data"] == review
    after, moves_after = game_and_moves(db, game_id)
    assert after.current_state == before.current_state
    assert [item.id for item in moves_after] == [item.id for item in moves_before]
    with Session(db) as session:
        game_reviews = session.scalars(select(GameReviewModel).where(
            GameReviewModel.game_id == game_id)).all()
        assert len(game_reviews) == 1
        rows = session.scalars(select(MoveReviewModel).where(
            MoveReviewModel.game_review_id == game_reviews[0].id)
            .order_by(MoveReviewModel.turn_number)).all()
        assert [row.game_move_id for row in rows] == [moves_before[0].id, moves_before[2].id]
        assert [row.turn_number for row in rows] == [1, 3]
        assert all(row.score_loss == row.best_score - row.actual_move_score for row in rows)
    with pytest.raises(IntegrityError):
        with Session(db) as session, session.begin():
            original_row = session.scalar(select(GameReviewModel).where(
                GameReviewModel.game_id == game_id))
            duplicate = {column.name: getattr(original_row, column.name)
                         for column in GameReviewModel.__table__.columns if column.name != "id"}
            session.add(GameReviewModel(id="duplicate_review_row", **duplicate))
            session.flush()
    with Session(db) as session:
        assert len(session.scalars(select(GameReviewModel).where(
            GameReviewModel.game_id == game_id)).all()) == 1


def test_explanation_persists_without_changing_game_or_review_facts(client, db):
    game_id = seed_position(client, db, {"P11": "A", "P12": "B", "P08": "B",
                                         "P18": "B", "P19": "A"})
    moved = client.post(f"/api/v1/game/{game_id}/move",
                        json={"from_node": "P19", "to_node": "P13"})
    assert moved.status_code == 200, moved.text
    review_path = f"/api/v1/game/{game_id}/review"
    review = client.post(review_path, json={}).json()["data"]
    before, before_moves = game_and_moves(db, game_id)
    explanation_path = review_path + "/explain"
    first = client.post(explanation_path, json={})
    assert first.status_code == 200, first.text
    data = first.json()["data"]
    assert data["review"] == review
    assert data["explanation"]["gameExplanation"]["fallbackUsed"] is True
    assert client.get(explanation_path).json()["data"] == data
    assert client.post(explanation_path, json={}).json()["data"] == data
    assert client.get(review_path).json()["data"] == review
    after, after_moves = game_and_moves(db, game_id)
    assert after.current_state == before.current_state
    assert after.version == before.version
    assert [item.id for item in after_moves] == [item.id for item in before_moves]
    with Session(db) as session:
        rows = session.scalars(select(ReviewExplanationModel).where(
            ReviewExplanationModel.game_review_id == review["id"])).all()
        assert len(rows) == 1
        assert rows[0].prompt_version == "review_explanation_v1"
        assert rows[0].provider == "fallback" and rows[0].fallback_used is True
        assert rows[0].payload["moveExplanations"][0]["turn"] == 1
        algorithm_row = session.scalar(select(MoveReviewModel).where(
            MoveReviewModel.game_review_id == review["id"]))
        assert algorithm_row.score_loss == review["moveReviews"][0]["scoreLoss"]
        assert algorithm_row.category == review["moveReviews"][0]["category"]
        assert algorithm_row.best_move == review["moveReviews"][0]["bestMove"]
    with pytest.raises(IntegrityError):
        with Session(db) as session, session.begin():
            session.add(ReviewExplanationModel(
                game_review_id=review["id"], prompt_version="review_explanation_v1",
                provider="duplicate", model=None, fallback_used=True,
                payload=data["explanation"], created_at=rows[0].created_at))
            session.flush()


def test_coach_persists_three_levels_and_keeps_game_immutable(client, db):
    game_id = create_game(client, mode="AI", ai_player="B")
    before, before_moves = game_and_moves(db, game_id)
    path = f"/api/v1/game/{game_id}/coach/hint"
    responses = []
    for level in (1, 2, 3):
        response = client.post(path, json={"level": level, "expected_version": 0})
        assert response.status_code == 200, response.text
        responses.append(response.json()["data"])
    assert all(item["fallbackUsed"] for item in responses)
    assert responses[0]["bestMove"] is None and responses[1]["bestMove"] is None
    assert responses[2]["bestMove"] is not None
    assert client.post(path, json={"level": 2, "expected_version": 0}).json()["data"] == responses[1]
    after, after_moves = game_and_moves(db, game_id)
    assert (after.current_state, after.version, after_moves) == (
        before.current_state, before.version, before_moves)
    with Session(db) as session:
        rows = session.scalars(select(CoachHintModel).where(
            CoachHintModel.game_id == game_id).order_by(CoachHintModel.hint_level)).all()
        assert [row.hint_level for row in rows] == [1, 2, 3]
        assert all(row.game_version == 0 and row.prompt_version == "coach_hint_v2"
                   for row in rows)
        assert all(row.fallback_used and row.provider == "fallback" for row in rows)
    with pytest.raises(IntegrityError):
        with Session(db) as session, session.begin():
            first = session.scalar(select(CoachHintModel).where(
                CoachHintModel.game_id == game_id, CoachHintModel.hint_level == 1))
            duplicate = {column.name: getattr(first, column.name)
                         for column in CoachHintModel.__table__.columns if column.name != "id"}
            session.add(CoachHintModel(**duplicate))
            session.flush()


def test_training_real_history_answer_records_and_source_game_unchanged(client, db):
    fixture = [
        ("P01", "P19"), ("P05", "P01"), ("P16", "P18"), ("P01", "P07"),
        ("P18", "P13"), ("P07", "P03"), ("P11", "P17"), ("P10", "P07"),
        ("P06", "P11"), ("P15", "P14"), ("P17", "P22"), ("P14", "P04"),
        ("P19", "P23"), ("P20", "P17"),
    ]
    game_id = create_game(client)
    for source, target in fixture:
        response = client.post(f"/api/v1/game/{game_id}/move",
                               json={"from_node": source, "to_node": target})
        assert response.status_code == 200, response.text
    required = client.post(f"/api/v1/game/{game_id}/training", json={})
    assert required.status_code == 409 and required.json()["code"] == "REVIEW_REQUIRED"
    review = client.post(f"/api/v1/game/{game_id}/review", json={}).json()["data"]
    before, before_moves = game_and_moves(db, game_id)
    generated = client.post(f"/api/v1/game/{game_id}/training", json={})
    assert generated.status_code == 200, generated.text
    public = generated.json()["data"]["items"]
    expected_turns = {move["turn"] for move in review["moveReviews"]
                      if move["player"] == review["reviewedPlayer"]
                      and move["category"] in ("MISTAKE", "BLUNDER")}
    assert expected_turns
    assert len(public) == len(expected_turns) and "bestMove" not in generated.text
    assert {item["sourceTurn"] for item in public} == expected_turns
    assert "bestScore" not in generated.text and "originalMove" not in generated.text
    assert client.post(f"/api/v1/game/{game_id}/training", json={}).json()["data"]["items"] == public
    with Session(db) as session:
        rows = session.scalars(select(TrainingItemModel).where(
            TrainingItemModel.source_game_id == game_id)).all()
        assert len(rows) == len(expected_turns)
        assert {row.source_turn for row in rows} == expected_turns
        for row in rows:
            move = session.get(GameMoveModel, row.source_move_id)
            source = session.get(MoveReviewModel, row.source_move_review_id)
            assert move and source and source.game_move_id == move.id
            assert row.state_snapshot == move.state_before
            assert row.state_schema_version == move.state_schema_version == 1
            assert row.original_move == source.actual_move
            assert row.best_move == source.best_move
            assert row.best_score == source.best_score
            assert row.player == move.player
            assert row.review_config_version == review["reviewConfigVersion"] and row.generation_version == 1
            assert row.scoring_depth == source.search_depth
        chosen = next(row for row in rows if row.source_turn == 1)
        training_id = chosen.id
        scoring_depth = chosen.scoring_depth
        assert scoring_depth >= 1
    best = review["moveReviews"][0]["bestMove"]
    actual = review["moveReviews"][0]["actualMove"]
    path = f"/api/v1/training/{training_id}/answer"
    first_body = {"from_node": best["from"], "to_node": best["to"],
                  "client_attempt_id": "mysql-training-correct-0001"}
    correct = client.post(path, json=first_body)
    assert correct.status_code == 200, correct.text
    assert correct.json()["data"]["result"] == "CORRECT"
    assert correct.json()["data"]["searchDepth"] == scoring_depth
    assert client.post(path, json=first_body).json()["data"] == correct.json()["data"]
    worse = client.post(path, json={"from_node": actual["from"], "to_node": actual["to"],
                                    "client_attempt_id": "mysql-training-worse-0001"})
    assert worse.status_code == 200, worse.text
    assert worse.json()["data"]["result"] == "SUBOPTIMAL"
    assert worse.json()["data"]["scoreLoss"] > 0
    invalid = client.post(path, json={"from_node": "P01", "to_node": "P01",
                                      "client_attempt_id": "mysql-training-invalid-0001"})
    assert invalid.status_code == 400 and invalid.json()["code"] == "INVALID_MOVE"
    with Session(db) as session:
        records = session.scalars(select(TrainingRecordModel).where(
            TrainingRecordModel.training_item_id == training_id)).all()
        assert len(records) == 2
        assert {row.result for row in records} == {"CORRECT", "SUBOPTIMAL"}
        assert all(row.user_id == before.user_id and row.legal for row in records)
        assert all(row.submitted_move and row.search_depth == scoring_depth for row in records)
    own_auth = client.headers["Authorization"]
    second_token = client.post("/api/v1/auth/device").json()["data"]["token"]
    client.headers["Authorization"] = "Bearer " + second_token
    assert client.get("/api/v1/training").json()["data"]["total"] == 0
    assert client.get(f"/api/v1/training/{training_id}").status_code == 403
    assert client.post(path, json={**first_body,
                                   "client_attempt_id": "mysql-other-account-0001"}).status_code == 403
    client.headers["Authorization"] = own_auth
    after, after_moves = game_and_moves(db, game_id)
    assert after.current_state == before.current_state and after.version == before.version
    assert [row.id for row in after_moves] == [row.id for row in before_moves]
    assert client.get(f"/api/v1/game/{game_id}/review").json()["data"] == review


def test_wechat_mysql_login_migrates_records_and_recovers_after_restart(client, db):
    from backend.tests.test_wechat_auth import FakeWechat, login
    from backend.tests.test_training import finished_review
    from backend.app.api.v1.account import _token_hash
    client.app.state.wechat_auth = FakeWechat()
    original = client.headers["Authorization"][7:]
    game_id, review = finished_review(client)
    question = client.post(f"/api/v1/game/{game_id}/training", json={}).json()["data"]["items"][0]
    best = next(move["bestMove"] for move in review["moveReviews"] if move["turn"] == question["sourceTurn"])
    assert client.post(f'/api/v1/training/{question["id"]}/answer', json={
        "from_node": best["from"], "to_node": best["to"], "client_attempt_id": "mysql-wx-answer"}).status_code == 200
    target = login(client).json()["data"]
    migrated = login(client, device_token=original).json()["data"]
    assert migrated["userId"] == target["userId"]
    assert client.get("/api/v1/me/profile").status_code == 401
    with Session(db) as session:
        assert session.get(GameModel, game_id).user_id == target["userId"]
        assert session.scalar(select(TrainingRecordModel.user_id)) == target["userId"]
        assert session.get(AuthSessionModel, _token_hash(migrated["token"])) is not None
    with TestClient(create_app(Settings(database_url=DB_URL))) as restarted:
        restarted.app.state.wechat_auth = FakeWechat()
        restarted.headers["Authorization"] = "Bearer " + migrated["token"]
        assert restarted.get("/api/v1/me/profile").json()["data"]["training"] == 1
        same = login(restarted).json()["data"]
        assert same["userId"] == target["userId"]
        other = login(restarted, "bob").json()["data"]
        restarted.headers["Authorization"] = "Bearer " + other["token"]
        assert restarted.get(f"/api/v1/game/{game_id}").status_code == 403
        restarted.app.state.store.close()


def test_concurrent_first_wechat_logins_create_one_mysql_user(db):
    from datetime import datetime, timedelta, timezone
    barrier = Barrier(2)
    store = MySQLGameStore(DB_URL)
    def sign_in(index):
        barrier.wait()
        return store._login_wechat("wx-app:concurrent-user", str(index) * 64,
            datetime.now(timezone.utc) + timedelta(days=1), None)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            ids = list(pool.map(sign_in, [1, 2]))
        assert ids[0] == ids[1]
        with Session(db) as session:
            assert len(session.scalars(select(UserModel).where(
                UserModel.external_user_id == "wechat:" + hashlib.sha256(b"wx-app:concurrent-user").hexdigest())).all()) == 1
    finally:
        store.close()

def test_mysql_local_import_transaction_retry_case_and_rollback(client,db):
    from backend.tests.test_local_import import payload
    from backend.app.db.models import LocalGameImportModel
    body=payload(resigningPlayer='A')
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses=list(pool.map(lambda _:client.post('/api/v1/game/import-local',json=body),range(4)))
    assert all(r.status_code==200 for r in responses), [r.text for r in responses]
    game=responses[0].json()['data']; assert {r.json()['data']['game_id'] for r in responses}=={game['game_id']}
    assert game['version']==3 and game['ply_count']==2
    upper=client.post('/api/v1/game/import-local',json=payload(clientGameId='LOCAL-score-001'))
    assert upper.status_code==200 and upper.json()['data']['game_id']!=game['game_id']
    assert client.post('/api/v1/game/import-local',json=payload()).status_code==409
    original=MoveRepository.create_move
    def fail_second(self,*args,**kwargs):
        original(self,*args,**kwargs)
        if args[1]==2: raise IntegrityError('injected import insert',None,Exception('rollback'))
    with patch.object(MoveRepository,'create_move',fail_second):
        bad=client.post('/api/v1/game/import-local',json=payload(clientGameId='rollback-import'))
        assert bad.status_code==503, bad.text
    with Session(db) as s:
        assert len(s.scalars(select(GameModel)).all())==2
        assert len(s.scalars(select(LocalGameImportModel)).all())==2
        assert len(s.scalars(select(GameMoveModel)).all())==4
        assert len(s.scalars(select(GameTerminalEventModel)).all())==1
    restarted=MySQLGameStore(DB_URL)
    assert client.portal.call(restarted.get_snapshot,game['game_id']).version==3
    restarted.close()

@pytest.mark.parametrize('conflict',[False,True])
def test_mysql_local_import_merge_conflict_atomic_retired_inflight(client,db,conflict):
    from backend.tests.test_local_import import payload
    from backend.tests.test_wechat_auth import FakeWechat,login
    from backend.app.schemas.game import LocalImportRequest
    client.app.state.wechat_auth=FakeWechat()
    target=login(client,'merge-target').json()['data']
    target_header={'Authorization':'Bearer '+target['token']}
    if conflict:
        target_game=client.post('/api/v1/game/import-local',headers=target_header,json=payload()).json()['data']['game_id']
    source=client.post('/api/v1/auth/device').json()['data']
    source_header={'Authorization':'Bearer '+source['token']}
    game=client.post('/api/v1/game/import-local',headers=source_header,json=payload()).json()['data']['game_id']
    migrated=login(client,'merge-target',device_token=source['token'])
    if conflict:
        assert migrated.status_code==409 and migrated.json()['code']=='LOCAL_IMPORT_ACCOUNT_CONFLICT'
        assert client.get(f'/api/v1/game/{game}',headers=source_header).status_code==200
        with Session(db) as s:
            assert s.get(GameModel,game).user_id==source['userId']
            assert s.get(GameModel,target_game).user_id==target['userId']
            assert s.get(UserModel,source['userId']).external_user_id is not None
    else:
        assert migrated.status_code==200, migrated.text
        assert client.get(f'/api/v1/game/{game}',headers=source_header).status_code==401
        assert client.post('/api/v1/game/import-local',headers=target_header,json=payload()).json()['data']['game_id']==game
        with pytest.raises(ApiError,match='AUTH_INVALID'):
            client.portal.call(client.app.state.service.import_local,LocalImportRequest.model_validate(payload(clientGameId='retired-import')),source['userId'])

def test_mysql_import_exact_owner_scope_and_finished_replay_training(client,db):
    from backend.tests.test_local_import import payload
    from backend.tests.test_training import MOVES
    body=payload(moves=[{'from':a,'to':b} for a,b in MOVES])
    finished=client.post('/api/v1/game/import-local',json=body)
    assert finished.status_code==200,finished.text
    game=finished.json()['data'];assert game['state']['game_status']=='FINISHED'
    assert game['version']==game['ply_count']==len(MOVES)
    assert client.post(f"/api/v1/game/{game['game_id']}/review",json={}).status_code==200
    training=client.post(f"/api/v1/game/{game['game_id']}/training",json={})
    assert training.status_code==200 and training.json()['data']['items']
    other=new_account_headers(client)
    second=client.post('/api/v1/game/import-local',headers=other,json=body)
    assert second.status_code==200 and second.json()['data']['game_id']!=game['game_id']
    assert client.get(f"/api/v1/game/{game['game_id']}",headers=other).status_code==403


def test_mysql_import_authenticated_before_merge_but_persisting_after_merge_is_rejected(client,db):
    import asyncio
    from threading import Event
    from backend.tests.test_wechat_auth import FakeWechat,login
    from backend.tests.test_local_import import payload
    client.app.state.wechat_auth=FakeWechat()
    login(client,'inflight-target')
    source=client.post('/api/v1/auth/device').json()['data']
    started=Event();proceed=Event();adapter=client.app.state.service.adapter;original=adapter.initialize
    async def pause(first):
        state=await original(first);started.set();await asyncio.to_thread(proceed.wait,10);return state
    with patch.object(adapter,'initialize',pause),ThreadPoolExecutor(max_workers=1) as pool:
        request=pool.submit(client.post,'/api/v1/game/import-local',json=payload(),headers={'Authorization':'Bearer '+source['token']})
        assert started.wait(10)
        merged=login(client,'inflight-target',device_token=source['token']);assert merged.status_code==200
        proceed.set();response=request.result(timeout=15)
        assert response.status_code==401 and response.json()['code']=='AUTH_INVALID'
    with Session(db) as s:
        assert not s.scalars(select(GameModel)).all()
        assert not s.scalars(select(LocalGameImportModel)).all()
