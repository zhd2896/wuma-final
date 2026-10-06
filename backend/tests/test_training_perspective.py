"""Current review player scopes generation and answer-free lists."""
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.app.main import create_app
from backend.app.services.game_store import InMemoryGameStore
from backend.tests.test_training import finished_review


def exercise_player_list(client):
    game_id, _ = finished_review(client)
    all_questions = []
    for player in ('A', 'B'):
        reviewed = client.post(f'/api/v1/game/{game_id}/review', json={'reviewed_player': player})
        assert reviewed.status_code == 200, reviewed.text
        generated = client.post(f'/api/v1/game/{game_id}/training', json={'reviewed_player': player})
        assert generated.status_code == 200, generated.text
        questions = generated.json()['data']['items']
        assert questions and all(q['player'] == player for q in questions)
        all_questions.extend(questions)
    for player in ('A', 'B'):
        expected = {q['id'] for q in all_questions if q['player'] == player}
        seen = []
        for offset in range(len(expected)):
            page = client.get('/api/v1/training', params={'source': 'REVIEW', 'source_game_id': game_id,
                'player': player, 'limit': 1, 'offset': offset}).json()['data']
            assert page['total'] == len(expected)
            assert all(q['player'] == player for q in page['items'])
            seen.extend(q['id'] for q in page['items'])
        assert set(seen) == expected and len(seen) == len(expected)
    invalid = client.get('/api/v1/training?player=C')
    assert invalid.status_code == 422
    return game_id, all_questions


def test_player_filter_and_total_with_both_saved_views():
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=False)) as client:
        exercise_player_list(client)


def test_generate_legacy_mixed_review_only_own_sources_and_returned_items():
    store = InMemoryGameStore()
    with TestClient(create_app(store=store, require_auth=False)) as client:
        game_id, _ = finished_review(client)
        assert client.post(f'/api/v1/game/{game_id}/review', json={'reviewed_player': 'B'}).status_code == 200
        for player in ('A', 'B'):
            assert client.post(f'/api/v1/game/{game_id}/training', json={'reviewed_player': player}).status_code == 200
        a_key = next(key for key in store._reviews if key[0] == game_id and key[1] == 'A')
        b_review = next(r for r in store._reviews.values() if r.gameId == game_id and r.reviewedPlayer == 'B')
        a_review = store._reviews[a_key]
        store._reviews[a_key] = a_review.model_copy(update={'moveReviews': sorted(
            a_review.moveReviews + b_review.moveReviews, key=lambda row: row.turn)})
        submitted = []
        original = store.commit_training_items
        async def old_repository(review_id, items, user_id):
            submitted.extend(items)
            await original(review_id, items, user_id)
            return list(store._training_items.values())
        with patch.object(store, 'commit_training_items', side_effect=old_repository):
            response = client.post(f'/api/v1/game/{game_id}/training', json={'reviewed_player': 'A'})
        assert response.status_code == 200, response.text
        assert submitted and all(item.player == 'A' for item in submitted)
        data = response.json()['data']
        assert data['items'] and all(item['player'] == 'A' for item in data['items'])
        assert data['total'] == len(data['items'])
        assert any(item.player == 'B' for item in store._training_items.values())
