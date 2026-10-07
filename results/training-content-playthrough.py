"""Actual canonical engine + HTTP answer flow; explicitly not human difficulty calibration."""
import json
import time
from pathlib import Path
from fastapi.testclient import TestClient
from backend.app.main import create_app
from backend.app.services.game_store import InMemoryGameStore
from backend.app.services.training_lessons import LESSONS, lesson_for


def main():
    rows = []
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=True)) as client:
        token = client.post('/api/v1/auth/device').json()['data']['token']
        client.headers.update({'Authorization':'Bearer ' + token})
        started = time.perf_counter()
        listed = client.get('/api/v1/training?source=CURATED&limit=100')
        assert listed.status_code == 200, listed.text
        initialization_ms = round((time.perf_counter() - started) * 1000)
        for q in listed.json()['data']['items']:
            item = client.portal.call(client.app.state.store.get_training_item, q['id'])
            adapter = client.app.state.adapter
            legal = client.portal.call(adapter.legal_moves, item.stateSnapshot)
            analysis = client.portal.call(adapter.analyze_position, item.stateSnapshot, 2, 10000, len(legal))
            assert not analysis.timedOut and analysis.searchDepth == 2
            turn = client.portal.call(adapter.execute_turn, item.stateSnapshot, item.bestMove)
            worst = min(analysis.candidateMoves, key=lambda value:value.score)
            for kind, move in (('best', item.bestMove), ('worse', worst.move)):
                response = client.post(f'/api/v1/training/{item.id}/answer', json={
                    'from_node':move.from_node, 'to_node':move.to_node,
                    'client_attempt_id':f'content-play-{kind}-{item.id[:16]}'})
                assert response.status_code == 200, response.text
                assert response.json()['data']['result'] == ('CORRECT' if kind == 'best' else 'SUBOPTIMAL')
                if lesson_for(item.id):
                    assert response.json()['data']['lessonExplanation']
            calibration = client.get(f'/api/v1/training/{item.id}').json()['data']['difficultyCalibration']
            assert calibration['sampleCount'] == 1 and calibration['suggestedDifficulty'] is None
            rows.append(dict(id=item.id, title=item.title, level=item.difficultyTag,
                topics=item.trainingTags, legalMoves=len(legal), best=item.bestMove.model_dump(by_alias=True),
                captures=turn.capture.captured_nodes, bestScore=item.bestScore, worseScore=worst.score,
                bestAnswers=sum(c.score == item.bestScore for c in analysis.candidateMoves),
                bestResult='CORRECT', worseResult='SUBOPTIMAL', humanCalibrated=False))
        assert len(rows) == 3 + len(LESSONS)
    output = {'evidence':'CANONICAL_ENGINE_AND_HTTP_PLAYTHROUGH_NOT_HUMAN',
        'catalogInitializationMs':initialization_ms, 'total':len(rows), 'questions':rows}
    Path('results/training-content-playthrough.json').write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Verified {len(rows)} questions, {len(rows)*2} real HTTP answers; catalog {initialization_ms} ms. No human calibration claimed.')


if __name__ == '__main__': main()
