"""Account-bound online learning uses canonical facts and private seat questions."""
from fastapi.testclient import TestClient
from backend.app.main import create_app
from backend.app.services.game_store import InMemoryGameStore
from backend.tests.test_remote_accounts import account, room
from backend.tests.test_training import MOVES
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
import pytest
from backend.app.core.errors import ApiError


def test_private_question_owner_is_persisted_without_public_owner_field():
    from backend.app.db.models import TrainingItemModel
    from backend.app.schemas.training import TrainingQuestion
    assert 'user_id' in TrainingItemModel.__table__.columns
    assert TrainingItemModel.__table__.columns.user_id.nullable
    assert 'user_id' not in TrainingQuestion.model_fields and 'userId' not in TrainingQuestion.model_fields


def playing(client):
    a, b, c = account(client), account(client), account(client)
    host = room(client, a)
    guest = client.post('/api/v1/remote/join', headers=b, json={
        'device_id': 'guest-device-456', 'invite_code': host['invite_code']}).json()['data']
    return host, [{**a, 'X-Room-Token': host['token']}, {**b, 'X-Room-Token': guest['token']}], c


def finished(client):
    host, seats, stranger = playing(client)
    path = '/api/v1/remote/rooms/' + host['game_id']
    for version, (source, target) in enumerate(MOVES):
        response = client.post(path + '/move', headers=seats[version % 2], json={
            'from_node': source, 'to_node': target, 'expected_version': version,
            'client_request_id': f'learning-move-{version:03}'})
        assert response.status_code == 200, response.text
    return host, seats, stranger


def test_online_analysis_uses_room_version_and_terminal_state():
    with TestClient(create_app(store=InMemoryGameStore())) as client:
        host, seats, stranger = playing(client)
        path = '/api/v1/remote/rooms/' + host['game_id']
        response = client.post(path + '/analyze', headers=seats[0], json={'expected_version': 0})
        assert response.status_code == 200, response.text
        assert response.json()['data']['game_version'] == 0
        assert client.post(path + '/analyze', headers=seats[0], json={'expected_version': 5}).json()['code'] == 'GAME_STATE_CONFLICT'
        for headers in [stranger, {**stranger, 'X-Room-Token': host['token']},
                        {**seats[1], 'X-Room-Token': host['token']}]:
            assert client.post(path + '/analyze', headers=headers, json={'expected_version': 0}).status_code == 403
        assert client.post(path + '/resign', headers=seats[1], json={
            'expected_version': 0, 'client_request_id': 'learning-resign-001'}).status_code == 200
        terminal = client.post(path + '/analyze', headers=seats[0], json={'expected_version': 1})
        assert terminal.status_code == 200, terminal.text
        assert terminal.json()['data']['terminal'] and terminal.json()['data']['candidateMoves'] == []
        assert client.post('/api/v1/ai/analyze', headers=seats[0], json={'game_id': host['game_id']}).json()['code'] == 'REMOTE_ACTION_REQUIRED'


def test_both_seats_explain_and_generate_private_training_with_hidden_answers():
    with TestClient(create_app(store=InMemoryGameStore())) as client:
        host, seats, stranger = finished(client)
        path = '/api/v1/remote/rooms/' + host['game_id']
        generated = []
        for index, headers in enumerate(seats):
            review = client.post(path + '/review', headers=headers, json={}).json()['data']
            explained = client.post(path + '/review/explain', headers=headers, json={})
            assert explained.status_code == 200, explained.text
            payload = explained.json()['data']
            assert payload['review'] == review and payload['explanation']['gameExplanation']['fallbackUsed']
            assert client.get(path + '/review/explanation', headers=headers).json()['data'] == payload
            questions = client.post(path + '/training', headers=headers, json={})
            assert questions.status_code == 200, questions.text
            data = questions.json()['data']
            assert data['total'] == sum(m['category'] in ('MISTAKE', 'BLUNDER') for m in review['moveReviews'])
            assert all(q['player'] == ('A' if index == 0 else 'B') for q in data['items'])
            assert client.post(path + '/training', headers=headers, json={}).json()['data'] == data
            assert 'bestMove' not in questions.text and 'bestScore' not in questions.text and 'userId' not in questions.text
            listed = client.get('/api/v1/training', headers=headers, params={'source_game_id': host['game_id'], 'player': review['reviewedPlayer']}).json()['data']
            assert listed['total'] == data['total']
            generated.append(data['items'])
            for q in data['items']:
                assert client.get('/api/v1/training/' + q['id'], headers=headers).status_code == 200
                for other in [seats[1-index], stranger]:
                    assert client.get('/api/v1/training/' + q['id'], headers=other).status_code == 403
                    assert client.get('/api/v1/training/' + q['id'] + '/legal-moves', headers=other).status_code == 403
                    assert client.post('/api/v1/training/' + q['id'] + '/answer', headers=other, json={
                        'from_node': 'P01', 'to_node': 'P02', 'client_attempt_id': 'forbidden-answer-' + q['id']}).status_code == 403
                internal = client.portal.call(client.app.state.store.get_training_item, q['id'])
                result = client.post('/api/v1/training/' + q['id'] + '/answer', headers=headers, json={
                    'from_node': internal.bestMove.from_node, 'to_node': internal.bestMove.to_node,
                    'client_attempt_id': 'learning-answer-' + q['id']})
                assert result.status_code == 200, result.text
                assert result.json()['data']['result'] == 'CORRECT'
                assert client.get('/api/v1/training/' + q['id'], headers=headers).json()['data']['progress']['completed']
            assert client.get('/api/v1/training', headers=seats[1-index], params={'source_game_id': host['game_id'], 'player': review['reviewedPlayer']}).json()['data']['total'] == 0
        assert any(generated)
        assert client.get('/api/v1/training', headers=stranger, params={'source_game_id': host['game_id']}).json()['data']['total'] == 0


