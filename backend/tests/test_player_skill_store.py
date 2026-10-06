"""Shared deterministic evidence on real Engine turns and both persistence stores."""
from datetime import UTC, datetime
from dataclasses import replace
from uuid import uuid4

from fastapi.testclient import TestClient
from pydantic import ValidationError
import pytest

from backend.app.main import create_app
from backend.app.schemas.game import GameOperationRequest, GameReview, Move, MoveReview, ReviewConfig
from backend.app.schemas.training import TrainingAnswerResult, TrainingItemInternal, TrainingDifficultyBasis
from backend.app.services.game_store import InMemoryGameStore
from backend.tests.test_training import MOVES


async def seed_skill_evidence(store, adapter):
    """Real persisted moves with controlled review judgments; no fake DB or aggregate mocks."""
    first = await store.register_device(uuid4().hex)
    second = await store.register_device(uuid4().hex)
    state = await adapter.initialize('A')
    template = None
    review_for_training = None
    for index, (owner, mode, ai, winner, kind) in enumerate([
        (first, 'AI', 'B', 'A', 'current'),
        (first, 'AI', 'A', 'B', 'current'),
        (first, 'AI', 'B', 'B', 'current'),
        (first, 'AI', 'A', 'A', 'old'),
        (first, 'AI', 'B', 'B', 'nohuman'),
        (first, 'AI', 'A', 'B', 'zero'),
        (first, 'LOCAL', None, 'A', 'current'),
        (first, 'REMOTE', None, 'A', 'current'),
        (second, 'AI', 'B', 'A', 'current'),
    ]):
        # REMOTE rows are set after creating real turns; room permission workflows are
        # covered separately. This fixture checks that mode alone excludes skill evidence.
        game_id = await store.create(state, 'LOCAL' if mode == 'REMOTE' else mode,
                                     ai, 'STANDARD' if ai else None, owner)
        current = state
        for ply, (source, target) in enumerate(MOVES[:0 if kind == 'zero' else 10]):
            turn = await adapter.execute_turn(current, Move(from_node=source, to_node=target))
            await store.commit_turn(game_id, ply, turn, 'HUMAN')
            current = turn.state
            if template is None:
                template = await adapter.review_move(turn.before_state, turn.state, turn.move,
                                                     ReviewConfig(max_depth=1))
        moves = await store.list_moves(game_id)
        await store.commit_resign(game_id, GameOperationRequest(
            expected_version=len(moves), client_request_id=f'skill-resign-{index:03d}'))
        snapshot = await store.get_snapshot(game_id)
        # Controlled outcome projections let the aggregation test cover both human seats
        # and victories without coupling the fixture to AI playing strength.
        finished = snapshot.state.model_copy(update={'winner': winner})
        if isinstance(store, InMemoryGameStore):
            store._games[game_id] = replace(snapshot, mode=mode, state=finished)
        else:
            from backend.app.db.models import GameModel
            with store.sessions.begin() as session:
                row = session.get(GameModel, game_id)
                row.mode, row.winner = mode, winner
                row.current_state = finished.model_dump(mode='json')
        human = 'B' if ai == 'A' else 'A'
        judgments = []
        human_index = 0
        for move in moves:
            player = move.turn.before_state.current_player
            if kind == 'nohuman' and player == human:
                continue
            loss = [0, 20, 60, 150, 0][human_index % 5] if player == human else 500
            category = {0: 'GOOD', 20: 'NORMAL', 60: 'MISTAKE', 150: 'BLUNDER', 500: 'BLUNDER'}[loss]
            if player == human:
                human_index += 1
            judgments.append(MoveReview(**(template.model_dump() | dict(
                gameMoveId=move.game_move_id, turn=move.turn_number, player=player,
                scorePerspective=player, actualMove=move.turn.move, bestMove=move.turn.move,
                bestScore=0, actualMoveScore=-loss, scoreLoss=loss, bestMoveEquivalent=loss == 0,
                category=category, stateBefore=move.turn.before_state))))
        version = ReviewConfig().version + 1 if kind == 'old' else ReviewConfig().version
        review = GameReview(id=uuid4().hex, gameId=game_id, reviewedPlayer=human,
            overallScore=None, goodMoves=0, normalMoves=0, mistakes=0, blunders=0,
            bestMoveRate=0, turningPoints=[], winner=winner, winnerReason='RESIGN',
            reviewConfig=ReviewConfig(version=version), reviewConfigVersion=version,
            moveReviews=judgments, createdAt=datetime.now(UTC))
        await store.commit_review(review, snapshot.version)
        assert (await store.commit_review(review, snapshot.version)).id == review.id
        if index == 0:
            review_for_training = review
            # AI-side review must never count as the account's personal review.
            ai_review = review.model_copy(update={'id': uuid4().hex, 'reviewedPlayer': ai})
            await store.commit_review(ai_review, snapshot.version)
    await store.create(state, 'AI', 'B', 'STANDARD', first)  # unfinished
    item = TrainingItemInternal(id=uuid4().hex, sourceKind='CURATED', player='A',
        stateSnapshot=state, stateSchemaVersion=1, bestMove=Move(from_node='P01', to_node='P19'),
        bestScore=0, trainingTags=[], scoringConfig=ReviewConfig(), reviewConfigVersion=1,
        scoringDepth=1, catalogVersion=1,
        difficultyBasis=TrainingDifficultyBasis(legalCandidateCount=2, scoringDepth=1, configVersion=1),
        createdAt=datetime.now(UTC))
    await store.commit_curated_items([item])
    private = item.model_copy(update={'id': uuid4().hex, 'sourceKind': 'REVIEW',
        'sourceGameId': review_for_training.gameId, 'sourceTurn': 1, 'sourceCategory': 'BLUNDER',
        'originalMove': item.bestMove})
    sources = await store.list_training_sources(review_for_training.id)
    wanted = next(m for m in review_for_training.moveReviews if m.player == 'A' and m.category == 'BLUNDER')
    source = next(s for s in sources if s.sourceMoveId == wanted.gameMoveId)
    private = private.model_copy(update={'sourceMoveId': source.sourceMoveId,
        'sourceMoveReviewId': source.sourceMoveReviewId, 'sourceTurn': wanted.turn,
        'stateSnapshot': source.stateSnapshot, 'originalMove': wanted.actualMove})
    await store.commit_training_items(review_for_training.id, [private], first)
    for index in range(6):
        correct = index < 4
        record = TrainingAnswerResult(id=uuid4().hex,
            trainingId=private.id if index == 0 else item.id, clientAttemptId=uuid4().hex,
            submittedMove=item.bestMove, bestMoveEquivalent=correct, bestMove=item.bestMove,
            bestScore=0, submittedMoveScore=0 if correct else -60, scoreLoss=0 if correct else 60,
            result='CORRECT' if correct else 'SUBOPTIMAL', feedback='test evidence',
            searchDepth=1, timedOut=False, answeredAt=datetime.now(UTC))
        await store.commit_training_record(record, first)
        assert (await store.commit_training_record(record, first)).id == record.id
    other = record.model_copy(update={'id': uuid4().hex, 'clientAttemptId': uuid4().hex,
                                     'result': 'CORRECT', 'bestMoveEquivalent': True, 'scoreLoss': 0})
    await store.commit_training_record(other, second)
    return first, second


