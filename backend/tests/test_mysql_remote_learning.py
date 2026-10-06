"""Remote learning API isolation and final transactional guards on dedicated MySQL."""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
import pytest
from sqlalchemy import select, text, event
import re
from sqlalchemy.orm import Session
from fastapi.testclient import TestClient
from backend.app.main import create_app
from backend.app.db.models import TrainingItemModel, TrainingRecordModel, AiAnalysisModel, ReviewExplanationModel
from backend.app.db.repositories.mysql_store import MySQLGameStore
from backend.app.services.remote_service import token_hash
from backend.app.api.v1.account import _token_hash
from backend.app.core.errors import ApiError
from backend.tests.test_mysql_persistence import DB_URL, db, pytestmark
from backend.tests import test_remote_learning as contracts


@pytest.mark.parametrize('contract', [
    contracts.test_online_analysis_uses_room_version_and_terminal_state,
    contracts.test_both_seats_explain_and_generate_private_training_with_hidden_answers,
    contracts.test_waiting_cancelled_and_unclaimed_learning_rejected,
    contracts.test_explicit_unauthenticated_learning_supports_terminal_empty_review_and_no_questions,
])
def test_mysql_learning_contract(db, monkeypatch, contract):
    stores = []
    def make_store():
        store = MySQLGameStore(DB_URL); stores.append(store); return store
    monkeypatch.setattr(contracts, 'InMemoryGameStore', make_store)
    try:
        contract()
    finally:
        for store in stores:
            store.close()


@pytest.mark.parametrize('read', ['legal', 'get', 'list', 'count'])
def test_mysql_private_read_final_actor(db, monkeypatch, read):
    store = MySQLGameStore(DB_URL)
    monkeypatch.setattr(contracts, 'InMemoryGameStore', lambda: store)
    try:
        contracts.test_private_training_reads_recheck_active_owner_after_async_work(read)
    finally:
        store.close()


def test_mysql_remote_question_owners_merge_and_final_cached_answer_rejects_retired(db):
    store = MySQLGameStore(DB_URL)
    try:
        with TestClient(create_app(store=store)) as client:
            host, seats, stranger = contracts.finished(client)
            path = '/api/v1/remote/rooms/' + host['game_id']
            review = client.post(path + '/review', headers=seats[0], json={}).json()['data']
            questions = client.post(path + '/training', headers=seats[0], json={}).json()['data']['items']
            assert questions
            q = questions[0]
            item = client.portal.call(store.get_training_item, q['id'])
            owner = client.portal.call(store.get_remote_room, host['game_id']).host_user_id
            with Session(db) as session:
                assert all(row.user_id == owner for row in session.scalars(select(TrainingItemModel)).all())
            body = {'from_node': item.bestMove.from_node, 'to_node': item.bestMove.to_node, 'client_attempt_id': 'mysql-remote-cache-answer'}
            assert client.post('/api/v1/training/' + q['id'] + '/answer', headers=seats[0], json=body).status_code == 200
            expires = datetime.now(timezone.utc) + timedelta(days=1)
            target = client.portal.call(store.login_wechat, 'mysql-target', _token_hash('c' * 64), expires)
            original = store.get_training_attempt
            async def changed(*args):
                result = await original(*args)
                await store.login_wechat('mysql-target', _token_hash('d' * 64), expires, _token_hash(seats[0]['Authorization'][7:]))
                return result
            with patch.object(store, 'get_training_attempt', changed):
                response = client.post('/api/v1/training/' + q['id'] + '/answer', headers=seats[0], json=body)
            assert response.json()['code'] == 'AUTH_INVALID', response.text
            with Session(db) as session:
                assert session.get(TrainingItemModel, q['id']).user_id == target
                assert session.scalar(select(TrainingRecordModel)).user_id == target
            headers = {'Authorization': 'Bearer ' + 'd' * 64}
            assert client.get('/api/v1/training/' + q['id'], headers=headers).json()['data']['progress']['completed']
            assert client.get('/api/v1/training', headers=headers, params={'source_game_id': host['game_id'], 'player': 'A'}).json()['data']['total'] == len(questions)
            assert client.get('/api/v1/training/' + q['id'], headers=stranger).status_code == 403
            with pytest.raises(ApiError) as failure:
                client.portal.call(store.commit_training_items, review['id'], [], owner)
            assert failure.value.code == 'AUTH_INVALID'
    finally:
        store.close()


