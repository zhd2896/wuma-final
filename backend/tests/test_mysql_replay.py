"""Phase 6 replay and perspective run on the UUID-verified isolated MySQL schema."""
from unittest.mock import patch
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from backend.tests.test_mysql_persistence import db, client, pytestmark
from backend.tests.test_replay import (replay_assertions, test_replay_undo_shows_effective_branch_and_separate_resign as exercise_undo,
    test_replay_synced_import_zero_move_resign_has_initial_and_terminal as exercise_import)
from backend.tests.test_training import finished_review
from backend.tests.test_training_perspective import exercise_player_list
from backend.tests.test_remote_accounts import account, room
from backend.app.db.models import GameReviewModel, GameMoveModel, GameModel, TrainingItemModel


def test_mysql_natural_replay_is_readonly_with_saved_capture(client, db):
    game_id, _ = finished_review(client)
    with Session(db) as session:
        before = [session.scalar(select(func.count()).select_from(model)) for model in (GameReviewModel, GameMoveModel, GameModel)]
    data = replay_assertions(client, game_id)
    assert len(data['steps']) == 14 and data['steps'][-1]['state']['game_status'] == 'FINISHED'
    assert any(step['capture']['was_applied'] for step in data['steps'])
    with Session(db) as session:
        assert [session.scalar(select(func.count()).select_from(model)) for model in (GameReviewModel, GameMoveModel, GameModel)] == before


def test_mysql_undo_effective_branch_and_imported_empty_resignation(client):
    exercise_undo(client)
    exercise_import(client)


def test_mysql_player_list_counts_paginate_both_saved_views(client, db):
    game_id, questions = exercise_player_list(client)
    with Session(db) as session:
        assert session.scalar(select(func.count()).select_from(TrainingItemModel)) == len(questions)
    data = replay_assertions(client, game_id)
    assert data['ply_count'] == 14 and data['steps'][-1]['kind'] == 'MOVE'


def test_mysql_remote_replay_requires_room_account_and_rechecks_rotated_token(client):
    a, b, stranger = account(client), account(client), account(client)
    host = room(client, a)
    guest = client.post('/api/v1/remote/join', headers=b, json={
        'device_id': 'mysql-replay-guest', 'invite_code': host['invite_code']}).json()['data']
    path = f'/api/v1/remote/rooms/{host["game_id"]}'
    assert client.post(path + '/resign', headers={**b, 'X-Room-Token': guest['token']},
        json={'expected_version': 0, 'client_request_id': 'mysql-replay-resign'}).status_code == 200
    for headers, token in [(a, host['token']), (b, guest['token'])]:
        response = client.get(path + '/replay', headers={**headers, 'X-Room-Token': token})
        assert response.status_code == 200 and response.json()['data']['ply_count'] == 0
        assert client.get(f'/api/v1/game/{host["game_id"]}/replay', headers=headers).json()['code'] == 'REMOTE_ACTION_REQUIRED'
    for headers in [{**a, 'X-Room-Token': guest['token']}, {**stranger, 'X-Room-Token': host['token']}, {**b, 'X-Room-Token': 'wrong'}]:
        assert client.get(path + '/replay', headers=headers).status_code == 403
    store = client.app.state.store
    original = store.read_replay
    owner = client.portal.call(store.get_remote_room, host['game_id']).host_user_id
    async def rotated_read(game_id):
        result = await original(game_id)
        await client.app.state.remote_service.recover(game_id, owner)
        return result
    with patch.object(store, 'read_replay', side_effect=rotated_read):
        response = client.get(path + '/replay', headers={**a, 'X-Room-Token': host['token']})
    assert response.status_code == 403 and response.json()['code'] == 'REMOTE_ACCESS_DENIED'


def test_mysql_corrupt_saved_revision_rejected_without_rewriting_rows(client, db):
    game_id, _ = finished_review(client)
    with Session(db) as session, session.begin():
        row = session.scalar(select(GameMoveModel).where(GameMoveModel.game_id == game_id).order_by(GameMoveModel.turn_number))
        row.created_revision = 999
    response = client.get(f'/api/v1/game/{game_id}/replay')
    assert response.status_code == 500 and response.json()['code'] == 'REPLAY_INTEGRITY_ERROR'
    with Session(db) as session:
        assert session.scalar(select(GameMoveModel.created_revision).where(GameMoveModel.game_id == game_id, GameMoveModel.turn_number == 1)) == 999


def test_mysql_legacy_unbound_replay_requires_claim(client):
    client.app.state.require_auth = False
    host = room(client, {})
    client.app.state.require_auth = True
    headers = account(client)
    path = f'/api/v1/remote/rooms/{host["game_id"]}'
    credential = {**headers, 'X-Room-Token': host['token']}
    assert client.get(path, headers=credential).status_code == 200
    assert client.get(path + '/replay', headers=credential).status_code == 403
    claimed = client.post(path + '/claim', headers=credential)
    assert claimed.status_code == 200, claimed.text
    token = claimed.json()['data']['token']
    assert client.get(path + '/replay', headers={**headers, 'X-Room-Token': token}).status_code == 200