async def exercise_skill_evidence(store, adapter):
    first, second = await seed_skill_evidence(store, adapter)
    profile = await store.personal_profile(first)
    from backend.app.schemas.account import PersonalProfileDto
    PersonalProfileDto.model_validate(profile)
    skill = profile['skillProfile']
    assert skill['evidence'] == dict(aiFinished=6, reviewedGames=3, reviewedMoves=15, trainingAttempts=6)
    assert {m['key']: m['value'] for m in skill['metrics']} == dict(
        performance=50, best_move=40, decision=77, stability=60, mistake_control=70, training=67)
    assert (skill['ready'], skill['overall'], skill['level'], skill['seal']) == (True, 61, '熟练', '熟')
    assert profile['training'] == 2 and profile['trainingAttempts'] == 6
    other = (await store.personal_profile(second))['skillProfile']
    assert other['evidence'] == dict(aiFinished=1, reviewedGames=1, reviewedMoves=5, trainingAttempts=1)
    assert all(m['value'] is None for m in other['metrics']) and other['seal'] == '待'
    return skill


def test_inmemory_filters_account_mode_version_human_and_actual_attempts():
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=False)) as client:
        client.portal.call(exercise_skill_evidence, client.app.state.store, client.app.state.adapter)


def test_skill_dto_requires_complete_fields_and_rejects_wrong_types():
    from backend.app.schemas.account import SkillProfileDto
    from backend.tests.test_player_skill import ready
    profile = ready()
    assert SkillProfileDto.model_validate(profile).overall == 66
    for key in profile:
        with pytest.raises(ValidationError):
            SkillProfileDto.model_validate({k: v for k, v in profile.items() if k != key})
    for bad in [profile | {'overall': True}, profile | {'overall': 101}, profile | {'ready': 'true'}]:
        with pytest.raises(ValidationError):
            SkillProfileDto.model_validate(bad)
