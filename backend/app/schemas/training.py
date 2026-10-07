"""Private training facts and answer-free public question DTOs."""

from datetime import datetime
from typing import Literal

from pydantic import Field

from backend.app.schemas.game import GameState, Move, NodeId, Player, ReviewConfig, StrictModel


TrainingCategory = Literal["MISTAKE", "BLUNDER"]
TrainingResultKind = Literal["CORRECT", "SUBOPTIMAL"]
DifficultyTag = Literal["UNCALIBRATED", "EASY", "NORMAL", "COMPLEX"]


class TrainingProgress(StrictModel):
    attemptCount: int = 0
    latestResult: TrainingResultKind | None = None
    completed: bool = False


class TrainingDifficultyBasis(StrictModel):
    kind: Literal["ENGINE_ESTIMATE", "LESSON_DESIGN"] = "ENGINE_ESTIMATE"
    legalCandidateCount: int
    scoringDepth: int
    configVersion: int
    methodVersion: int = 1


class TrainingCalibration(StrictModel):
    sampleCount: int = Field(ge=0)
    firstTryCorrectCount: int = Field(ge=0)
    minimumSamples: int = Field(ge=1)
    status: Literal['COLLECTING', 'CALIBRATED']
    suggestedDifficulty: Literal['EASY', 'NORMAL', 'COMPLEX'] | None = None
    methodVersion: int = 1


class TrainingSource(StrictModel):
    sourceMoveId: int
    sourceMoveReviewId: int
    stateSnapshot: GameState
    stateSchemaVersion: int
    originalMove: Move


class TrainingItemInternal(StrictModel):
    id: str
    sourceKind: Literal["REVIEW", "CURATED"] = "REVIEW"
    title: str = "复盘最佳走法"
    catalogVersion: int | None = None
    sourceGameId: str | None = None
    sourceMoveId: int | None = None
    sourceMoveReviewId: int | None = None
    sourceTurn: int | None = None
    player: Player
    stateSnapshot: GameState
    stateSchemaVersion: int
    originalMove: Move | None = None
    bestMove: Move
    bestScore: float
    sourceCategory: TrainingCategory | None = None
    sourceScoreLoss: float | None = None
    trainingType: Literal["BEST_MOVE"] = "BEST_MOVE"
    trainingTags: list[str]
    difficultyTag: DifficultyTag = "UNCALIBRATED"
    difficultyBasis: TrainingDifficultyBasis | None = None
    scoringConfig: ReviewConfig
    reviewConfigVersion: int
    scoringDepth: int = Field(ge=1)
    generationVersion: int = 1
    createdAt: datetime


class TrainingQuestion(StrictModel):
    id: str
    sourceKind: Literal["REVIEW", "CURATED"]
    title: str
    catalogVersion: int | None
    sourceGameId: str | None
    player: Player
    stateSnapshot: GameState
    sourceTurn: int | None
    sourceCategory: TrainingCategory | None
    trainingType: Literal["BEST_MOVE"]
    trainingTags: list[str]
    difficultyTag: DifficultyTag
    difficultyBasis: TrainingDifficultyBasis | None
    progress: TrainingProgress = Field(default_factory=TrainingProgress)
    learningGoal: str | None = None
    difficultyCalibration: TrainingCalibration | None = None

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
    lessonExplanation: str | None = None
