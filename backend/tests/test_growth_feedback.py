from datetime import datetime, timedelta, timezone
import importlib.util
from fastapi.testclient import TestClient
from backend.app.main import create_app
from backend.app.services.game_store import InMemoryGameStore

NOW = datetime(2026, 10, 7, 12, tzinfo=timezone.utc)

def calculate(rows):
    assert importlib.util.find_spec('backend.app.services.player_growth'), 'growth calculation is not implemented'
    from backend.app.services.player_growth import calculate_growth
    return calculate_growth(rows, NOW)

def row(id, question, result='CORRECT', days=0, hints=None, tags=None):
    return dict(id=id, trainingId=question, result=result, answeredAt=NOW-timedelta(days=days),
                hintLevelUsed=hints, tags=tags or ['VULNERABILITY'])

def test_empty_growth_and_account_http_require_login():
    growth=calculate([])
    assert growth['recent']['current']['completed']==0
    assert len(growth['daily'])==14
    assert all(t['remaining']==2 and t['accuracy'] is None for t in growth['themes'])
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=True)) as client:
        assert client.get('/api/v1/me/profile').status_code==401
        account=client.post('/api/v1/auth/device').json()['data']
        client.headers['Authorization']='Bearer '+account['token']
        assert client.get('/api/v1/me/profile').json()['data']['growth']['version']=='growth_v1'

def test_unique_completion_first_exposure_hint_and_periods():
    growth=calculate([row('a','q1','SUBOPTIMAL'),row('b','q1'),row('c','q1'),
        row('d','q2',hints=3),row('e','q3'),row('f','q4',days=8),row('g','old',days=40)])
    current=growth['recent']['current']
    assert current['completed']==3 and current['attempted']==3
    assert current['firstAttempts']==2 and current['firstCorrect']==1 and current['accuracy'] is None
    assert growth['recent']['previous']['completed']==1
    theme=next(t for t in growth['themes'] if t['theme']=='VULNERABILITY')
    assert theme['remaining']==0 and theme['completedThisWeek']==3
    assert theme['attempts']==3 and theme['correct']==2 and theme['accuracy']==67
    assert theme['recommendedDifficulty']=='EASY'

def test_shanghai_calendar_boundaries_future_rows_and_order_independence():
    midnight=NOW.replace(hour=16,minute=0)-timedelta(days=7)
    a=row('a','current'); a['answeredAt']=midnight
    b=row('b','previous'); b['answeredAt']=midnight-timedelta(microseconds=1)
    future=row('c','future');future['answeredAt']=NOW+timedelta(seconds=1)
    rows=[b,future,a]
    growth=calculate(rows)
    assert growth==calculate(list(reversed(rows)))
    assert growth['recent']['current']['completed']==1
    assert growth['recent']['previous']['completed']==1
    assert sum(day['completed'] for day in growth['daily'])==2

def test_sufficient_unhinted_samples_select_next_level_without_retries_boosting_accuracy():
    rows=[row(str(i),'q'+str(i),tags=['CAPTURE']) for i in range(3)]
    growth=calculate(rows)
    theme=next(t for t in growth['themes'] if t['theme']=='CAPTURE')
    assert theme['accuracy']==100 and theme['recommendedDifficulty']=='NORMAL'
    assert growth['recent']['current']['accuracy']==100

def test_recommended_level_uses_exact_ratio_instead_of_rounded_percentage():
    rows=[row(str(i),'q'+str(i),'CORRECT' if i<38 else 'SUBOPTIMAL',tags=['CAPTURE']) for i in range(51)]
    theme=calculate(rows)['themes'][0]
    assert theme['accuracy']==75 and theme['recommendedDifficulty']=='EASY'

def exercise_real_growth_answers(client):
    from uuid import uuid4
    first=client.post('/api/v1/auth/device').json()['data']
    second=client.post('/api/v1/auth/device').json()['data']
    client.headers['Authorization']='Bearer '+first['token']
    response=client.get('/api/v1/training?source=CURATED&theme=VULNERABILITY&limit=100')
    assert response.status_code==200, response.text
    questions=response.json()['data']['items'][:3]
    assert len(questions)==3
    for index, question in enumerate(questions):
        item=client.portal.call(client.app.state.store.get_training_item,question['id'])
        body={'from_node':item.bestMove.from_node,'to_node':item.bestMove.to_node,'client_attempt_id':uuid4().hex}
        answer=client.post('/api/v1/training/'+item.id+'/answer',json=body)
        assert answer.status_code==200 and answer.json()['data']['result']=='CORRECT',answer.text
        repeat=client.post('/api/v1/training/'+item.id+'/answer',json=body)
        assert repeat.json()['data']['id']==answer.json()['data']['id']
        growth=client.get('/api/v1/me/profile').json()['data']['growth']
        theme=growth['themes'][1]
        assert theme['completedThisWeek']==index+1 and theme['remaining']==max(0,1-index)
    assert theme['accuracy']==100 and theme['recommendedDifficulty']=='NORMAL'
    client.headers['Authorization']='Bearer '+second['token']
    empty=client.get('/api/v1/me/profile').json()['data']['growth']
    assert empty['recent']['current']['completed']==0
    assert all(t['attempts']==0 and t['remaining']==2 for t in empty['themes'])
    client.headers['Authorization']='Bearer '+first['token']
    return first['userId'],growth

def test_real_answers_advance_tasks_idempotently_and_isolate_two_accounts():
    with TestClient(create_app(store=InMemoryGameStore(),require_auth=True)) as client:
        exercise_real_growth_answers(client)
