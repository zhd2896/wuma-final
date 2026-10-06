"""Public catalog and progress use real canonical Engine answers."""
from fastapi.testclient import TestClient
from backend.app.main import create_app
from backend.app.services.game_store import InMemoryGameStore
import time


def account(client):
    token = client.post('/api/v1/auth/device').json()['data']['token']
    return {'Authorization': 'Bearer ' + token}


def exercise_catalog(client):
    first = account(client)
    second = account(client)
    client.headers.update(first)
    started = time.perf_counter()
    listed = client.get('/api/v1/training?source=CURATED').json()['data']
    print(f'首次精选题列表真实校验: {time.perf_counter() - started:.3f}s')
    assert listed['total'] >= 3
    questions = listed['items']
    assert len({q['id'] for q in questions}) == len(questions)
    assert all(q['sourceKind'] == 'CURATED' and q['sourceCategory'] is None for q in questions)
    assert all(q['progress'] == {'attemptCount': 0, 'latestResult': None, 'completed': False} for q in questions)
    assert all(not {'bestMove', 'bestScore', 'originalMove'} & q.keys() for q in questions)
    states = set()
    for index, question in enumerate(questions):
        item = client.portal.call(client.app.state.store.get_training_item, question['id'])
        states.add(item.stateSnapshot.model_dump_json())
        assert item.sourceGameId is None and item.sourceMoveReviewId is None
        legal = client.portal.call(client.app.state.adapter.legal_moves, item.stateSnapshot)
        assert item.bestMove in legal and len(legal) >= 2
        assert item.scoringConfig.max_depth == item.scoringDepth == 2
        assert question['difficultyBasis']['legalCandidateCount'] == len(legal)
        scores = []
        for move in legal:
            turn = client.portal.call(client.app.state.adapter.execute_turn, item.stateSnapshot, move)
            score = client.portal.call(client.app.state.adapter.review_move, item.stateSnapshot,
                                      turn.state, move, item.scoringConfig)
            assert not score.timedOut and score.searchDepth == item.scoringDepth
            scores.append(score.actualMoveScore)
        assert min(scores) < max(scores)
        if index == 0:
            worse_move = legal[scores.index(min(scores))]
        body = {'from_node': item.bestMove.from_node, 'to_node': item.bestMove.to_node,
                'client_attempt_id': f'catalog-best-{index}-0001'}
        answer = client.post(f'/api/v1/training/{item.id}/answer', json=body)
        assert answer.status_code == 200, answer.text
        assert answer.json()['data']['result'] == 'CORRECT'
        assert client.post(f'/api/v1/training/{item.id}/answer', json=body).json() == answer.json()
    assert len(states) >= 3
    first_question = questions[0]
    item = client.portal.call(client.app.state.store.get_training_item, first_question['id'])
    client.post(f'/api/v1/training/{item.id}/answer', json={
        'from_node': item.bestMove.from_node, 'to_node': item.bestMove.to_node,
        'client_attempt_id': 'catalog-repeat-best-0001'})
    suboptimal = client.post(f'/api/v1/training/{item.id}/answer', json={
        'from_node': worse_move.from_node, 'to_node': worse_move.to_node,
        'client_attempt_id': 'catalog-worse-latest-0001'})
    assert suboptimal.json()['data']['result'] == 'SUBOPTIMAL'
    profile = client.get('/api/v1/me/profile').json()['data']
    assert profile['training'] == len(questions)
    assert profile['trainingAttempts'] == len(questions) + 2
    assert profile['correct'] == len(questions) + 1
    detail = client.get(f'/api/v1/training/{item.id}').json()['data']
    assert detail['progress'] == {'attemptCount': 3, 'latestResult': 'SUBOPTIMAL', 'completed': True}
    completed = client.get('/api/v1/training?source=CURATED&completed=true&limit=1').json()['data']
    assert completed['total'] == len(questions) and len(completed['items']) == 1
    next_page = client.get('/api/v1/training?source=CURATED&completed=true&limit=1&offset=1').json()['data']
    assert next_page['total'] == completed['total'] and next_page['items'][0]['id'] != completed['items'][0]['id']
    assert client.get('/api/v1/training?source=CURATED&completed=false').json()['data']['total'] == 0
    assert client.get('/api/v1/training?source=CURATED&category=MISTAKE').json()['data']['total'] == 0
    assert client.get('/api/v1/training?source=CURATED&source_game_id=unknown').json()['data']['total'] == 0
    for difficulty in ('EASY', 'NORMAL', 'COMPLEX', 'UNCALIBRATED'):
        filtered = client.get('/api/v1/training', params={'source': 'CURATED', 'difficulty': difficulty}).json()['data']
        assert filtered['total'] == sum(q['difficultyTag'] == difficulty for q in questions)
    client.headers.update(second)
    assert client.get(f'/api/v1/training/{item.id}').json()['data']['progress']['attemptCount'] == 0
    assert client.get('/api/v1/me/profile').json()['data']['training'] == 0
    assert client.get('/api/v1/training').json()['data']['total'] == 0
    assert client.get('/api/v1/training?source=CURATED&completed=false').json()['data']['total'] == len(questions)
    return questions