def test_explicit_unauthenticated_learning_supports_terminal_empty_review_and_no_questions():
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=False)) as client:
        host = room(client, {})
        guest = client.post('/api/v1/remote/join', json={'device_id': 'guest-device-123', 'invite_code': host['invite_code']}).json()['data']
        path = '/api/v1/remote/rooms/' + host['game_id']; headers = {'X-Room-Token': host['token']}
        assert client.post(path + '/analyze', headers=headers, json={'expected_version': 0}).status_code == 200
        client.post(path + '/resign', headers={'X-Room-Token': guest['token']}, json={
            'expected_version': 0, 'client_request_id': 'unauth-learning-resign'})
        reviewed = client.post(path + '/review', headers=headers, json={})
        assert reviewed.status_code == 200 and reviewed.json()['data']['moveReviews'] == []
        explained = client.post(path + '/review/explain', headers=headers, json={})
        assert explained.status_code == 200 and explained.json()['data']['explanation']['gameExplanation']['fallbackUsed']
        assert client.post(path + '/training', headers=headers, json={}).json()['data'] == {'items': [], 'total': 0}


def test_waiting_cancelled_and_unclaimed_learning_rejected():
    store = InMemoryGameStore()
    with TestClient(create_app(store=store)) as client:
        a = account(client)
        host = room(client, a)
        headers = {**a, 'X-Room-Token': host['token']}
        path = '/api/v1/remote/rooms/' + host['game_id']
        assert client.post(path + '/analyze', headers=headers, json={'expected_version': 0}).json()['code'] == 'REMOTE_ROOM_UNAVAILABLE'
        client.post(path + '/cancel', headers=headers, json={})
        assert client.post(path + '/analyze', headers=headers, json={'expected_version': 0}).json()['code'] == 'REMOTE_ROOM_UNAVAILABLE'
    with TestClient(create_app(store=store, require_auth=False)) as client:
        legacy = room(client, {})
    with TestClient(create_app(store=store)) as client:
        a = account(client)
        for suffix, method in [('/analyze', 'post'), ('/review/explain', 'post'), ('/review/explanation', 'get'), ('/training', 'post')]:
            response = client.request(method, '/api/v1/remote/rooms/' + legacy['game_id'] + suffix,
                headers={**a, 'X-Room-Token': legacy['token']}, json={'expected_version': 0} if suffix == '/analyze' else None)
            assert response.status_code == 403, response.text


