"""Stable public errors; the engine remains the source of chess behavior."""

from dataclasses import dataclass


HTTP_STATUS = {
    "INVALID_REQUEST": 422,
    "INVALID_MOVE": 400,
    "NOT_PLAYER_TURN": 409,
    "NOT_HUMAN_TURN": 409,
    "NOT_AI_TURN": 409,
    "AI_MODE_REQUIRED": 409,
    "GAME_ALREADY_FINISHED": 409,
    "NODE_NOT_FOUND": 422,
    "PATH_BLOCKED": 400,
    "TARGET_OCCUPIED": 400,
    "INSUFFICIENT_RESERVE": 409,
    "GAME_NOT_FOUND": 404,
    "RULE_AMBIGUITY": 409,
    "ENGINE_UNAVAILABLE": 503,
    "ENGINE_FAILURE": 500,
    "DATABASE_UNAVAILABLE": 503,
    "GAME_STATE_CONFLICT": 409,
    "REPLAY_INTEGRITY_ERROR": 500,
    "REVIEW_INCOMPLETE": 409,
    "REVIEW_NOT_FOUND": 404,
    "EXPLANATION_NOT_FOUND": 404,
    "GAME_NOT_FINISHED": 409,
    "INVALID_HINT_LEVEL": 422,
    "REVIEW_REQUIRED": 409,
    "TRAINING_NOT_FOUND": 404,
    "TRAINING_ATTEMPT_CONFLICT": 409,
    "TRAINING_SCORING_INCOMPLETE": 409,
}


@dataclass
class ApiError(Exception):
    code: str
    message: str

    @property
    def status_code(self) -> int:
        return HTTP_STATUS.get(self.code, 500)
