"""Canonical local-score import through the real HTTP service and engine."""
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi.testclient import TestClient
from backend.app.main import create_app
from backend.app.services.game_store import InMemoryGameStore
from backend.tests.test_wechat_auth import FakeWechat, login

@pytest.fixture
def client():
    app = create_app(store=InMemoryGameStore())
    with TestClient(app) as client:
        app.state.wechat_auth = FakeWechat()
        account = login(client).json()['data']
        client.headers['Authorization'] = 'Bearer ' + account['token']
        yield client

def payload(**updates):
    return {'clientGameId': 'local-score-001', 'firstPlayer': 'A',
            'moves': [{'from': 'P01', 'to': 'P02'}, {'from': 'P05', 'to': 'P04'}],
            'resigningPlayer': None, **updates}

def test_canonical_import_idempotency_resign_and_cloud_continuation(client):
    body = payload(resigningPlayer='A')
    response = client.post('/api/v1/game/import-local',json=body)
    assert response.status_code == 200, response.text
    game = response.json()['data']
    assert game['mode'] == 'LOCAL' and game['version'] == 3 and game['ply_count'] == 2
    assert game['state']['winner'] == 'B' and game['state']['winner_reason'] == 'RESIGN'
    retry = client.post('/api/v1/game/import-local',json=body)
    assert retry.json()['data'] == game
    assert client.post('/api/v1/game/import-local',json=payload()).json()['code'] == 'LOCAL_IMPORT_CONFLICT'
    review = client.post(f"/api/v1/game/{game['game_id']}/review",json={})
    assert review.status_code == 200, review.text
    training = client.post(f"/api/v1/game/{game['game_id']}/training",json={})
    assert training.status_code == 200, training.text
    playing = client.post('/api/v1/game/import-local',json=payload(clientGameId='local-playing-1')).json()['data']
    assert client.post(f"/api/v1/game/{playing['game_id']}/move",json={'from_node':'P02','to_node':'P01'}).status_code == 200

@pytest.mark.parametrize('update',[
 {'moves':[{'from':'P99','to':'P02'}]}, {'moves':[{'from':'P05','to':'P04'}]},
 {'resigningPlayer':'B'}, {'moves':[{'from':'P01','to':'P02','winner':'A'}]},
 {'moves':[{'from':'P01','to':'P02'}]*2049}, {'clientGameId':'bad'}, {'state':{}}, {'userId':'other'},
])
def test_rejects_untrusted_or_illegal_score_without_partial_rows(client,update):
    r = client.post('/api/v1/game/import-local',json=payload(**update))
    assert r.status_code in (400,409,422), r.text
    assert client.get('/api/v1/me/profile').json()['data']['games'] == 0
    assert not client.app.state.store._moves and not client.app.state.store._terminal_events

def test_empty_scores_case_sensitive_keys_two_owners_and_concurrent_retry(client):
    body=payload(moves=[])
    with ThreadPoolExecutor(max_workers=4) as pool:
        rs=list(pool.map(lambda _:client.post('/api/v1/game/import-local',json=body),range(4)))
    assert all(r.status_code == 200 for r in rs), [r.text for r in rs]
    ids={r.json()['data']['game_id'] for r in rs}; assert len(ids)==1
    upper=client.post('/api/v1/game/import-local',json=payload(clientGameId='LOCAL-score-001',moves=[])).json()['data']
    assert upper['game_id'] not in ids
    resigned=client.post('/api/v1/game/import-local',json=payload(clientGameId='empty-resign-1',moves=[],resigningPlayer='A')).json()['data']
    assert resigned['version']==1 and resigned['ply_count']==0
    bob=login(client,'bob').json()['data']; client.headers['Authorization']='Bearer '+bob['token']
    second=client.post('/api/v1/game/import-local',json=body).json()['data']
    assert second['game_id'] not in ids

def test_natural_terminal_replay_rejects_extra_move_and_resign(client):
    from backend.tests.test_training import MOVES
    moves=[{'from':a,'to':b} for a,b in MOVES]
    r=client.post('/api/v1/game/import-local',json=payload(moves=moves))
    assert r.status_code==200, r.text
    g=r.json()['data']; assert g['state']['game_status']=='FINISHED'
    assert g['version']==g['ply_count']==len(moves)
    assert client.post('/api/v1/game/import-local',json=payload(clientGameId='after-terminal',moves=moves+[{'from':'P01','to':'P02'}])).status_code==409
    assert client.post('/api/v1/game/import-local',json=payload(clientGameId='resign-terminal',moves=moves,resigningPlayer='A')).status_code==409
    assert client.get('/api/v1/me/profile').json()['data']['games']==1

@pytest.mark.parametrize('conflict',[False,True])
def test_import_key_account_migration_is_atomic_and_retired_owner_cannot_write(client,conflict):
    from backend.app.schemas.game import LocalImportRequest
    from backend.app.core.errors import ApiError
    target=client.get('/api/v1/me/profile').json()['data']['id']
    if conflict:
        target_game=client.post('/api/v1/game/import-local',json=payload()).json()['data']['game_id']
    old=client.post('/api/v1/auth/device').json()['data']
    client.headers['Authorization']='Bearer '+old['token']
    source_game=client.post('/api/v1/game/import-local',json=payload()).json()['data']['game_id']
    migrated=login(client,device_token=old['token'])
    if conflict:
        assert migrated.status_code==409 and migrated.json()['code']=='LOCAL_IMPORT_ACCOUNT_CONFLICT'
        assert client.get(f'/api/v1/game/{source_game}').status_code==200
        assert client.app.state.store._games[target_game].user_id==target
        assert client.app.state.store._games[source_game].user_id==old['userId']
    else:
        assert migrated.status_code==200
        assert client.get(f'/api/v1/game/{source_game}').status_code==401
        client.headers['Authorization']='Bearer '+migrated.json()['data']['token']
        assert client.post('/api/v1/game/import-local',json=payload()).json()['data']['game_id']==source_game
        with pytest.raises(ApiError,match='AUTH_INVALID'):
            client.portal.call(client.app.state.service.import_local,LocalImportRequest.model_validate(payload(clientGameId='retired-import')),old['userId'])

def test_reusing_committed_key_with_different_illegal_payload_is_explicit_conflict(client):
    original=client.post('/api/v1/game/import-local',json=payload());assert original.status_code==200
    response=client.post('/api/v1/game/import-local',json=payload(moves=[{'from':'P05','to':'P04'}]))
    assert response.status_code==409 and response.json()['code']=='LOCAL_IMPORT_CONFLICT'
    assert client.get('/api/v1/me/profile').json()['data']['games']==1

def test_import_requires_auth_and_preserves_second_first_player(client):
    from_node={'from':'P05','to':'P04'}
    r=client.post('/api/v1/game/import-local',json=payload(firstPlayer='B',moves=[from_node],resigningPlayer='A'))
    assert r.status_code==200,r.text
    g=r.json()['data'];assert g['state']['first_player']=='B' and g['state']['current_player']=='A'
    assert g['state']['winner']=='B' and g['version']==2 and g['ply_count']==1
    client.headers.pop('Authorization')
    assert client.post('/api/v1/game/import-local',json=payload(moves=[])).status_code==401
