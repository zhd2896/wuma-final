"""Versioned Coach orchestration; only the Node analyzer supplies game facts."""

import asyncio
import logging
from datetime import datetime, timezone

from backend.app.core.errors import ApiError
from backend.app.schemas.coach import CoachHint, CoachHintText, PROMPT_VERSION
from backend.app.services.coach.fallback import fallback_hint
from backend.app.services.coach.grounding import validate_coach_text
from backend.app.services.coach.policy import CoachHintPolicy
from backend.app.services.coach.prompt import CoachPromptBuilder
from backend.app.services.game_service import GameService
from backend.app.services.game_store import GameStore
from backend.app.services.review_explanation.provider import LLMProvider

logger = logging.getLogger(__name__)


class CoachService:
    def __init__(self, games: GameService, store: GameStore, provider: LLMProvider | None,
                 timeout_seconds: float):
        self.games = games
        self.store = store
        self.provider = provider
        self.timeout_seconds = timeout_seconds

    async def hint(self, game_id: str, level: int, expected_version: int) -> CoachHint:
        if level not in (1, 2, 3):
            raise ApiError("INVALID_HINT_LEVEL", "Hint level must be 1, 2 or 3")
        snapshot = await self.store.get_snapshot(game_id)
        if snapshot.version != expected_version:
            raise ApiError("GAME_STATE_CONFLICT", "Game state changed; request a new hint")
        if snapshot.state.game_status == "FINISHED":
            raise ApiError("GAME_ALREADY_FINISHED", "Game already finished")
        if snapshot.mode != "AI" or snapshot.ai_player is None:
            raise ApiError("AI_MODE_REQUIRED", "Coach is available in AI games")
        if snapshot.state.current_player == snapshot.ai_player:
            raise ApiError("NOT_PLAYER_TURN", "Coach is available on the human turn")
        player = snapshot.state.current_player
        saved = await self.store.get_coach_hint(game_id, expected_version, player,
                                                level, PROMPT_VERSION)
        if saved is not None:
            if (await self.store.get_snapshot(game_id)).version != expected_version:
                raise ApiError("GAME_STATE_CONFLICT", "Game state changed; request a new hint")
            return saved
        analysis = await self.games.adapter.analyze_position(
            snapshot.state, self.games.settings.analysis_max_depth,
            self.games.settings.analysis_time_limit_ms,
            self.games.settings.analysis_candidate_limit,
        )
        if analysis.analyzedPlayer != player or analysis.scorePerspective != player:
            raise ApiError("ENGINE_FAILURE", "Analysis perspective differs from current player")
        await self.store.commit_analysis(game_id, expected_version, analysis)
        evidence = CoachHintPolicy.build(analysis, level)
        provider_name, model, fallback_used = "fallback", None, True
        message = fallback_hint(evidence)
        if self.provider is not None:
            try:
                raw = await asyncio.wait_for(
                    self.provider.generate(CoachPromptBuilder.build(evidence)),
                    self.timeout_seconds)
                text = CoachHintText.model_validate_json(raw).hintText
                if not validate_coach_text(text, evidence):
                    raise ValueError("Coach text exceeds allowed evidence")
                message = text
                provider_name, model, fallback_used = (
                    self.provider.name, self.provider.model, False)
            except Exception as exc:
                logger.warning("Coach fallback: provider=%s model=%s error=%s",
                               self.provider.name, self.provider.model, type(exc).__name__)
        hint = CoachHint(
            gameId=game_id, gameVersion=expected_version, analyzedPlayer=player,
            level=level, hintText=message, focusTopics=evidence.focusTopics,
            candidateFromNodes=evidence.candidateFromNodes,
            bestMove=evidence.bestMove, fallbackUsed=fallback_used,
            provider=provider_name, model=model, generatedAt=datetime.now(timezone.utc),
        )
        return await self.store.commit_coach_hint(hint)
