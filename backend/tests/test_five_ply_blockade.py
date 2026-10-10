"""Screenshot with only P27 sealed: real worker must coordinate a five-ply finish."""
from dataclasses import replace
import pytest
from backend.tests.test_coach import client
from backend.tests.test_api import seed_position
from backend.app.schemas.game import PlayerState, ReviewConfig, Move
from backend.app.schemas.coach import CoachHint

PIECES = {node: 'B' for node in ('P01','P03','P05','P07','P14','P20','P21','P23','P27')}
PIECES['P29'] = 'A'


def position(client, ai_player, level='BEGINNER', first_player='B'):
    game_id = seed_position(client, PIECES, first_player=first_player, mode='AI', ai_player=ai_player)
    store = client.app.state.store
    game = client.portal.call(store.get_snapshot, game_id)
    state = game.state.model_copy(update={'players': {'A': PlayerState(reserve_count=4), 'B': PlayerState(reserve_count=0)}})
    client.portal.call(store.update, game_id, state)
    store._games[game_id] = replace(store._games[game_id], ai_level=level)
    client.app.state.service.settings = replace(client.app.state.service.settings,
        analysis_max_depth=1, analysis_time_limit_ms=1000)
    return game_id


@pytest.mark.parametrize('level', ['BEGINNER', 'STANDARD', 'ADVANCED'])
@pytest.mark.parametrize('wing', [None, 'P26', 'P28'])
def test_real_ai_coordinates_five_ply_finish_and_records_terminal(client, level, wing):
    game_id = position(client, 'B', level, first_player='A' if wing else 'B')
    path = f'/api/v1/game/{game_id}'
    if wing:
        response = client.post(path + '/move', json={'from_node':'P29','to_node':wing})
        assert response.status_code == 200, response.text
    ai_origins = []
    for _ in range(7 if wing else 5):
        state = client.portal.call(client.app.state.store.get_snapshot, game_id).state
        if state.game_status == 'FINISHED': break
        if state.current_player == 'B':
            response = client.post(path + '/ai-move', json={})
            assert response.status_code == 200, response.text
            ai_origins.append(response.json()['data']['search']['bestMove']['from'])
        else:
            moves = client.portal.call(client.app.state.adapter.legal_moves, state)
            assert len(moves) == 1  # Selected seal forces the screenshot's sole reply.
            response = client.post(path + '/move', json=moves[0].model_dump())
            assert response.status_code == 200, response.text
    state = client.portal.call(client.app.state.store.get_snapshot, game_id).state
    assert state.game_status == 'FINISHED' and state.winner == 'B' and state.winner_reason == 'TEMPLE_TRAP'
    assert len(set(ai_origins)) > 1
    replay = client.get(path + '/replay')
    assert replay.status_code == 200, replay.text
    assert replay.json()['data']['steps'][-1]['state'] == state.model_dump()


def test_five_ply_analysis_coach_and_finished_review_use_same_evidence(client):
    game_id = position(client, 'A')
    path = f'/api/v1/game/{game_id}'
    analysis = client.post('/api/v1/ai/analyze', json={'game_id': game_id})
    assert analysis.status_code == 200, analysis.text
    threats = analysis.json()['data']['threats']
    proof = next(t for t in threats if t['type'] == 'FORCED_BLOCKADE_AVAILABLE')
    assert proof['evidence']['maxPlies'] == 5
    hint = client.post(path + '/coach/hint', json={'level': 3, 'expected_version': 0})
    assert hint.status_code == 200, hint.text
    assert '围堵' in hint.json()['data']['hintText']
    for move in ({'from_node': 'P03', 'to_node': 'P26'}, {'from_node': 'P01', 'to_node': 'P03'}):
        response = client.post(path + '/move', json=move)
        assert response.status_code == 200, response.text
        response = client.post(path + '/ai-move', json={})
        assert response.status_code == 200, response.text
    response = client.post(path + '/move', json={'from_node': 'P03', 'to_node': 'P28'})
    assert response.status_code == 200, response.text
    review = client.post(path + '/review', json={'reviewed_player': 'B'})
    assert review.status_code == 200, review.text
    assert review.json()['data']['winnerReason'] == 'TEMPLE_TRAP'
    assert '围堵' in review.json()['data']['moveReviews'][0]['engineExplanation']


def test_saved_v2_training_keeps_its_original_three_ply_scoring_policy(client):
    game_id = position(client, 'A')
    state = client.portal.call(client.app.state.store.get_snapshot, game_id).state
    move = Move(from_node='P03', to_node='P26')
    after = client.portal.call(client.app.state.adapter.execute_turn, state, move).state
    old = client.portal.call(client.app.state.adapter.review_move, state, after, move,
        ReviewConfig(version=2, max_depth=1, time_limit_ms_per_move=10000))
    assert old.bestScore < 900_000
    new = client.portal.call(client.app.state.adapter.review_move, state, after, move,
        ReviewConfig(version=3, max_depth=1, time_limit_ms_per_move=10000))
    assert new.bestScore >= 999_995


def test_five_ply_hint_does_not_reuse_preexisting_v2_cache(client):
    game_id = position(client, 'A')
    path = f'/api/v1/game/{game_id}/coach/hint'
    response = client.post(path, json={'level':3, 'expected_version':0})
    assert response.status_code == 200, response.text
    hint = CoachHint.model_validate(response.json()['data'])
    store = client.app.state.store
    store._coach_hints.clear()
    old = hint.model_copy(update={'promptVersion':'coach_hint_v2','hintText':'旧围堵提示'})
    store._coach_hints[(game_id,0,'B',3,'coach_hint_v2')] = old
    fresh = client.post(path,json={'level':3,'expected_version':0})
    assert fresh.status_code == 200, fresh.text
    assert fresh.json()['data']['hintText'] != old.hintText
    assert fresh.json()['data']['promptVersion'] == 'coach_hint_v3'
    assert store._coach_hints[(game_id,0,'B',3,'coach_hint_v2')] == old
