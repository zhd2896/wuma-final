"""Training coverage, theme pagination and first-exposure playtest evidence."""
from fastapi.testclient import TestClient
from backend.app.main import create_app
from backend.app.services.game_store import InMemoryGameStore
from backend.tests.test_training_catalog import account


def test_all_topics_have_introductory_and_intermediate_questions_without_answer_leaks():
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=True)) as client:
        client.headers.update(account(client))
        response = client.get('/api/v1/training?source=CURATED&limit=100')
        assert response.status_code == 200, response.text
        listed = response.json()['data']
        assert listed['total'] >= 15
        assert listed['items'][0]['difficultyTag'] == 'EASY'
        for theme in ('CAPTURE', 'VULNERABILITY', 'LONE_PIECE_RISK'):
            for level in ('EASY', 'NORMAL'):
                data = client.get('/api/v1/training', params={
                    'source': 'CURATED', 'theme': theme, 'difficulty': level, 'limit': 1}).json()['data']
                assert data['total'] >= 2, (theme, level)
                question = data['items'][0]
                assert theme in question['trainingTags'] and question['difficultyTag'] == level
                assert question['difficultyBasis']['kind'] == 'LESSON_DESIGN'
                assert question['learningGoal']
                assert not {'bestMove', 'bestScore', 'lessonExplanation'} & question.keys()
                assert question['difficultyCalibration']['sampleCount'] == 0
                assert question['difficultyCalibration']['suggestedDifficulty'] is None
                assert question['difficultyCalibration']['status'] == 'COLLECTING'
                next_page = client.get('/api/v1/training', params={
                    'source': 'CURATED', 'theme': theme, 'difficulty': level, 'limit': 1, 'offset': 1}).json()['data']
                assert next_page['total'] == data['total']
                assert next_page['items'][0]['id'] != question['id']
        assert client.get('/api/v1/training?source=CURATED&theme=UNKNOWN').status_code == 422


def test_playtest_counts_first_scored_attempt_per_account_and_keeps_personal_progress():
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=True)) as client:
        first, second = account(client), account(client)
        client.headers.update(first)
        q = client.get('/api/v1/training?source=CURATED&theme=CAPTURE&difficulty=EASY').json()['data']['items'][0]
        item = client.portal.call(client.app.state.store.get_training_item, q['id'])
        answer_body = {'from_node': item.bestMove.from_node, 'to_node': item.bestMove.to_node,
                       'client_attempt_id': 'playtest-first-correct'}
        answer = client.post(f'/api/v1/training/{item.id}/answer', json=answer_body)
        assert answer.status_code == 200
        assert answer.json()['data']['lessonExplanation']
        assert client.post(f'/api/v1/training/{item.id}/answer', json=answer_body).json() == answer.json()
        client.post(f'/api/v1/training/{item.id}/answer', json={**answer_body, 'client_attempt_id': 'playtest-repeat-correct'})
        calibration = client.get(f'/api/v1/training/{item.id}').json()['data']['difficultyCalibration']
        assert calibration['sampleCount'] == calibration['firstTryCorrectCount'] == 1
        assert calibration['suggestedDifficulty'] is None
        client.headers.update(second)
        legal = client.portal.call(client.app.state.adapter.legal_moves, item.stateSnapshot)
        for move in legal:
            turn = client.portal.call(client.app.state.adapter.execute_turn, item.stateSnapshot, move)
            score = client.portal.call(client.app.state.adapter.review_move, item.stateSnapshot, turn.state, move, item.scoringConfig)
            if score.actualMoveScore < item.bestScore:
                break
        else:
            raise AssertionError('Puzzle must have a worse answer')
        body = {'from_node': move.from_node, 'to_node': move.to_node, 'client_attempt_id': 'playtest-second-worse'}
        assert client.post(f'/api/v1/training/{item.id}/answer', json=body).json()['data']['result'] == 'SUBOPTIMAL'
        client.post(f'/api/v1/training/{item.id}/answer', json={**answer_body, 'client_attempt_id': 'playtest-second-retry'})
        detail = client.get(f'/api/v1/training/{item.id}').json()['data']
        assert detail['difficultyCalibration']['sampleCount'] == 2
        assert detail['difficultyCalibration']['firstTryCorrectCount'] == 1
        assert detail['progress']['attemptCount'] == 2 and detail['progress']['completed'] is True
        assert not {'userId', 'accounts', 'records'} & detail['difficultyCalibration'].keys()
        # Exercise the real API at the evidence threshold, not just the pure formula.
        for index in range(18):
            client.headers.update(account(client))
            response = client.post(f'/api/v1/training/{item.id}/answer', json={
                **answer_body, 'client_attempt_id': f'playtest-account-{index:02d}'})
            assert response.status_code == 200, response.text
        detail = client.get(f'/api/v1/training/{item.id}').json()['data']
        assert detail['difficultyCalibration']['sampleCount'] == 20
        assert detail['difficultyCalibration']['firstTryCorrectCount'] == 19
        assert detail['difficultyCalibration']['suggestedDifficulty'] == 'EASY'
        # Course filters remain stable while observed suggestions are separate.
        filtered = client.get('/api/v1/training?source=CURATED&difficulty=EASY&theme=CAPTURE').json()['data']
        assert any(q['id'] == item.id for q in filtered['items'])


def test_calibration_thresholds_do_not_claim_player_evidence_before_twenty_accounts():
    from backend.app.services.training_calibration import calibrate_difficulty
    assert calibrate_difficulty(19, 19).suggestedDifficulty is None
    assert calibrate_difficulty(20, 15).suggestedDifficulty == 'EASY'
    assert calibrate_difficulty(20, 8).suggestedDifficulty == 'NORMAL'
    assert calibrate_difficulty(20, 7).suggestedDifficulty == 'COMPLEX'
    assert calibrate_difficulty(20, 15).status == 'CALIBRATED'
