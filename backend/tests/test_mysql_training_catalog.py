"""阶段三在专用 MySQL 上的真实题库与个人进度验收。"""
import asyncio
import time
import hashlib
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from backend.tests.test_mysql_persistence import db, client, pytestmark
from backend.tests.test_training_catalog import exercise_catalog, account
from backend.tests.test_training import finished_review
from backend.app.db.models import TrainingItemModel, TrainingRecordModel, GameModel
from backend.app.services.training_service import TrainingService
from backend.app.services.training_catalog import POSITIONS
from backend.app.services.training_lessons import LESSONS
from backend.app.services.training_catalog import build_catalog


def test_mysql_catalog_answers_progress_and_filters(client, db):
    start = time.perf_counter()
    questions = exercise_catalog(client)
    print(f'真实MySQL全部题库验收耗时: {time.perf_counter() - start:.3f}s')
    with Session(db) as session:
        assert session.scalar(select(func.count()).select_from(GameModel)) == 0
        assert session.scalar(select(func.count()).select_from(TrainingItemModel)) == len(questions)
        assert session.scalar(select(func.count()).select_from(TrainingRecordModel)) == len(questions) + 2


def test_concurrent_catalog_initialization_is_idempotent(client, db):
    async def load():
        services = [TrainingService(client.app.state.service, client.app.state.store) for _ in range(2)]
        await asyncio.gather(*(service.ensure_catalog() for service in services))
    start = time.perf_counter()
    client.portal.call(load)
    print(f'首次双并发真实Engine验证及入库: {time.perf_counter() - start:.3f}s')
    with Session(db) as session:
        assert session.scalar(select(func.count()).select_from(TrainingItemModel)) == len(POSITIONS) + len(LESSONS)


def test_review_source_game_filter_and_private_permissions(client):
    first, _ = finished_review(client)
    questions1 = client.post(f'/api/v1/game/{first}/training', json={}).json()['data']['items']
    second, _ = finished_review(client)
    client.post(f'/api/v1/game/{second}/training', json={})
    filtered = client.get('/api/v1/training', params={'source': 'REVIEW', 'source_game_id': first}).json()['data']
    assert filtered['total'] == len(questions1)
    assert all(q['sourceGameId'] == first for q in filtered['items'])
    item = client.portal.call(client.app.state.store.get_training_item, questions1[0]['id'])
    answer = client.post(f'/api/v1/training/{item.id}/answer', json={
        'from_node': item.bestMove.from_node, 'to_node': item.bestMove.to_node,
        'client_attempt_id': 'review-generated-progress-0001'})
    assert answer.status_code == 200, answer.text
    repeated = client.post(f'/api/v1/game/{first}/training', json={}).json()['data']['items']
    assert next(q for q in repeated if q['id'] == item.id)['progress']['completed'] is True
    client.headers.update(account(client))
    assert client.get('/api/v1/training', params={'source': 'REVIEW', 'source_game_id': first}).json()['data']['total'] == 0
    assert client.get(f'/api/v1/training/{questions1[0]["id"]}').status_code == 403
    assert client.get('/api/v1/training?source=CURATED').json()['data']['total'] == len(POSITIONS) + len(LESSONS)


def test_in_flight_public_answer_rejects_merged_retired_account(client, db):
    question = client.get('/api/v1/training?source=CURATED').json()['data']['items'][0]
    store = client.app.state.store
    item = client.portal.call(store.get_training_item, question['id'])
    source_hash = hashlib.sha256(bytes.fromhex(client.headers['Authorization'][7:])).hexdigest()
    expiry = datetime.now(timezone.utc) + timedelta(days=1)
    target = client.portal.call(store.login_wechat, 'catalog-identity', 'catalog-target', expiry)
    original = client.app.state.adapter.review_move

    async def merge_before_scored_answer(*args):
        scored = await original(*args)
        await store.login_wechat('catalog-identity', 'catalog-merged', expiry, source_hash)
        return scored

    with patch.object(client.app.state.adapter, 'review_move', side_effect=merge_before_scored_answer):
        response = client.post(f'/api/v1/training/{item.id}/answer', json={
            'from_node': item.bestMove.from_node, 'to_node': item.bestMove.to_node,
            'client_attempt_id': 'retired-in-flight-0001'})
    assert response.status_code == 401 and response.json()['code'] == 'AUTH_INVALID'
    with Session(db) as session:
        assert session.scalar(select(func.count()).select_from(TrainingRecordModel)) == 0
    assert client.portal.call(store.personal_profile, target)['trainingAttempts'] == 0


def test_mysql_topic_filters_first_attempts_and_v1_progress_survive_catalog_expansion(client, db):
    catalog = client.portal.call(build_catalog, client.app.state.adapter)
    old = [item for item in catalog if item.catalogVersion == 1]
    client.portal.call(client.app.state.store.commit_curated_items, old)
    old_item = old[0]
    body = {'from_node': old_item.bestMove.from_node, 'to_node': old_item.bestMove.to_node,
            'client_attempt_id': 'mysql-v1-before-expansion'}
    assert client.post(f'/api/v1/training/{old_item.id}/answer', json=body).status_code == 200
    for theme in ('CAPTURE', 'VULNERABILITY', 'LONE_PIECE_RISK'):
        for level in ('EASY', 'NORMAL'):
            data = client.get('/api/v1/training', params={
                'source': 'CURATED', 'theme': theme, 'difficulty': level, 'limit': 1}).json()['data']
            assert data['total'] == 2
            q = data['items'][0]
            assert theme in q['trainingTags'] and q['difficultyTag'] == level
            page = client.get('/api/v1/training', params={
                'source': 'CURATED', 'theme': theme, 'difficulty': level, 'limit': 1, 'offset': 1}).json()['data']
            assert page['total'] == 2 and page['items'][0]['id'] != q['id']
    assert client.get(f'/api/v1/training/{old_item.id}').json()['data']['progress']['completed'] is True
    listed = client.get('/api/v1/training?source=CURATED').json()['data']
    assert listed['total'] == 15 and listed['items'][0]['difficultyTag'] == 'EASY'
    q = client.get('/api/v1/training?source=CURATED&theme=CAPTURE&difficulty=EASY').json()['data']['items'][0]
    item = client.portal.call(client.app.state.store.get_training_item, q['id'])
    answer_body = {'from_node': item.bestMove.from_node, 'to_node': item.bestMove.to_node,
                  'client_attempt_id': 'mysql-first-calibration'}
    answered = client.post(f'/api/v1/training/{item.id}/answer', json=answer_body)
    assert answered.status_code == 200 and answered.json()['data']['lessonExplanation']
    assert client.post(f'/api/v1/training/{item.id}/answer', json=answer_body).json() == answered.json()
    client.post(f'/api/v1/training/{item.id}/answer', json={**answer_body, 'client_attempt_id': 'mysql-repeat-calibration'})
    client.headers.update(account(client))
    client.post(f'/api/v1/training/{item.id}/answer', json={**answer_body, 'client_attempt_id': 'mysql-second-calibration'})
    detail = client.get(f'/api/v1/training/{item.id}').json()['data']
    assert detail['difficultyCalibration']['sampleCount'] == detail['difficultyCalibration']['firstTryCorrectCount'] == 2
    assert detail['difficultyCalibration']['suggestedDifficulty'] is None
    assert detail['progress']['attemptCount'] == 1
