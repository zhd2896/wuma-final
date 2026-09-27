"""Private training facts and answer-free public question DTOs."""

from datetime import datetime
from typing import Literal

from pydantic import Field

from backend.app.schemas.game import GameState, Move, NodeId, Player, ReviewConfig, StrictModel


TrainingCategory = Literal["MISTAKE", "BLUNDER"]
TrainingResultKind = Literal["CORRECT", "SUBOPTIMAL"]


class TrainingSource(StrictModel):
    sourceMoveId: int
    sourceMoveReviewId: int
    stateSnapshot: GameState
    stateSchemaVersion: int
    originalMove: Move


class TrainingItemInternal(StrictModel):
    id: str
    sourceGameId: str
    sourceMoveId: int
    sourceMoveReviewId: int
    sourceTurn: int
    player: Player
    stateSnapshot: GameState
    stateSchemaVersion: int
    originalMove: Move
    bestMove: Move
    bestScore: float
    sourceCategory: TrainingCategory
    sourceScoreLoss: float
    trainingType: Literal["BEST_MOVE"] = "BEST_MOVE"
    trainingTags: list[str]
    difficultyTag: Literal["UNCALIBRATED"] = "UNCALIBRATED"
    scoringConfig: ReviewConfig
    reviewConfigVersion: int
    scoringDepth: int = Field(ge=1)
    generationVersion: int = 1
    createdAt: datetime


class TrainingQuestion(StrictModel):
    id: str
    player: Player
    stateSnapshot: GameState
    sourceTurn: int
    sourceCategory: TrainingCategory
    trainingType: Literal["BEST_MOVE"]
    trainingTags: list[str]
    difficultyTag: Literal["UNCALIBRATED"]

    @classmethod
    def from_item(cls, item: TrainingItemInternal) -> "TrainingQuestion":
        return cls.model_validate(item.model_dump(include=set(cls.model_fields)))


class TrainingList(StrictModel):
    items: list[TrainingQuestion]
    total: int


class TrainingLegalMoves(StrictModel):
    moves: list[Move]


class TrainingAnswerRequest(StrictModel):
    from_node: NodeId
    to_node: NodeId
    client_attempt_id: str = Field(min_length=8, max_length=64)


class TrainingAnswerResult(StrictModel):
    id: str
    trainingId: str
    clientAttemptId: str
    submittedMove: Move
    legal: Literal[True] = True
    bestMoveEquivalent: bool
    bestMove: Move
    bestScore: float
    submittedMoveScore: float
    scoreLoss: float
    result: TrainingResultKind
    feedback: str
    searchDepth: int
    timedOut: bool
    hintLevelUsed: int | None = None
    answeredAt: datetime
