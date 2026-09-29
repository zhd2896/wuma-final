"""Validated explanatory text; review and engine fields remain authoritative."""

from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator

from backend.app.schemas.game import GameReview, StrictModel


PROMPT_VERSION = "review_explanation_v1"
ShortText = str


class MoveExplanationText(StrictModel):
    headline: ShortText = Field(min_length=1, max_length=80)
    explanation: ShortText = Field(min_length=1, max_length=280)
    suggestion: ShortText = Field(min_length=1, max_length=160)

    @field_validator("headline", "explanation", "suggestion")
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Explanation text must not be blank")
        return value.strip()


class GameExplanationText(StrictModel):
    overall_summary: ShortText = Field(min_length=1, max_length=300)
    strengths: list[ShortText] = Field(max_length=3)
    main_problems: list[ShortText] = Field(max_length=3)
    practice_suggestions: list[ShortText] = Field(max_length=3)

    @field_validator("overall_summary")
    @classmethod
    def nonblank_summary(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Summary must not be blank")
        return value.strip()

    @field_validator("strengths", "main_problems", "practice_suggestions")
    @classmethod
    def bounded_items(cls, values: list[str]) -> list[str]:
        if any(not value.strip() or len(value) > 120 for value in values):
            raise ValueError("List entries must be short and nonblank")
        return [value.strip() for value in values]


class MoveExplanation(MoveExplanationText):
    turn: int
    provider: str
    model: str | None
    promptVersion: Literal["review_explanation_v1"] = PROMPT_VERSION
    fallbackUsed: bool


class GameExplanation(GameExplanationText):
    provider: str
    model: str | None
    promptVersion: Literal["review_explanation_v1"] = PROMPT_VERSION
    fallbackUsed: bool


class ExplanationBundle(StrictModel):
    gameReviewId: str
    promptVersion: Literal["review_explanation_v1"] = PROMPT_VERSION
    gameExplanation: GameExplanation
    moveExplanations: list[MoveExplanation]
    createdAt: datetime


class ExplainedReview(StrictModel):
    review: GameReview
    explanation: ExplanationBundle
