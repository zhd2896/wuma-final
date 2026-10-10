"""Version-bound, level-specific coaching DTOs."""

from datetime import datetime
from typing import Literal

from pydantic import Field

from backend.app.schemas.game import Move, NodeId, Player, StrictModel


PROMPT_VERSION = "coach_hint_v3"
HintLevel = Literal[1, 2, 3]


class CoachHintRequest(StrictModel):
    level: int
    expected_version: int = Field(ge=0)


class CoachHintText(StrictModel):
    hintText: str = Field(min_length=1, max_length=240)


class CoachHint(StrictModel):
    gameId: str
    gameVersion: int
    analyzedPlayer: Player
    level: HintLevel
    hintText: str
    focusTopics: list[str]
    candidateFromNodes: list[NodeId]
    bestMove: Move | None
    fallbackUsed: bool
    provider: str
    model: str | None
    promptVersion: str = PROMPT_VERSION
    generatedAt: datetime
