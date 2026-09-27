"""MySQL unit of work: one versioned game update and move insert per transaction."""

import asyncio
from datetime import timezone

from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import sessionmaker

from backend.app.core.errors import ApiError
from backend.app.db.models import (AiAnalysisModel, CoachHintModel, GameModel, GameReviewModel,
                                    MoveReviewModel, ReviewExplanationModel)
from backend.app.db.repositories.game import GameRepository
from backend.app.db.repositories.move import MoveRepository
from backend.app.schemas.game import GameReview, GameState, PositionAnalysis, SearchResult, TurnResult
from backend.app.schemas.explanation import ExplanationBundle
from backend.app.schemas.coach import CoachHint
from backend.app.schemas.training import (TrainingAnswerResult, TrainingItemInternal,
                                          TrainingSource)
from backend.app.db.repositories.training import TrainingRepository
from backend.app.services.game_store import StoredGame, StoredMove


class MySQLGameStore:
    def __init__(self, database_url: str):
        self.engine = create_engine(database_url, pool_pre_ping=True, isolation_level="REPEATABLE READ")
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)

    async def ping(self) -> None:
        await asyncio.to_thread(self._ping)

    def _ping(self) -> None:
        try:
            with self.engine.connect() as connection:
                connection.execute(text("SELECT 1"))
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def lock_for(self, game_id: str) -> asyncio.Lock:
        # The database CAS is the concurrency guard; no unbounded game-id cache.
        return asyncio.Lock()

    async def create(self, state: GameState, mode: str = "LOCAL",
                     ai_player: str | None = None, ai_level: str | None = None) -> str:
        return await asyncio.to_thread(self._create, state, mode, ai_player, ai_level)

    def _create(self, state: GameState, mode: str,
                ai_player: str | None, ai_level: str | None) -> str:
        try:
            with self.sessions.begin() as session:
                return GameRepository(session).create_game(state, mode, ai_player, ai_level)
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def get_snapshot(self, game_id: str) -> StoredGame:
        return await asyncio.to_thread(self._get_snapshot, game_id)

    def _get_snapshot(self, game_id: str) -> StoredGame:
        try:
            with self.sessions() as session:
                return GameRepository(session).get_snapshot(game_id)
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def commit_turn(self, game_id: str, expected_version: int, turn: TurnResult,
                          actor_type: str, search: SearchResult | None = None) -> None:
        await asyncio.to_thread(self._commit_turn, game_id, expected_version, turn, actor_type, search)

    def _commit_turn(self, game_id: str, expected_version: int, turn: TurnResult,
                     actor_type: str, search: SearchResult | None) -> None:
        try:
            with self.sessions.begin() as session:
                games = GameRepository(session)
                row = games.get_game(game_id)
                if row.version != expected_version or GameState.model_validate(row.current_state) != turn.before_state:
                    raise ApiError("GAME_STATE_CONFLICT", "Game state changed; retry the move")
                games.update_game_state(row, expected_version, turn.state)
                MoveRepository(session).create_move(game_id, expected_version + 1, turn, actor_type, search)
                session.flush()
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def list_moves(self, game_id: str) -> list[StoredMove]:
        return await asyncio.to_thread(self._list_moves, game_id)

    def _list_moves(self, game_id: str) -> list[StoredMove]:
        try:
            with self.sessions() as session:
                GameRepository(session).get_game(game_id)
                return MoveRepository(session).list_moves(game_id)
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def read_replay(self, game_id: str) -> tuple[StoredGame, list[StoredMove]]:
        return await asyncio.to_thread(self._read_replay, game_id)

    def _read_replay(self, game_id: str) -> tuple[StoredGame, list[StoredMove]]:
        try:
            # One InnoDB repeatable-read transaction keeps the header and turns consistent.
            with self.sessions.begin() as session:
                snapshot = GameRepository(session).get_snapshot(game_id)
                moves = MoveRepository(session).list_moves(game_id)
                return snapshot, moves
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    def close(self) -> None:
        self.engine.dispose()

    async def commit_analysis(self, game_id: str, expected_version: int,
                              analysis: PositionAnalysis) -> None:
        await asyncio.to_thread(self._commit_analysis, game_id, expected_version, analysis)

    def _commit_analysis(self, game_id: str, expected_version: int,
                         analysis: PositionAnalysis) -> None:
        try:
            with self.sessions.begin() as session:
                row = session.scalar(select(GameModel).where(GameModel.id == game_id).with_for_update())
                if row is None:
                    raise ApiError("GAME_NOT_FOUND", "Game not found")
                if row.version != expected_version:
                    raise ApiError("GAME_STATE_CONFLICT", "Game state changed; retry analysis")
                session.add(AiAnalysisModel(
                    game_id=game_id, game_version=expected_version,
                    analyzed_player=analysis.analyzedPlayer,
                    best_move=analysis.bestMove.model_dump(by_alias=True) if analysis.bestMove else None,
                    best_score=analysis.bestScore, score_perspective=analysis.scorePerspective,
                    evaluation_before=analysis.evaluationBefore.model_dump(mode="json"),
                    evaluation_breakdown=analysis.evaluationBreakdown.model_dump(mode="json"),
                    candidate_moves=[item.model_dump(mode="json", by_alias=True)
                                     for item in analysis.candidateMoves],
                    threats=[item.model_dump(mode="json", by_alias=True) for item in analysis.threats],
                    search_depth=analysis.searchDepth, nodes_searched=analysis.nodesSearched,
                    thinking_time_ms=analysis.thinkingTimeMs, algorithm=analysis.algorithm,
                    tt_hits=analysis.ttHits, timed_out=analysis.timedOut,
                    terminal=analysis.terminal, winner=analysis.winner,
                    winner_reason=analysis.winnerReason,
                ))
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def get_review(self, game_id: str, player: str, version: int) -> GameReview | None:
        return await asyncio.to_thread(self._get_review, game_id, player, version)

    @staticmethod
    def _read_review(session, game_id: str, player: str, version: int) -> GameReview | None:
        row = session.scalar(select(GameReviewModel).where(
            GameReviewModel.game_id == game_id,
            GameReviewModel.reviewed_player == player,
            GameReviewModel.review_config_version == version))
        if row is None:
            return None
        moves = session.scalars(select(MoveReviewModel).where(
            MoveReviewModel.game_review_id == row.id).order_by(MoveReviewModel.turn_number)).all()
        return GameReview.model_validate({
            "id": row.id, "gameId": row.game_id, "reviewedPlayer": row.reviewed_player,
            "overallScore": row.overall_score, "goodMoves": row.good_moves,
            "normalMoves": row.normal_moves, "mistakes": row.mistakes,
            "blunders": row.blunders, "bestMoveRate": row.best_move_rate,
            "turningPoints": row.turning_points, "winner": row.winner,
            "winnerReason": row.winner_reason, "reviewConfig": row.review_config,
            "reviewConfigVersion": row.review_config_version,
            "moveReviews": [move.analysis for move in moves],
            "createdAt": row.created_at.replace(tzinfo=timezone.utc),
        })

    def _get_review(self, game_id: str, player: str, version: int) -> GameReview | None:
        try:
            with self.sessions() as session:
                GameRepository(session).get_game(game_id)
                return self._read_review(session, game_id, player, version)
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def commit_review(self, review: GameReview, expected_version: int) -> GameReview:
        return await asyncio.to_thread(self._commit_review, review, expected_version)

    def _commit_review(self, review: GameReview, expected_version: int) -> GameReview:
        try:
            with self.sessions.begin() as session:
                row = session.scalar(select(GameModel).where(
                    GameModel.id == review.gameId).with_for_update())
                if row is None:
                    raise ApiError("GAME_NOT_FOUND", "Game not found")
                if row.version != expected_version or row.status != "FINISHED":
                    raise ApiError("GAME_STATE_CONFLICT", "Game state changed during review")
                existing = self._read_review(session, review.gameId,
                                             review.reviewedPlayer, review.reviewConfigVersion)
                if existing is not None:
                    return existing
                session.add(GameReviewModel(
                    id=review.id, game_id=review.gameId,
                    reviewed_player=review.reviewedPlayer, overall_score=review.overallScore,
                    good_moves=review.goodMoves, normal_moves=review.normalMoves,
                    mistakes=review.mistakes, blunders=review.blunders,
                    best_move_rate=review.bestMoveRate, turning_points=review.turningPoints,
                    winner=review.winner, winner_reason=review.winnerReason,
                    review_config=review.reviewConfig.model_dump(mode="json"),
                    review_config_version=review.reviewConfigVersion,
                    created_at=review.createdAt.replace(tzinfo=None),
                ))
                for move in review.moveReviews:
                    session.add(MoveReviewModel(
                        game_review_id=review.id, game_move_id=move.gameMoveId,
                        turn_number=move.turn, player=move.player,
                        actual_move=move.actualMove.model_dump(mode="json", by_alias=True),
                        best_move=move.bestMove.model_dump(mode="json", by_alias=True),
                        score_before=move.scoreBefore, score_after=move.scoreAfter,
                        best_score=move.bestScore, actual_move_score=move.actualMoveScore,
                        score_loss=move.scoreLoss, category=move.category,
                        evaluation_before=move.evaluationBefore.model_dump(mode="json"),
                        evaluation_after=move.evaluationAfter.model_dump(mode="json"),
                        candidate_moves=[item.model_dump(mode="json", by_alias=True)
                                         for item in move.bestCandidateMoves],
                        threats=[item.model_dump(mode="json", by_alias=True)
                                 for item in move.threatsBefore],
                        engine_explanation=move.engineExplanation,
                        search_depth=move.searchDepth, timed_out=move.timedOut,
                        analysis=move.model_dump(mode="json", by_alias=True),
                        created_at=review.createdAt.replace(tzinfo=None),
                    ))
                session.flush()
                return review
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def get_explanation(self, review_id: str, prompt_version: str) -> ExplanationBundle | None:
        return await asyncio.to_thread(self._get_explanation, review_id, prompt_version)

    @staticmethod
    def _read_explanation(session, review_id: str, prompt_version: str) -> ExplanationBundle | None:
        row = session.scalar(select(ReviewExplanationModel).where(
            ReviewExplanationModel.game_review_id == review_id,
            ReviewExplanationModel.prompt_version == prompt_version))
        return ExplanationBundle.model_validate(row.payload) if row is not None else None

    def _get_explanation(self, review_id: str, prompt_version: str) -> ExplanationBundle | None:
        try:
            with self.sessions() as session:
                return self._read_explanation(session, review_id, prompt_version)
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def commit_explanation(self, bundle: ExplanationBundle) -> ExplanationBundle:
        return await asyncio.to_thread(self._commit_explanation, bundle)

    def _commit_explanation(self, bundle: ExplanationBundle) -> ExplanationBundle:
        try:
            with self.sessions.begin() as session:
                parent = session.scalar(select(GameReviewModel).where(
                    GameReviewModel.id == bundle.gameReviewId).with_for_update())
                if parent is None:
                    raise ApiError("REVIEW_NOT_FOUND", "Review has not been generated")
                existing = self._read_explanation(session, bundle.gameReviewId,
                                                   bundle.promptVersion)
                if existing is not None:
                    return existing
                session.add(ReviewExplanationModel(
                    game_review_id=bundle.gameReviewId,
                    prompt_version=bundle.promptVersion,
                    provider=bundle.gameExplanation.provider,
                    model=bundle.gameExplanation.model,
                    fallback_used=(bundle.gameExplanation.fallbackUsed or
                                   any(item.fallbackUsed for item in bundle.moveExplanations)),
                    payload=bundle.model_dump(mode="json"),
                    created_at=bundle.createdAt.replace(tzinfo=None),
                ))
                session.flush()
                return bundle
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def get_coach_hint(self, game_id: str, game_version: int, player: str,
                             level: int, prompt_version: str) -> CoachHint | None:
        return await asyncio.to_thread(self._get_coach_hint, game_id, game_version,
                                       player, level, prompt_version)

    @staticmethod
    def _read_coach_hint(session, game_id: str, game_version: int, player: str,
                         level: int, prompt_version: str) -> CoachHint | None:
        row = session.scalar(select(CoachHintModel).where(
            CoachHintModel.game_id == game_id,
            CoachHintModel.game_version == game_version,
            CoachHintModel.analyzed_player == player,
            CoachHintModel.hint_level == level,
            CoachHintModel.prompt_version == prompt_version))
        if row is None:
            return None
        return CoachHint(gameId=row.game_id, gameVersion=row.game_version,
                         analyzedPlayer=row.analyzed_player, level=row.hint_level,
                         hintText=row.hint_text, focusTopics=row.focus_topics,
                         candidateFromNodes=row.candidate_nodes, bestMove=row.best_move,
                         provider=row.provider, model=row.model,
                         promptVersion=row.prompt_version, fallbackUsed=row.fallback_used,
                         generatedAt=row.created_at.replace(tzinfo=timezone.utc))

    def _get_coach_hint(self, game_id: str, game_version: int, player: str,
                        level: int, prompt_version: str) -> CoachHint | None:
        try:
            with self.sessions() as session:
                return self._read_coach_hint(session, game_id, game_version,
                                             player, level, prompt_version)
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def commit_coach_hint(self, hint: CoachHint) -> CoachHint:
        return await asyncio.to_thread(self._commit_coach_hint, hint)

    def _commit_coach_hint(self, hint: CoachHint) -> CoachHint:
        try:
            with self.sessions.begin() as session:
                row = session.scalar(select(GameModel).where(
                    GameModel.id == hint.gameId).with_for_update())
                if row is None:
                    raise ApiError("GAME_NOT_FOUND", "Game not found")
                if (row.version != hint.gameVersion or row.status != "PLAYING" or
                    row.current_player != hint.analyzedPlayer):
                    raise ApiError("GAME_STATE_CONFLICT", "Game state changed during coaching")
                existing = self._read_coach_hint(session, hint.gameId, hint.gameVersion,
                                                 hint.analyzedPlayer, hint.level,
                                                 hint.promptVersion)
                if existing is not None:
                    return existing
                session.add(CoachHintModel(
                    game_id=hint.gameId, game_version=hint.gameVersion,
                    analyzed_player=hint.analyzedPlayer, hint_level=hint.level,
                    hint_text=hint.hintText, focus_topics=hint.focusTopics,
                    candidate_nodes=hint.candidateFromNodes,
                    best_move=hint.bestMove.model_dump(by_alias=True) if hint.bestMove else None,
                    provider=hint.provider, model=hint.model,
                    prompt_version=hint.promptVersion, fallback_used=hint.fallbackUsed,
                    created_at=hint.generatedAt.replace(tzinfo=None),
                ))
                session.flush()
                return hint
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def list_training_sources(self, review_id: str) -> list[TrainingSource]:
        return await asyncio.to_thread(self._list_training_sources, review_id)

    def _list_training_sources(self, review_id: str) -> list[TrainingSource]:
        try:
            with self.sessions() as session:
                return TrainingRepository(session).sources(review_id)
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def commit_training_items(self, review_id: str,
                                    items: list[TrainingItemInternal]) -> list[TrainingItemInternal]:
        return await asyncio.to_thread(self._commit_training_items, review_id, items)

    def _commit_training_items(self, review_id: str,
                               items: list[TrainingItemInternal]) -> list[TrainingItemInternal]:
        try:
            with self.sessions.begin() as session:
                return TrainingRepository(session).commit_items(review_id, items)
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def list_training_items(self, limit: int, offset: int, category: str | None,
                                  training_type: str | None) -> tuple[list[TrainingItemInternal], int]:
        return await asyncio.to_thread(self._list_training_items, limit, offset,
                                       category, training_type)

    def _list_training_items(self, limit: int, offset: int, category: str | None,
                             training_type: str | None) -> tuple[list[TrainingItemInternal], int]:
        try:
            with self.sessions() as session:
                return TrainingRepository(session).list_items(limit, offset, category, training_type)
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def get_training_item(self, training_id: str) -> TrainingItemInternal:
        return await asyncio.to_thread(self._get_training_item, training_id)

    def _get_training_item(self, training_id: str) -> TrainingItemInternal:
        try:
            with self.sessions() as session:
                return TrainingRepository(session).get_item(training_id)
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def get_training_attempt(self, client_attempt_id: str) -> TrainingAnswerResult | None:
        return await asyncio.to_thread(self._get_training_attempt, client_attempt_id)

    def _get_training_attempt(self, client_attempt_id: str) -> TrainingAnswerResult | None:
        try:
            with self.sessions() as session:
                return TrainingRepository(session).get_attempt(client_attempt_id)
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def commit_training_record(self, record: TrainingAnswerResult) -> TrainingAnswerResult:
        return await asyncio.to_thread(self._commit_training_record, record)

    def _commit_training_record(self, record: TrainingAnswerResult) -> TrainingAnswerResult:
        try:
            with self.sessions.begin() as session:
                return TrainingRepository(session).commit_record(record)
        except IntegrityError as exc:
            raise ApiError("TRAINING_ATTEMPT_CONFLICT", "Attempt ID already used") from exc
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc
