from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient
from backend.app.main import create_app
from backend.app.core.config import Settings
from backend.app.services.game_store import InMemoryGameStore

@pytest.mark.parametrize('level,expected', [('BEGINNER',(2,500)),('STANDARD',(4,1000)),('ADVANCED',(6,2000))])
def test_saved_level_controls_real_worker_search(level, expected):
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=False)) as client:
        response = client.post('/api/v1/game', json={'mode':'AI','ai_player':'A','ai_level':level})
        assert response.status_code == 200, response.text
        game = response.json()['data']
        assert game['ai_level'] == level
        assert client.get('/api/v1/game/'+game['game_id']).json()['data']['ai_level'] == level
        adapter = client.app.state.service.adapter
        with patch.object(adapter, 'ai_move', wraps=adapter.ai_move) as search:
            moved = client.post('/api/v1/game/'+game['game_id']+'/ai-move', json={})
            assert moved.status_code == 200, moved.text
            assert search.call_args.args[1:] == expected

@pytest.mark.parametrize('depth,time', [(True,False),(-1,0),(2.5,'1000'),(None,None),(10**20,10**20)])
def test_invalid_configuration_has_bounded_strictly_ordered_budgets(depth,time):
    from backend.app.services.ai_levels import ai_search_budget
    settings = Settings(ai_default_max_depth=depth, ai_default_time_limit_ms=time)
    budgets = [ai_search_budget(level, settings) for level in ('BEGINNER','STANDARD','ADVANCED')]
    assert all(type(d) is int and type(t) is int and 1 <= d <= 10 and 50 <= t <= 6000 for d,t in budgets)
    assert budgets[0][0] < budgets[1][0] < budgets[2][0]
    assert budgets[0][1] < budgets[1][1] < budgets[2][1]
    expected = [(4,1500),(8,3000),(10,6000)] if type(depth) is int and depth > 8 else [(2,500),(4,1000),(6,2000)]
    assert budgets == expected

@pytest.mark.parametrize('depth,time,expected',[(5,1200,[(2,600),(5,1200),(7,2400)]),(1,1,[(1,50),(2,100),(4,200)])])
def test_configured_standard_budget_preserved_with_explicit_lower_bounds(depth,time,expected):
    from backend.app.services.ai_levels import ai_search_budget
    settings=Settings(ai_default_max_depth=depth,ai_default_time_limit_ms=time)
    assert [ai_search_budget(level,settings) for level in ('BEGINNER','STANDARD','ADVANCED')] == expected

def test_levels_default_and_request_boundaries():
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=False)) as client:
        assert client.post('/api/v1/game', json={'mode':'AI'}).json()['data']['ai_level'] == 'STANDARD'
        for body in ({'mode':'AI','ai_level':'EXPERT'}, {'mode':'AI','ai_level':True}, {'mode':'LOCAL','ai_level':'BEGINNER'}, {'mode':'LOCAL','ai_player':'A'}):
            assert client.post('/api/v1/game',json=body).status_code in (400,422)
        ai_id = client.post('/api/v1/game',json={'mode':'AI','ai_player':'A'}).json()['data']['game_id']
        for body in ({'ai_level':'BEGINNER'},{'ai_level':'ADVANCED'},{'max_depth':1},{'time_limit_ms':50}):
            assert client.post(f'/api/v1/game/{ai_id}/ai-move',json=body).status_code == 422

@pytest.mark.parametrize('level', ['BEGINNER','ADVANCED'])
def test_learning_budgets_and_training_scoring_are_independent(level):
    from backend.tests.test_training import MOVES
    from backend.app.schemas.game import Move, ReviewConfig
    settings = Settings(ai_default_max_depth=8, ai_default_time_limit_ms=3000)
    with TestClient(create_app(settings, store=InMemoryGameStore(), require_auth=False)) as client:
        created = client.post('/api/v1/game',json={'mode':'AI','ai_level':level}).json()['data']
        game_id = created['game_id']
        adapter = client.app.state.adapter
        with patch.object(adapter,'analyze_position',wraps=adapter.analyze_position) as analyze:
            assert client.post('/api/v1/ai/analyze',json={'game_id':game_id}).status_code == 200
            assert analyze.call_args.args[1:] == (settings.analysis_max_depth,settings.analysis_time_limit_ms,settings.analysis_candidate_limit)
            for hint_level in (1,2,3):
                response = client.post(f'/api/v1/game/{game_id}/coach/hint',json={'level':hint_level,'expected_version':0})
                assert response.status_code == 200,response.text
            assert all(call.args[1:] == (settings.analysis_max_depth,settings.analysis_time_limit_ms,settings.analysis_candidate_limit) for call in analyze.call_args_list)
        # Known legal terminal score, committed through real engine turns and store.
        for source,target in MOVES:
            snapshot = client.portal.call(client.app.state.store.get_snapshot,game_id)
            turn = client.portal.call(adapter.execute_turn,snapshot.state,Move(from_node=source,to_node=target))
            actor = 'HUMAN' if snapshot.state.current_player == 'A' else 'AI'
            client.portal.call(client.app.state.store.commit_turn,game_id,snapshot.version,turn,actor)
        with patch.object(adapter,'review_move',wraps=adapter.review_move) as review_search:
            reviewed = client.post(f'/api/v1/game/{game_id}/review',json={})
            assert reviewed.status_code == 200,reviewed.text
            assert all(call.args[3] == ReviewConfig() for call in review_search.call_args_list)
            questions = client.post(f'/api/v1/game/{game_id}/training',json={}).json()['data']['items']
            assert questions
            item = client.portal.call(client.app.state.store.get_training_item,questions[0]['id'])
            result = client.post(f"/api/v1/training/{item.id}/answer",json={'from_node':item.bestMove.from_node,'to_node':item.bestMove.to_node,'client_attempt_id':f'ai-level-{level}-answer'})
            assert result.status_code == 200,result.text
            assert result.json()['data']['result'] == 'CORRECT'
            assert result.json()['data']['scoreLoss'] == 0
            assert review_search.call_args.args[3].max_depth == item.scoringDepth
        assert settings.ai_default_max_depth == 8 and settings.ai_default_time_limit_ms == 3000
