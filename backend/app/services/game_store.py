"""Persistence contract and an explicit in-memory implementation for isolated API tests."""

import asyncio
from dataclasses import dataclass
from typing import Protocol
from uuid import uuid4

from backend.app.core.errors import ApiError
from backend.app.schemas.game import GameReview, GameState, PositionAnalysis, SearchResult, TurnResult
from backend.app.schemas.explanation import ExplanationBundle
from backend.app.schemas.coach import CoachHint
from backend.app.schemas.training import (TrainingAnswerResult, TrainingItemInternal,
                                          TrainingSource)


@dataclass(frozen=True)
class StoredGame:
    game_id: str
    initial_state: GameState
    state: GameState
    version: int
    mode: str = "LOCAL"
    ai_player: str | None = None
    ai_level: str | None = None


@dataclass(frozen=True)
class StoredMove:
    turn_number: int
    actor_type: str
    turn: TurnResult
    search: SearchResult | None
    game_move_id: int = 0


class GameStore(Protocol):
    async def ping(self) -> None: ...

    async def create(self, state: GameState, mode: str = "LOCAL",
                     ai_player: str | None = None, ai_level: str | None = None) -> str: ...
    async def get_snapshot(self, game_id: str) -> StoredGame: ...
    async def commit_turn(self, game_id: str, expected_version: int, turn: TurnResult,
                          actor_type: str, search: SearchResult | None = None) -> None: ...
    async def list_moves(self, game_id: str) -> list[StoredMove]: ...
    async def read_replay(self, game_id: str) -> tuple[StoredGame, list[StoredMove]]: ...
    async def lock_for(self, game_id: str) -> asyncio.Lock: ...
    async def commit_analysis(self, game_id: str, expected_version: int,
                              analysis: PositionAnalysis) -> None: ...
    async def get_review(self, game_id: str, player: str, version: int) -> GameReview | None: ...
    async def commit_review(self, review: GameReview, expected_version: int) -> GameReview: ...
    async def get_explanation(self, review_id: str, prompt_version: str) -> ExplanationBundle | None: ...
    async def commit_explanation(self, bundle: ExplanationBundle) -> ExplanationBundle: ...
    async def get_coach_hint(self, game_id: str, game_version: int, player: str,
                             level: int, prompt_version: str) -> CoachHint | None: ...
    async def commit_coach_hint(self, hint: CoachHint) -> CoachHint: ...
    async def list_training_sources(self, review_id: str) -> list[TrainingSource]: ...
    async def commit_training_items(self, review_id: str,
                                    items: list[TrainingItemInternal]) -> list[TrainingItemInternal]: ...
    async def list_training_items(self, limit: int, offset: int, category: str | None,
                                  training_type: str | None) -> tuple[list[TrainingItemInternal], int]: ...
    async def get_training_item(self, training_id: str) -> TrainingItemInternal: ...
    async def get_training_attempt(self, client_attempt_id: str) -> TrainingAnswerResult | None: ...
    async def commit_training_record(self, record: TrainingAnswerResult) -> TrainingAnswerResult: ...


