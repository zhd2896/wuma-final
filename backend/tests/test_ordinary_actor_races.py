"""A request authenticated before an account merge cannot write or return cached private work."""
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient
from backend.app.main import create_app
from backend.app.services.game_store import InMemoryGameStore
from backend.app.api.v1.account import _token_hash
from backend.tests.test_wechat_auth import FakeWechat, login
from backend.tests.test_training import finished_review
from datetime import datetime, timedelta, timezone


def record_count(store, operation):
    operation = operation.replace('-cache', '')
    memory_field = {'move': '_moves', 'ai-move': '_moves', 'undo': '_undo_events',
        'resign': '_terminal_events', 'analyze': '_analyses', 'review': '_reviews',
        'explain': '_explanations', 'coach': '_coach_hints'}[operation]
    if isinstance(store, InMemoryGameStore):
        records = getattr(store, memory_field)
        return sum(len(rows) for rows in records.values()) if memory_field in ('_moves', '_analyses') else len(records)
    from sqlalchemy import select, func
    from backend.app.db import models
    model = {'move': models.GameMoveModel, 'ai-move': models.GameMoveModel,
        'undo': models.GameUndoEventModel, 'resign': models.GameTerminalEventModel,
        'analyze': models.AiAnalysisModel, 'review': models.GameReviewModel,
        'explain': models.ReviewExplanationModel, 'coach': models.CoachHintModel}[operation]
    with store.sessions() as session:
        return session.scalar(select(func.count()).select_from(model))


def exercise_race(client, operation, boundary):
    app = client.app; store = app.state.store; app.state.wechat_auth = FakeWechat()
    target = login(client).json()['data']
    old = client.post('/api/v1/auth/device').json()['data']
    client.headers['Authorization'] = 'Bearer ' + old['token']
    if operation in ('review', 'review-cache', 'explain', 'explain-cache'):
        game, _ = finished_review(client)
        if operation == 'review':
            # finished_review generated a review already; use a second reviewed player.
            body = {'reviewed_player': 'B'}
        else:
            body = {}
        if operation == 'explain-cache':
            assert client.post(f'/api/v1/game/{game}/review/explain', json={}).status_code == 200
    else:
        body = {}
        game = client.post('/api/v1/game', json={'mode': 'AI' if operation in ('ai-move', 'coach', 'coach-cache') else 'LOCAL',
            'first_player': 'B' if operation == 'ai-move' else 'A'}).json()['data']['game_id']
        if operation == 'undo':
            assert client.post(f'/api/v1/game/{game}/move', json={'from_node': 'P01', 'to_node': 'P02'}).status_code == 200
        if operation in ('coach', 'coach-cache'):
            body = {'level': 1, 'expected_version': 0}
            if operation == 'coach-cache':
                assert client.post(f'/api/v1/game/{game}/coach/hint', json=body).status_code == 200
    before = client.portal.call(store.get_snapshot, game)
    records_before = record_count(store, operation)
    owner, method, timing = boundary
    obj = app.state.adapter if owner == 'engine' else store
    original = getattr(obj, method)
    merged = False

    async def race(*args, **kwargs):
        nonlocal merged
        if timing == 'after': result = await original(*args, **kwargs)
        if not merged:
            merged = True
            await store.login_wechat('wx-test-app:alice', '9' * 64,
                datetime.now(timezone.utc) + timedelta(days=1), _token_hash(old['token']))
        return result if timing == 'after' else await original(*args, **kwargs)

    path = f'/api/v1/game/{game}/'
    if operation == 'move': body = {'from_node': 'P01', 'to_node': 'P02'}
    if operation in ('undo', 'resign'): body = {'expected_version': before.version, 'client_request_id': 'actor-race'}
    if operation == 'analyze': path = '/api/v1/ai/analyze'; body = {'game_id': game}
    else: path += {'review-cache': 'review', 'explain': 'review/explain', 'explain-cache': 'review/explain',
                  'coach': 'coach/hint', 'coach-cache': 'coach/hint'}.get(operation, operation)
    with patch.object(obj, method, race):
        response = client.post(path, json=body)
    assert merged
    assert response.status_code == 401 and response.json()['code'] == 'AUTH_INVALID', response.text
    assert record_count(store, operation) == records_before, 'retired actor wrote a record'
    after = client.portal.call(store.get_snapshot, game)
    assert after.version == before.version and after.ply_count == before.ply_count and after.state == before.state
    assert client.get(f'/api/v1/game/{game}').status_code == 401
    client.headers['Authorization'] = 'Bearer ' + target['token']
    assert client.get(f'/api/v1/game/{game}').status_code == 200
    if operation == 'move':
        assert client.post(f'/api/v1/game/{game}/move', json=body).status_code == 200


CASES = [
    ('move', ('engine', 'execute_turn', 'after')),
    ('ai-move', ('engine', 'ai_move', 'after')),
    ('analyze', ('engine', 'analyze_position', 'after')),
    ('undo', ('store', 'commit_undo', 'before')),
    ('resign', ('store', 'commit_resign', 'before')),
    ('review', ('engine', 'review_move', 'after')),
    ('review-cache', ('store', 'get_review', 'after')),
    ('explain', ('store', 'commit_explanation', 'before')),
    ('explain-cache', ('store', 'get_explanation', 'after')),
    ('coach', ('store', 'commit_coach_hint', 'before')),
    ('coach-cache', ('store', 'get_coach_hint', 'after')),
]


@pytest.mark.parametrize('operation,boundary', CASES)
def test_ordinary_inflight_actor_merge(operation, boundary):
    with TestClient(create_app(store=InMemoryGameStore())) as client:
        exercise_race(client, operation, boundary)