def test_remote_explanation_and_generation_use_same_actual_mysql_lock_order(db):
    """Observe real locking SQL: reverse Review/User order creates a concurrent deadlock cycle."""
    store = MySQLGameStore(DB_URL)
    try:
        with TestClient(create_app(store=store)) as client:
            host, seats, _ = contracts.playing(client)
            path = '/api/v1/remote/rooms/' + host['game_id']
            client.post(path + '/resign', headers=seats[1], json={'expected_version': 0, 'client_request_id': 'mysql-lock-order-resign'})
            assert client.post(path + '/review', headers=seats[0], json={}).status_code == 200
            locks = []
            def record_lock(_connection, _cursor, statement, _params, _context, _many):
                if 'FOR UPDATE' in statement.upper():
                    match = re.search(r'FROM\s+`?(users|remote_rooms|games|game_reviews)`?\b', statement, re.I)
                    if match and (not locks or locks[-1] != match[1].lower()):
                        locks.append(match[1].lower())
            event.listen(store.engine, 'before_cursor_execute', record_lock)
            try:
                for endpoint in ['/review/explain', '/training']:
                    locks.clear()
                    response = client.post(path + endpoint, headers=seats[0], json={})
                    assert response.status_code == 200, response.text
                    assert locks[:4] == ['users', 'remote_rooms', 'games', 'game_reviews'], (endpoint, locks)
            finally:
                event.remove(store.engine, 'before_cursor_execute', record_lock)
    finally:
        store.close()


@pytest.mark.parametrize('operation', ['analysis', 'explanation', 'generation'])
@pytest.mark.parametrize('boundary', ['rotate', 'merge', 'version'])
def test_mysql_learning_final_transaction_rechecks_actor_and_version(db, operation, boundary):
    store = MySQLGameStore(DB_URL)
    try:
        with TestClient(create_app(store=store)) as client:
            host, seats, _ = contracts.playing(client)
            game_id = host['game_id']; path = '/api/v1/remote/rooms/' + game_id
            if operation != 'analysis':
                client.post(path + '/resign', headers=seats[1], json={'expected_version': 0, 'client_request_id': 'mysql-learning-resign'})
                client.post(path + '/review', headers=seats[0], json={})
            owner = client.portal.call(store.get_remote_room, game_id).host_user_id
            async def mutate():
                if boundary == 'rotate':
                    await store.recover_remote_room(game_id, owner, token_hash('rotated-seat'))
                elif boundary == 'merge':
                    expires = datetime.now(timezone.utc) + timedelta(days=1)
                    await store.login_wechat('mysql-target', 'target-session', expires)
                    await store.login_wechat('mysql-target', 'merged-session', expires, _token_hash(seats[0]['Authorization'][7:]))
                else:
                    with store.sessions.begin() as session:
                        session.execute(text('UPDATE games SET version=version+1 WHERE id=:id'), {'id': game_id})
            if operation == 'analysis':
                target, name, endpoint = client.app.state.adapter, 'analyze_position', '/analyze'
            elif operation == 'explanation':
                target, name, endpoint = client.app.state.explanation_service, '_game', '/review/explain'
            else:
                target, name, endpoint = store, 'list_training_sources', '/training'
            original = getattr(target, name)
            async def changed(*args):
                result = await original(*args); await mutate(); return result
            with patch.object(target, name, changed):
                response = client.post(path + endpoint, headers=seats[0], json={'expected_version': 0} if operation == 'analysis' else {})
            assert response.status_code in (401, 403, 409), response.text
            with Session(db) as session:
                model = {'analysis': AiAnalysisModel, 'explanation': ReviewExplanationModel, 'generation': TrainingItemModel}[operation]
                assert session.scalars(select(model)).all() == []
    finally:
        store.close()