@pytest.mark.parametrize('change', ['token', 'version', 'merge'])
def test_analysis_revalidates_after_worker_and_never_saves_stale_actor(change):
    store = InMemoryGameStore()
    with TestClient(create_app(store=store)) as client:
        host, seats, _ = playing(client)
        game_id = host['game_id']
        adapter = client.app.state.adapter
        original = adapter.analyze_position
        before = len(store._analyses.get(game_id, []))
        async def delayed(*args):
            result = await original(*args)
            if change == 'token':
                room = await store.get_remote_room(game_id)
                await store.recover_remote_room(game_id, room.host_user_id, 'rotated')
            elif change == 'version':
                snapshot = await store.get_snapshot(game_id)
                store._games[game_id] = replace(snapshot, version=snapshot.version + 1)
            else:
                from backend.app.api.v1.account import _token_hash
                target = await store.login_wechat('existing-identity', 'target-session', datetime.now(timezone.utc) + timedelta(days=1))
                await store.login_wechat('existing-identity', 'merged-session', datetime.now(timezone.utc) + timedelta(days=1),
                    _token_hash(seats[0]['Authorization'][7:]))
                assert (await store.get_remote_room(game_id)).host_user_id == target
            return result
        with patch.object(adapter, 'analyze_position', delayed):
            response = client.post('/api/v1/remote/rooms/' + game_id + '/analyze', headers=seats[0], json={'expected_version': 0})
        assert response.status_code in (401, 403, 409), response.text
        assert len(store._analyses.get(game_id, [])) == before


def test_analysis_revalidates_same_version_after_final_commit():
    store = InMemoryGameStore()
    with TestClient(create_app(store=store)) as client:
        host, seats, _ = playing(client)
        original = store.commit_analysis
        async def changed_after_save(*args, **kwargs):
            await original(*args, **kwargs)
            snapshot = await store.get_snapshot(host['game_id'])
            store._games[host['game_id']] = replace(snapshot, version=snapshot.version + 1)
        with patch.object(store, 'commit_analysis', changed_after_save):
            response = client.post('/api/v1/remote/rooms/' + host['game_id'] + '/analyze', headers=seats[0], json={'expected_version': 0})
        assert response.json()['code'] == 'GAME_STATE_CONFLICT', response.text


@pytest.mark.parametrize('cached', [False, True])
def test_explanation_final_permission_checks_cover_llm_wait_and_cached_reads(cached):
    store = InMemoryGameStore()
    with TestClient(create_app(store=store)) as client:
        host, seats, _ = playing(client)
        path = '/api/v1/remote/rooms/' + host['game_id']
        client.post(path + '/resign', headers=seats[1], json={'expected_version': 0, 'client_request_id': 'explain-race-resign'})
        client.post(path + '/review', headers=seats[0], json={})
        if cached:
            assert client.post(path + '/review/explain', headers=seats[0], json={}).status_code == 200
            original = store.get_explanation
            async def changed(*args):
                result = await original(*args)
                owner = (await store.get_remote_room(host['game_id'])).host_user_id
                await store.recover_remote_room(host['game_id'], owner, 'rotated')
                return result
            target, name = store, 'get_explanation'
        else:
            original = client.app.state.explanation_service._game
            async def changed(*args):
                result = await original(*args)
                owner = (await store.get_remote_room(host['game_id'])).host_user_id
                await store.recover_remote_room(host['game_id'], owner, 'rotated')
                return result
            target, name = client.app.state.explanation_service, '_game'
        with patch.object(target, name, changed):
            response = client.post(path + '/review/explain', headers=seats[0], json={})
        assert response.status_code == 403, response.text
        if not cached:
            assert not store._explanations


def test_generation_final_transaction_checks_token_even_for_empty_items():
    store = InMemoryGameStore()
    with TestClient(create_app(store=store)) as client:
        host, seats, _ = playing(client)
        path = '/api/v1/remote/rooms/' + host['game_id']
        client.post(path + '/resign', headers=seats[1], json={'expected_version': 0, 'client_request_id': 'generation-race-resign'})
        client.post(path + '/review', headers=seats[0], json={})
        original = store.list_training_sources
        async def changed(*args):
            result = await original(*args)
            owner = (await store.get_remote_room(host['game_id'])).host_user_id
            await store.recover_remote_room(host['game_id'], owner, 'rotated')
            return result
        with patch.object(store, 'list_training_sources', changed):
            response = client.post(path + '/training', headers=seats[0], json={})
        assert response.status_code == 403, response.text
        assert not store._training_items


def test_private_question_merge_transfers_owner_and_rejects_retired_inflight_answer():
    store = InMemoryGameStore()
    with TestClient(create_app(store=store)) as client:
        host, seats, stranger = finished(client)
        path = '/api/v1/remote/rooms/' + host['game_id']
        client.post(path + '/review', headers=seats[0], json={})
        questions = client.post(path + '/training', headers=seats[0], json={}).json()['data']['items']
        assert questions
        q = questions[0]
        item = client.portal.call(store.get_training_item, q['id'])
        adapter = client.app.state.adapter
        original = adapter.review_move
        from backend.app.api.v1.account import _token_hash
        expires = datetime.now(timezone.utc) + timedelta(days=1)
        target = client.portal.call(store.login_wechat, 'target-account', _token_hash('c' * 64), expires)
        async def changed(*args):
            result = await original(*args)
            await store.login_wechat('target-account', _token_hash('d' * 64), expires, _token_hash(seats[0]['Authorization'][7:]))
            return result
        body = {'from_node': item.bestMove.from_node, 'to_node': item.bestMove.to_node, 'client_attempt_id': 'retired-remote-answer'}
        with patch.object(adapter, 'review_move', changed):
            response = client.post('/api/v1/training/' + q['id'] + '/answer', headers=seats[0], json=body)
        assert response.json()['code'] == 'AUTH_INVALID', response.text
        headers = {'Authorization': 'Bearer ' + 'd' * 64}
        assert client.get('/api/v1/training/' + q['id'], headers=headers).status_code == 200
        assert client.get('/api/v1/training', headers=headers, params={'source_game_id': host['game_id']}).json()['data']['total'] == len(questions)
        assert client.post('/api/v1/training/' + q['id'] + '/answer', headers=headers, json=body).status_code == 200
        assert client.get('/api/v1/me/profile', headers=headers).json()['data']['trainingAttempts'] == 1
        assert client.get('/api/v1/training/' + q['id'], headers=stranger).status_code == 403


def test_cached_answer_also_rejects_owner_merge_before_return():
    store = InMemoryGameStore()
    with TestClient(create_app(store=store)) as client:
        host, seats, _ = finished(client)
        path = '/api/v1/remote/rooms/' + host['game_id']
        client.post(path + '/review', headers=seats[0], json={})
        q = client.post(path + '/training', headers=seats[0], json={}).json()['data']['items'][0]
        item = client.portal.call(store.get_training_item, q['id'])
        body = {'from_node': item.bestMove.from_node, 'to_node': item.bestMove.to_node, 'client_attempt_id': 'cached-remote-answer'}
        assert client.post('/api/v1/training/' + q['id'] + '/answer', headers=seats[0], json=body).status_code == 200
        from backend.app.api.v1.account import _token_hash
        expires = datetime.now(timezone.utc) + timedelta(days=1)
        client.portal.call(store.login_wechat, 'target-account', 'target-token', expires)
        original = store.get_training_attempt
        async def changed(*args):
            result = await original(*args)
            await store.login_wechat('target-account', 'merged-token', expires, _token_hash(seats[0]['Authorization'][7:]))
            return result
        with patch.object(store, 'get_training_attempt', changed):
            response = client.post('/api/v1/training/' + q['id'] + '/answer', headers=seats[0], json=body)
        assert response.json()['code'] == 'AUTH_INVALID', response.text


@pytest.mark.parametrize('read', ['legal', 'get', 'list', 'count'])
def test_private_training_reads_recheck_active_owner_after_async_work(read):
    store = InMemoryGameStore()
    with TestClient(create_app(store=store)) as client:
        host, seats, _ = finished(client)
        path = '/api/v1/remote/rooms/' + host['game_id']
        client.post(path + '/review', headers=seats[0], json={})
        q = client.post(path + '/training', headers=seats[0], json={}).json()['data']['items'][0]
        from backend.app.api.v1.account import _token_hash
        expires = datetime.now(timezone.utc) + timedelta(days=1)
        client.portal.call(store.login_wechat, 'read-target', 'target-token', expires)
        if read == 'legal':
            target, name = client.app.state.adapter, 'legal_moves'
        elif read == 'count':
            target, name = store, 'list_training_items'
        else:
            target, name = store, 'training_progress'
        original = getattr(target, name); merged = False
        async def changed(*args):
            nonlocal merged
            result = await original(*args)
            if not merged:
                merged = True
                await store.login_wechat('read-target', 'merged-token', expires, _token_hash(seats[0]['Authorization'][7:]))
            return result
        with patch.object(target, name, changed):
            endpoint = '/api/v1/training/' + q['id'] + ('/legal-moves' if read == 'legal' else '')
            if read in ('list', 'count'):
                endpoint = '/api/v1/training?source_game_id=' + host['game_id'] + ('&offset=100' if read == 'count' else '')
            response = client.get(endpoint, headers=seats[0])
        assert response.json()['code'] == 'AUTH_INVALID', response.text