class InMemoryGameStore:
    """Test-only store; production creates MySQLGameStore by default."""

    def __init__(self):
        self._games: dict[str, StoredGame] = {}
        self._moves: dict[str, list[StoredMove]] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._analyses: dict[str, list[tuple[int, PositionAnalysis]]] = {}
        self._reviews: dict[tuple[str, str, int], GameReview] = {}
        self._explanations: dict[tuple[str, str], ExplanationBundle] = {}
        self._coach_hints: dict[tuple[str, int, str, int, str], CoachHint] = {}
        self._training_items: dict[str, TrainingItemInternal] = {}
        self._training_keys: dict[tuple[str, int, str, int], str] = {}
        self._training_records: dict[str, TrainingAnswerResult] = {}
        self._catalog_lock = asyncio.Lock()

    async def ping(self) -> None:
        return None

    async def create(self, state: GameState, mode: str = "LOCAL",
                     ai_player: str | None = None, ai_level: str | None = None) -> str:
        async with self._catalog_lock:
            game_id = uuid4().hex
            self._games[game_id] = StoredGame(game_id, state, state, 0, mode, ai_player, ai_level)
            self._moves[game_id] = []
            self._locks[game_id] = asyncio.Lock()
            self._analyses[game_id] = []
            return game_id

    async def lock_for(self, game_id: str) -> asyncio.Lock:
        async with self._catalog_lock:
            lock = self._locks.get(game_id)
        if lock is None:
            raise ApiError("GAME_NOT_FOUND", "Game not found")
        return lock

    async def get_snapshot(self, game_id: str) -> StoredGame:
        game = self._games.get(game_id)
        if game is None:
            raise ApiError("GAME_NOT_FOUND", "Game not found")
        return game

    async def commit_turn(self, game_id: str, expected_version: int, turn: TurnResult,
                          actor_type: str, search: SearchResult | None = None) -> None:
        game = await self.get_snapshot(game_id)
        if game.version != expected_version or game.state != turn.before_state:
            raise ApiError("GAME_STATE_CONFLICT", "Game state changed; retry the move")
        self._moves[game_id].append(StoredMove(game.version + 1, actor_type, turn, search,
                                               game.version + 1))
        self._games[game_id] = StoredGame(game_id, game.initial_state, turn.state,
                                          game.version + 1, game.mode, game.ai_player, game.ai_level)

    async def list_moves(self, game_id: str) -> list[StoredMove]:
        await self.get_snapshot(game_id)
        return list(self._moves[game_id])

    async def read_replay(self, game_id: str) -> tuple[StoredGame, list[StoredMove]]:
        lock = await self.lock_for(game_id)
        async with lock:
            return await self.get_snapshot(game_id), await self.list_moves(game_id)

    async def update(self, game_id: str, state: GameState) -> None:
        """Fixture setup for legacy API tests; never used by production."""
        lock = await self.lock_for(game_id)
        async with lock:
            game = await self.get_snapshot(game_id)
            self._games[game_id] = StoredGame(game_id, state, state, game.version,
                                              game.mode, game.ai_player, game.ai_level)

    async def commit_analysis(self, game_id: str, expected_version: int,
                              analysis: PositionAnalysis) -> None:
        lock = await self.lock_for(game_id)
        async with lock:
            game = await self.get_snapshot(game_id)
            if game.version != expected_version:
                raise ApiError("GAME_STATE_CONFLICT", "Game state changed; retry analysis")
            self._analyses[game_id].append((expected_version, analysis))

    async def get_review(self, game_id: str, player: str, version: int) -> GameReview | None:
        await self.get_snapshot(game_id)
        return self._reviews.get((game_id, player, version))

    async def commit_review(self, review: GameReview, expected_version: int) -> GameReview:
        lock = await self.lock_for(review.gameId)
        async with lock:
            game = await self.get_snapshot(review.gameId)
            if game.version != expected_version or game.state.game_status != "FINISHED":
                raise ApiError("GAME_STATE_CONFLICT", "Game state changed during review")
            key = (review.gameId, review.reviewedPlayer, review.reviewConfigVersion)
            if key not in self._reviews:
                self._reviews[key] = review
            return self._reviews[key]

    async def get_explanation(self, review_id: str, prompt_version: str) -> ExplanationBundle | None:
        return self._explanations.get((review_id, prompt_version))

    async def commit_explanation(self, bundle: ExplanationBundle) -> ExplanationBundle:
        async with self._catalog_lock:
            key = (bundle.gameReviewId, bundle.promptVersion)
            if key not in self._explanations:
                self._explanations[key] = bundle
            return self._explanations[key]

    async def get_coach_hint(self, game_id: str, game_version: int, player: str,
                             level: int, prompt_version: str) -> CoachHint | None:
        return self._coach_hints.get((game_id, game_version, player, level, prompt_version))

    async def commit_coach_hint(self, hint: CoachHint) -> CoachHint:
        lock = await self.lock_for(hint.gameId)
        async with lock:
            game = await self.get_snapshot(hint.gameId)
            if (game.version != hint.gameVersion or game.state.game_status != "PLAYING" or
                game.state.current_player != hint.analyzedPlayer):
                raise ApiError("GAME_STATE_CONFLICT", "Game state changed during coaching")
            key = (hint.gameId, hint.gameVersion, hint.analyzedPlayer,
                   hint.level, hint.promptVersion)
            if key not in self._coach_hints:
                self._coach_hints[key] = hint
            return self._coach_hints[key]

    async def list_training_sources(self, review_id: str) -> list[TrainingSource]:
        review = next((item for item in self._reviews.values() if item.id == review_id), None)
        if review is None:
            raise ApiError("REVIEW_REQUIRED", "Generate a game review first")
        moves = {move.game_move_id: move for move in self._moves[review.gameId]}
        return [TrainingSource(sourceMoveId=review_move.gameMoveId,
                               sourceMoveReviewId=review_move.gameMoveId,
                               stateSnapshot=moves[review_move.gameMoveId].turn.before_state,
                               stateSchemaVersion=1,
                               originalMove=moves[review_move.gameMoveId].turn.move)
                for review_move in review.moveReviews]

    async def commit_training_items(self, review_id: str,
                                    items: list[TrainingItemInternal]) -> list[TrainingItemInternal]:
        async with self._catalog_lock:
            review = next((item for item in self._reviews.values() if item.id == review_id), None)
            if review is None or self._games[review.gameId].state.game_status != "FINISHED":
                raise ApiError("REVIEW_REQUIRED", "Generate a finished game review first")
            saved = []
            for item in items:
                key = (review_id, item.sourceMoveReviewId,
                       item.trainingType, item.generationVersion)
                if key not in self._training_keys:
                    self._training_keys[key] = item.id
                    self._training_items[item.id] = item
                saved.append(self._training_items[self._training_keys[key]])
            return saved

    async def list_training_items(self, limit: int, offset: int, category: str | None,
                                  training_type: str | None) -> tuple[list[TrainingItemInternal], int]:
        items = [item for item in self._training_items.values()
                 if (category is None or item.sourceCategory == category) and
                 (training_type is None or item.trainingType == training_type)]
        items.sort(key=lambda item: (item.sourceCategory == "BLUNDER", item.createdAt, item.id),
                   reverse=True)
        return items[offset:offset + limit], len(items)

    async def get_training_item(self, training_id: str) -> TrainingItemInternal:
        item = self._training_items.get(training_id)
        if item is None:
            raise ApiError("TRAINING_NOT_FOUND", "Training question not found")
        return item

    async def get_training_attempt(self, client_attempt_id: str) -> TrainingAnswerResult | None:
        return self._training_records.get(client_attempt_id)

    async def commit_training_record(self, record: TrainingAnswerResult) -> TrainingAnswerResult:
        async with self._catalog_lock:
            if record.trainingId not in self._training_items:
                raise ApiError("TRAINING_NOT_FOUND", "Training question not found")
            existing = self._training_records.get(record.clientAttemptId)
            if existing is not None:
                if existing.trainingId != record.trainingId or existing.submittedMove != record.submittedMove:
                    raise ApiError("TRAINING_ATTEMPT_CONFLICT", "Attempt ID already used")
                return existing
            self._training_records[record.clientAttemptId] = record
            return record
