"""Explain saved review facts while leaving every algorithm field untouched."""

import asyncio
import logging
from datetime import datetime, timezone

from backend.app.core.errors import ApiError
from backend.app.schemas.explanation import (
    PROMPT_VERSION, ExplainedReview, ExplanationBundle, GameExplanation,
    GameExplanationText, MoveExplanation, MoveExplanationText,
)
from backend.app.schemas.game import GameReview, MoveReview
from backend.app.services.game_service import GameService
from backend.app.services.game_store import GameStore
from backend.app.services.review_explanation.fallback import fallback_game, fallback_move
from backend.app.services.review_explanation.grounding import validate_game_text, validate_move_text
from backend.app.services.review_explanation.prompt import ReviewPromptBuilder
from backend.app.services.review_explanation.provider import LLMProvider

logger = logging.getLogger(__name__)


class ExplanationService:
    def __init__(self, reviews: GameService, store: GameStore,
                 provider: LLMProvider | None, timeout_seconds: float,
                 total_timeout_seconds: float):
        self.reviews = reviews
        self.store = store
        self.provider = provider
        self.timeout_seconds = timeout_seconds
        self.total_timeout_seconds = total_timeout_seconds
        self.prompts = ReviewPromptBuilder()

    async def get(self, game_id: str, reviewed_player: str | None = None) -> ExplainedReview:
        review = await self.reviews.get_review(game_id, reviewed_player)
        return await self._get_saved(review)

    async def _get_saved(self, review: GameReview) -> ExplainedReview:
        saved = await self.store.get_explanation(review.id, PROMPT_VERSION)
        if saved is None:
            raise ApiError("EXPLANATION_NOT_FOUND", "Review explanation has not been generated")
        return ExplainedReview(review=review, explanation=saved)

    async def explain(self, game_id: str, reviewed_player: str | None = None, user_id: str | None = None) -> ExplainedReview:
        review = await self.reviews.get_review(game_id, reviewed_player)
        return await self._explain_saved(review, user_id=user_id)

    async def _explain_saved(self, review: GameReview, *, remote_token_hash: str | None = None,
                             user_id: str | None = None, expected_version: int | None = None) -> ExplainedReview:
        saved = await self.store.get_explanation(review.id, PROMPT_VERSION)
        if saved is not None:
            if remote_token_hash is None:
                await self.store.validate_ordinary_actor(review.gameId, user_id)
            return ExplainedReview(review=review, explanation=saved)
        deadline = asyncio.get_running_loop().time() + self.total_timeout_seconds
        game_text = await self._game(review, deadline)
        move_text = [await self._move(move, review, deadline) for move in review.moveReviews]
        bundle = ExplanationBundle(
            gameReviewId=review.id, gameExplanation=game_text,
            moveExplanations=move_text, createdAt=datetime.now(timezone.utc),
        )
        if remote_token_hash is None:
            saved = await self.store.commit_explanation(bundle, user_id=user_id)
        else:
            saved = await self.store.commit_explanation(bundle, remote_token_hash=remote_token_hash,
                user_id=user_id, expected_version=expected_version)
        return ExplainedReview(review=review, explanation=saved)

    def _call_timeout(self, deadline: float | None) -> float:
        if deadline is None:
            return self.timeout_seconds
        return max(0.0, min(self.timeout_seconds,
                            deadline - asyncio.get_running_loop().time()))

    async def _game(self, review: GameReview, deadline: float | None = None) -> GameExplanation:
        timeout = self._call_timeout(deadline)
        if self.provider is not None and timeout > 0:
            try:
                raw = await asyncio.wait_for(self.provider.generate(self.prompts.game(review)),
                                             timeout)
                text = GameExplanationText.model_validate_json(raw)
                if not validate_game_text(" ".join([
                    text.overall_summary, *text.strengths, *text.main_problems,
                    *text.practice_suggestions,
                ])):
                    raise ValueError("Ungrounded game explanation")
                return GameExplanation(**text.model_dump(), provider=self.provider.name,
                                       model=self.provider.model, fallbackUsed=False)
            except Exception as exc:
                # Log metadata only: never credentials, prompts or raw provider responses.
                logger.warning("Review game explanation fallback: provider=%s model=%s error=%s",
                               self.provider.name, self.provider.model, type(exc).__name__)
        return GameExplanation(**fallback_game(review).model_dump(), provider="fallback",
                               model=None, fallbackUsed=True)

    async def _move(self, move: MoveReview, review: GameReview,
                    deadline: float | None = None) -> MoveExplanation:
        priority = move.turn in review.turningPoints[:3]
        timeout = self._call_timeout(deadline)
        if self.provider is not None and priority and timeout > 0:
            try:
                raw = await asyncio.wait_for(self.provider.generate(self.prompts.move(move, review)),
                                             timeout)
                text = MoveExplanationText.model_validate_json(raw)
                actual = (move.actualMove.from_node, move.actualMove.to_node)
                best = (move.bestMove.from_node, move.bestMove.to_node)
                if not validate_move_text(" ".join(text.model_dump().values()),
                                          actual, best, move.category):
                    raise ValueError("Ungrounded move explanation")
                return MoveExplanation(turn=move.turn, **text.model_dump(),
                    provider=self.provider.name, model=self.provider.model, fallbackUsed=False)
            except Exception as exc:
                logger.warning("Review move explanation fallback: provider=%s model=%s turn=%s error=%s",
                               self.provider.name, self.provider.model, move.turn,
                               type(exc).__name__)
        return MoveExplanation(turn=move.turn, **fallback_move(move).model_dump(),
                               provider="fallback", model=None, fallbackUsed=True)