def test_public_catalog_answers_progress_and_filters():
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=True)) as client:
        exercise_catalog(client)


def test_regenerated_review_list_has_current_personal_progress():
    from backend.tests.test_training import finished_review
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=True)) as client:
        client.headers.update(account(client))
        game_id, _ = finished_review(client)
        question = client.post(f'/api/v1/game/{game_id}/training', json={}).json()['data']['items'][0]
        item = client.portal.call(client.app.state.store.get_training_item, question['id'])
        answered = client.post(f'/api/v1/training/{item.id}/answer', json={
            'from_node': item.bestMove.from_node, 'to_node': item.bestMove.to_node,
            'client_attempt_id': 'review-regen-personal-0001'})
        assert answered.status_code == 200
        repeated = client.post(f'/api/v1/game/{game_id}/training', json={}).json()['data']['items']
        assert next(q for q in repeated if q['id'] == item.id)['progress']['completed'] is True


def test_catalog_refuses_partial_engine_validation_and_retries_cleanly():
    from unittest.mock import patch
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=True)) as client:
        client.headers.update(account(client))
        adapter = client.app.state.adapter
        original = adapter.analyze_position
        async def partial(*args):
            return (await original(*args)).model_copy(update={'timedOut': True})
        with patch.object(adapter, 'analyze_position', side_effect=partial):
            response = client.get('/api/v1/training?source=CURATED')
            assert response.status_code == 409 and response.json()['code'] == 'TRAINING_SCORING_INCOMPLETE'
        assert client.app.state.store._training_items == {}
        assert client.get('/api/v1/training?source=CURATED').json()['data']['total'] == 3


def test_catalog_answer_refuses_timeout_at_the_saved_depth_without_progress():
    from unittest.mock import patch
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=True)) as client:
        client.headers.update(account(client))
        question = client.get('/api/v1/training?source=CURATED').json()['data']['items'][0]
        item = client.portal.call(client.app.state.store.get_training_item, question['id'])
        adapter = client.app.state.adapter
        original = adapter.review_move
        async def timeout(*args):
            return (await original(*args)).model_copy(update={'timedOut': True})
        with patch.object(adapter, 'review_move', side_effect=timeout):
            response = client.post(f'/api/v1/training/{item.id}/answer', json={
                'from_node': item.bestMove.from_node, 'to_node': item.bestMove.to_node,
                'client_attempt_id': 'catalog-timedout-0001'})
            assert response.status_code == 409 and response.json()['code'] == 'TRAINING_SCORING_INCOMPLETE'
        assert client.get(f'/api/v1/training/{item.id}').json()['data']['progress']['attemptCount'] == 0
