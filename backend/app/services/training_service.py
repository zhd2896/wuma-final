"""Historical training from immutable reviewed turns and canonical Engine scores."""

import math
import asyncio
from datetime import datetime, timezone
from uuid import uuid4

from backend.app.core.errors import ApiError
from backend.app.schemas.game import Move
from backend.app.schemas.training import (
    TrainingAnswerRequest, TrainingAnswerResult, TrainingItemInternal,
    TrainingLegalMoves, TrainingList, TrainingQuestion,
)
from backend.app.services.game_service import GameService
from backend.app.services.game_store import GameStore
from backend.app.services.training_catalog import build_catalog


THREAT_TAGS = {
    "CAPTURE_AVAILABLE": "CAPTURE",
    "IMMEDIATE_WIN_AVAILABLE": "IMMEDIATE_WIN",
    "LONE_PIECE_MOBILITY_RISK": "LONE_PIECE_RISK",
    "VULNERABILITY": "VULNERABILITY",
}
SCORE_TOLERANCE = 1e-9
GENERATION_VERSION = 1


class TrainingService:
    def __init__(self, games: GameService, store: GameStore):
        self.games = games
        self.store = store
        self._catalog_lock = asyncio.Lock()
        self._catalog_loaded = False

    async def ensure_catalog(self) -> None:
        async with self._catalog_lock:
            if not self._catalog_loaded:
                await self.store.commit_curated_items(await build_catalog(self.games.adapter))
                self._catalog_loaded = True

    async def question(self, item, user_id):
        question = TrainingQuestion.from_item(item)
        question.progress = await self.store.training_progress(item.id, user_id)
        return question

    async def generate(self, game_id: str, reviewed_player: str | None = None,
                       user_id: str | None = None) -> TrainingList:
        snapshot = await self.store.get_snapshot(game_id)
        if snapshot.state.game_status != "FINISHED":
            raise ApiError("GAME_NOT_FINISHED", "Training requires a finished reviewed game")
        try:
            review = await self.games.get_review(game_id, reviewed_player)
        except ApiError as exc:
            if exc.code == "REVIEW_NOT_FOUND":
                raise ApiError("REVIEW_REQUIRED", "Generate a game review first") from exc
            raise
        sources = {source.sourceMoveId: source
                   for source in await self.store.list_training_sources(review.id)}
        items = []
        for move in review.moveReviews:
            if move.player != review.reviewedPlayer or move.category not in ("MISTAKE", "BLUNDER"):
                continue
            source = sources.get(move.gameMoveId)
            if (source is None or source.stateSnapshot.game_status != "PLAYING" or
                source.stateSnapshot.current_player != move.player or
                source.originalMove != move.actualMove or move.searchDepth < 1):
                raise ApiError("REPLAY_INTEGRITY_ERROR", "Reviewed training source is inconsistent")
            tags = list(dict.fromkeys(THREAT_TAGS[threat.type] for threat in move.threatsBefore
                                     if threat.type in THREAT_TAGS)) or ["GENERAL"]
            scoring_config = review.reviewConfig.model_copy(update={
                "max_depth": move.searchDepth,
                "time_limit_ms_per_move": max(10000, review.reviewConfig.time_limit_ms_per_move),
            })
            items.append(TrainingItemInternal(
                id=uuid4().hex, sourceGameId=game_id, sourceMoveId=move.gameMoveId,
                sourceMoveReviewId=source.sourceMoveReviewId, sourceTurn=move.turn,
                player=move.player, stateSnapshot=source.stateSnapshot,
                stateSchemaVersion=source.stateSchemaVersion,
                originalMove=move.actualMove, bestMove=move.bestMove,
                bestScore=move.bestScore, sourceCategory=move.category,
                sourceScoreLoss=move.scoreLoss, trainingTags=tags,
                scoringConfig=scoring_config, scoringDepth=move.searchDepth,
                reviewConfigVersion=review.reviewConfigVersion,
                generationVersion=GENERATION_VERSION, createdAt=datetime.now(timezone.utc),
            ))
        saved = await self.store.commit_training_items(review.id, items, user_id)
        public = [await self.question(item, user_id) for item in saved
                  if item.player == review.reviewedPlayer]
        return TrainingList(items=public, total=len(public))

    async def list(self, limit: int, offset: int, category: str | None,
                   training_type: str | None,
                   user_id: str | None = None, source: str = 'REVIEW',
                   difficulty: str | None = None, completed: bool | None = None,
                   source_game_id: str | None = None, player: str | None = None) -> TrainingList:
        if source == 'CURATED':
            await self.ensure_catalog()
        items, total = await self.store.list_training_items(limit, offset, category, training_type,
            user_id, source, difficulty, completed, source_game_id, player)
        return TrainingList(items=[await self.question(item, user_id) for item in items], total=total)

    async def get(self, training_id: str, user_id: str | None = None) -> TrainingQuestion:
        return await self.question(await self.store.get_training_item(training_id), user_id)

    async def legal_moves(self, training_id: str, from_node: str | None) -> TrainingLegalMoves:
        item = await self.store.get_training_item(training_id)
        moves = await self.games.adapter.legal_moves(item.stateSnapshot)
        if from_node:
            moves = [move for move in moves if move.from_node == from_node]
        return TrainingLegalMoves(moves=moves)

    async def answer(self, training_id: str,
                     request: TrainingAnswerRequest,
                     user_id: str | None = None) -> TrainingAnswerResult:
        item = await self.store.get_training_item(training_id)
        submitted = Move(from_node=request.from_node, to_node=request.to_node)
        existing = await self.store.get_training_attempt(request.client_attempt_id, user_id)
        if existing is not None:
            if existing.trainingId != training_id or existing.submittedMove != submitted:
                raise ApiError("TRAINING_ATTEMPT_CONFLICT", "Attempt ID already used for another answer")
            return existing
        try:
            turn = await self.games.adapter.execute_turn(item.stateSnapshot, submitted)
        except ApiError as exc:
            if exc.code in {"INVALID_MOVE", "NOT_PLAYER_TURN", "TARGET_OCCUPIED",
                            "PATH_BLOCKED", "NODE_NOT_FOUND", "GAME_ALREADY_FINISHED"}:
                raise ApiError("INVALID_MOVE", "Illegal training move") from exc
            raise
        score = await self.games.adapter.review_move(
            item.stateSnapshot, turn.state, submitted, item.scoringConfig)
        if (score.timedOut or score.scorePerspective != item.player or score.searchDepth != item.scoringDepth or
            not math.isfinite(score.bestScore) or not math.isfinite(score.actualMoveScore) or
            abs(score.bestScore - item.bestScore) > SCORE_TOLERANCE):
            raise ApiError("TRAINING_SCORING_INCOMPLETE", "Training score is not comparable")
        loss = item.bestScore - score.actualMoveScore
        if not math.isfinite(loss) or loss < -SCORE_TOLERANCE:
            raise ApiError("TRAINING_SCORING_INCOMPLETE", "Training score is inconsistent")
        loss = 0.0 if abs(loss) <= SCORE_TOLERANCE else loss
        equivalent = loss == 0
        result = TrainingAnswerResult(
            id=uuid4().hex, trainingId=training_id,
            clientAttemptId=request.client_attempt_id, submittedMove=submitted,
            bestMoveEquivalent=equivalent, bestMove=item.bestMove,
            bestScore=item.bestScore, submittedMoveScore=score.actualMoveScore,
            scoreLoss=loss, result="CORRECT" if equivalent else "SUBOPTIMAL",
            feedback=("你的走法与引擎最佳评分一致。" if equivalent else
                      f"该走法合法，但相比最佳方案损失了 {loss:g} 分。"),
            searchDepth=score.searchDepth, timedOut=score.timedOut,
            answeredAt=datetime.now(timezone.utc),
        )
        return await self.store.commit_training_record(result, user_id)
