"""Versioned sparse positions, verified and scored only by the canonical Engine."""
import math
from datetime import datetime, timezone
from hashlib import md5

from backend.app.core.errors import ApiError
from backend.app.schemas.game import ReviewConfig
from backend.app.schemas.training import TrainingDifficultyBasis, TrainingItemInternal
from backend.app.services.training_lessons import LESSONS

CATALOG_VERSION = 1
# Published v1 items are immutable, including their scoring policy.
SCORING_CONFIG = ReviewConfig(version=1, max_depth=2, time_limit_ms_per_move=10000, candidate_limit=29)
# Each position contains legal alternatives. No game/review is fabricated.
POSITIONS = (
    ('capture-choice', '夹击与调度', {'P01': 'A', 'P02': 'B', 'P04': 'A', 'P29': 'B'}, 'A'),
    ('vulnerable-pair', '化解夹击', {'P01': 'B', 'P02': 'A', 'P04': 'B', 'P29': 'A'}, 'A'),
    ('lone-escape', '独子脱困', {'P03': 'B', 'P21': 'A', 'P25': 'A'}, 'B'),
)


def difficulty(candidate_count: int) -> str:
    return 'EASY' if candidate_count <= 6 else 'NORMAL' if candidate_count <= 12 else 'COMPLEX'


async def build_catalog(adapter) -> list[TrainingItemInternal]:
    items = []
    entries = [(key, title, pieces, player, None) for key, title, pieces, player in POSITIONS]
    entries.extend((lesson.key, lesson.title, lesson.pieces, lesson.player, lesson) for lesson in LESSONS)
    for key, title, pieces, player, lesson in entries:
        state = await adapter.initialize(player)
        state.board.occupancy = {node: pieces.get(node) for node in state.board.occupancy}
        legal = await adapter.legal_moves(state)
        analysis = await adapter.analyze_position(state, SCORING_CONFIG.max_depth,
            SCORING_CONFIG.time_limit_ms_per_move, len(legal), SCORING_CONFIG.version)
        if (len(legal) < 2 or analysis.terminal or analysis.timedOut or
                analysis.searchDepth != SCORING_CONFIG.max_depth or
                analysis.bestMove not in legal or not math.isfinite(analysis.bestScore) or
                analysis.scorePerspective != player or
                {candidate.move.model_dump_json() for candidate in analysis.candidateMoves} !=
                {move.model_dump_json() for move in legal} or
                any(not math.isfinite(candidate.score) for candidate in analysis.candidateMoves) or
                not any(candidate.score < analysis.bestScore for candidate in analysis.candidateMoves)):
            raise ApiError('TRAINING_SCORING_INCOMPLETE', 'Catalog position was not fully verified')
        turn = await adapter.execute_turn(state, analysis.bestMove)
        verified = await adapter.review_move(state, turn.state, analysis.bestMove, SCORING_CONFIG)
        if (verified.timedOut or verified.searchDepth != SCORING_CONFIG.max_depth or
                verified.bestMove != analysis.bestMove or verified.bestScore != analysis.bestScore or
                verified.actualMoveScore != analysis.bestScore):
            raise ApiError('TRAINING_SCORING_INCOMPLETE', 'Catalog scoring configurations differ')
        if lesson:
            await verify_lesson_theme(adapter, state, turn, lesson.theme)
        items.append(TrainingItemInternal(
            id=lesson.id if lesson else md5(f'wuma-curated-v{CATALOG_VERSION}-{key}'.encode()).hexdigest(),
            sourceKind='CURATED', title=title, catalogVersion=lesson.version if lesson else CATALOG_VERSION,
            player=player, stateSnapshot=state, stateSchemaVersion=1,
            bestMove=analysis.bestMove, bestScore=analysis.bestScore,
            trainingTags=[lesson.theme, 'ENDGAME'] if lesson else ['ENDGAME'],
            difficultyTag=lesson.difficulty if lesson else difficulty(len(legal)),
            difficultyBasis=TrainingDifficultyBasis(kind='LESSON_DESIGN' if lesson else 'ENGINE_ESTIMATE',
                legalCandidateCount=len(legal),
                scoringDepth=SCORING_CONFIG.max_depth, configVersion=SCORING_CONFIG.version),
            scoringConfig=SCORING_CONFIG.model_copy(deep=True), reviewConfigVersion=SCORING_CONFIG.version,
            scoringDepth=SCORING_CONFIG.max_depth, createdAt=datetime(2026, 10, 6, tzinfo=timezone.utc)))
    return items


async def verify_lesson_theme(adapter, state, turn, theme):
    """Reject a mislabeled position rather than publish a misleading teaching goal."""
    if theme == 'CAPTURE':
        valid = bool(turn.capture.captured_nodes)
    elif theme == 'LONE_PIECE_RISK':
        valid = sum(owner == state.current_player for owner in state.board.occupancy.values()) == 1
    else:
        opponent = 'B' if state.current_player == 'A' else 'A'
        before = state.model_copy(deep=True, update={'current_player': opponent})
        async def maximum_capture(position):
            moves = await adapter.legal_moves(position)
            counts = [len((await adapter.execute_turn(position, move)).capture.captured_nodes) for move in moves]
            return max(counts, default=0)
        valid = await maximum_capture(before) > 0 and not turn.game_over and await maximum_capture(turn.state) == 0
    if not valid:
        raise ApiError('TRAINING_SCORING_INCOMPLETE', 'Catalog theme does not match verified play')
