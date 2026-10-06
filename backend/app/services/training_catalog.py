"""Versioned sparse positions, verified and scored only by the canonical Engine."""
import math
from datetime import datetime, timezone
from hashlib import md5

from backend.app.core.errors import ApiError
from backend.app.schemas.game import ReviewConfig
from backend.app.schemas.training import TrainingDifficultyBasis, TrainingItemInternal

CATALOG_VERSION = 1
SCORING_CONFIG = ReviewConfig(max_depth=2, time_limit_ms_per_move=10000, candidate_limit=29)
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
    for key, title, pieces, player in POSITIONS:
        state = await adapter.initialize(player)
        state.board.occupancy = {node: pieces.get(node) for node in state.board.occupancy}
        legal = await adapter.legal_moves(state)
        analysis = await adapter.analyze_position(state, SCORING_CONFIG.max_depth,
            SCORING_CONFIG.time_limit_ms_per_move, len(legal))
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
        items.append(TrainingItemInternal(
            id=md5(f'wuma-curated-v{CATALOG_VERSION}-{key}'.encode()).hexdigest(),
            sourceKind='CURATED', title=title, catalogVersion=CATALOG_VERSION,
            player=player, stateSnapshot=state, stateSchemaVersion=1,
            bestMove=analysis.bestMove, bestScore=analysis.bestScore,
            trainingTags=['ENDGAME'], difficultyTag=difficulty(len(legal)),
            difficultyBasis=TrainingDifficultyBasis(legalCandidateCount=len(legal),
                scoringDepth=SCORING_CONFIG.max_depth, configVersion=SCORING_CONFIG.version),
            scoringConfig=SCORING_CONFIG.model_copy(deep=True), reviewConfigVersion=SCORING_CONFIG.version,
            scoringDepth=SCORING_CONFIG.max_depth, createdAt=datetime(2026, 10, 6, tzinfo=timezone.utc)))
    return items
