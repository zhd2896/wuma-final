"""Persistence projections only. All chess behavior belongs to the TypeScript engine."""

from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, ForeignKey, Index, Integer, JSON, String, UniqueConstraint
from sqlalchemy.dialects.mysql import DATETIME, DOUBLE
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.db.base import Base


def utc_now() -> datetime:
    """MySQL DATETIME stores UTC without an offset; every write uses this helper."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class UserModel(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    external_user_id: Mapped[str | None] = mapped_column(String(128), unique=True)
    nickname: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), default=utc_now, onupdate=utc_now, nullable=False)


class GameModel(Base):
    __tablename__ = "games"
    __table_args__ = (Index("ix_games_user_id", "user_id"), Index("ix_games_status", "status"))

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id", ondelete="RESTRICT"))
    mode: Mapped[str] = mapped_column(String(16), nullable=False)
    ai_level: Mapped[str | None] = mapped_column(String(32))
    ai_player: Mapped[str | None] = mapped_column(String(1))
    first_player: Mapped[str] = mapped_column(String(1), nullable=False)
    current_player: Mapped[str] = mapped_column(String(1), nullable=False)
    winner: Mapped[str | None] = mapped_column(String(1))
    winner_reason: Mapped[str | None] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    initial_state: Mapped[dict] = mapped_column(JSON, nullable=False)
    current_state: Mapped[dict] = mapped_column(JSON, nullable=False)
    state_schema_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DATETIME(fsp=6))
    duration_ms: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), default=utc_now, onupdate=utc_now, nullable=False)


class GameMoveModel(Base):
    __tablename__ = "game_moves"
    __table_args__ = (
        UniqueConstraint("game_id", "turn_number", name="uq_game_moves_game_turn"),
        Index("ix_game_moves_game_id", "game_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    game_id: Mapped[str] = mapped_column(String(32), ForeignKey("games.id", ondelete="RESTRICT"), nullable=False)
    turn_number: Mapped[int] = mapped_column(Integer, nullable=False)
    player: Mapped[str] = mapped_column(String(1), nullable=False)
    actor_type: Mapped[str] = mapped_column(String(8), nullable=False)
    from_node: Mapped[str] = mapped_column(String(3), nullable=False)
    to_node: Mapped[str] = mapped_column(String(3), nullable=False)
    board_before: Mapped[dict] = mapped_column(JSON, nullable=False)
    board_after: Mapped[dict] = mapped_column(JSON, nullable=False)
    reserve_a_before: Mapped[int] = mapped_column(Integer, nullable=False)
    reserve_b_before: Mapped[int] = mapped_column(Integer, nullable=False)
    reserve_a_after: Mapped[int] = mapped_column(Integer, nullable=False)
    reserve_b_after: Mapped[int] = mapped_column(Integer, nullable=False)
    capture_result: Mapped[dict] = mapped_column(JSON, nullable=False)
    winner: Mapped[str | None] = mapped_column(String(1))
    winner_reason: Mapped[str | None] = mapped_column(String(40))
    game_over: Mapped[bool] = mapped_column(nullable=False)
    state_before: Mapped[dict] = mapped_column(JSON, nullable=False)
    state_after: Mapped[dict] = mapped_column(JSON, nullable=False)
    state_schema_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    turn_result: Mapped[dict] = mapped_column(JSON, nullable=False)
    ai_search_result: Mapped[dict | None] = mapped_column(JSON(none_as_null=True))
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), default=utc_now, nullable=False)


class AiAnalysisModel(Base):
    __tablename__ = "ai_analysis"
    __table_args__ = (Index("ix_ai_analysis_game_version", "game_id", "game_version"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    game_id: Mapped[str] = mapped_column(String(32), ForeignKey("games.id", ondelete="RESTRICT"), nullable=False)
    game_version: Mapped[int] = mapped_column(Integer, nullable=False)
    analyzed_player: Mapped[str] = mapped_column(String(1), nullable=False)
    best_move: Mapped[dict | None] = mapped_column(JSON(none_as_null=True))
    best_score: Mapped[float] = mapped_column(DOUBLE(asdecimal=False), nullable=False)
    score_perspective: Mapped[str] = mapped_column(String(1), nullable=False)
    evaluation_before: Mapped[dict] = mapped_column(JSON, nullable=False)
    evaluation_breakdown: Mapped[dict] = mapped_column(JSON, nullable=False)
    candidate_moves: Mapped[list] = mapped_column(JSON, nullable=False)
    threats: Mapped[list] = mapped_column(JSON, nullable=False)
    search_depth: Mapped[int] = mapped_column(Integer, nullable=False)
    nodes_searched: Mapped[int] = mapped_column(BigInteger, nullable=False)
    thinking_time_ms: Mapped[float] = mapped_column(DOUBLE(asdecimal=False), nullable=False)
    algorithm: Mapped[str] = mapped_column(String(64), nullable=False)
    tt_hits: Mapped[int] = mapped_column(BigInteger, nullable=False)
    timed_out: Mapped[bool] = mapped_column(Boolean, nullable=False)
    terminal: Mapped[bool] = mapped_column(Boolean, nullable=False)
    winner: Mapped[str | None] = mapped_column(String(1))
    winner_reason: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), default=utc_now, nullable=False)


class GameReviewModel(Base):
    __tablename__ = "game_reviews"
    __table_args__ = (UniqueConstraint("game_id", "reviewed_player", "review_config_version",
                                     name="uq_game_review_version"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    game_id: Mapped[str] = mapped_column(String(32), ForeignKey("games.id", ondelete="RESTRICT"), nullable=False)
    reviewed_player: Mapped[str] = mapped_column(String(1), nullable=False)
    overall_score: Mapped[float | None] = mapped_column(DOUBLE(asdecimal=False))
    good_moves: Mapped[int] = mapped_column(Integer, nullable=False)
    normal_moves: Mapped[int] = mapped_column(Integer, nullable=False)
    mistakes: Mapped[int] = mapped_column(Integer, nullable=False)
    blunders: Mapped[int] = mapped_column(Integer, nullable=False)
    best_move_rate: Mapped[float] = mapped_column(DOUBLE(asdecimal=False), nullable=False)
    turning_points: Mapped[list] = mapped_column(JSON, nullable=False)
    winner: Mapped[str | None] = mapped_column(String(1))
    winner_reason: Mapped[str | None] = mapped_column(String(40))
    review_config: Mapped[dict] = mapped_column(JSON, nullable=False)
    review_config_version: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)


class MoveReviewModel(Base):
    __tablename__ = "move_reviews"
    __table_args__ = (UniqueConstraint("game_review_id", "game_move_id",
                                     name="uq_move_review_source"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    game_review_id: Mapped[str] = mapped_column(String(32), ForeignKey("game_reviews.id", ondelete="RESTRICT"), nullable=False)
    game_move_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("game_moves.id", ondelete="RESTRICT"), nullable=False)
    turn_number: Mapped[int] = mapped_column(Integer, nullable=False)
    player: Mapped[str] = mapped_column(String(1), nullable=False)
    actual_move: Mapped[dict] = mapped_column(JSON, nullable=False)
    best_move: Mapped[dict] = mapped_column(JSON, nullable=False)
    score_before: Mapped[float] = mapped_column(DOUBLE(asdecimal=False), nullable=False)
    score_after: Mapped[float] = mapped_column(DOUBLE(asdecimal=False), nullable=False)
    best_score: Mapped[float] = mapped_column(DOUBLE(asdecimal=False), nullable=False)
    actual_move_score: Mapped[float] = mapped_column(DOUBLE(asdecimal=False), nullable=False)
    score_loss: Mapped[float] = mapped_column(DOUBLE(asdecimal=False), nullable=False)
    category: Mapped[str] = mapped_column(String(16), nullable=False)
    evaluation_before: Mapped[dict] = mapped_column(JSON, nullable=False)
    evaluation_after: Mapped[dict] = mapped_column(JSON, nullable=False)
    candidate_moves: Mapped[list] = mapped_column(JSON, nullable=False)
    threats: Mapped[list] = mapped_column(JSON, nullable=False)
    engine_explanation: Mapped[str] = mapped_column(String(512), nullable=False)
    search_depth: Mapped[int] = mapped_column(Integer, nullable=False)
    timed_out: Mapped[bool] = mapped_column(Boolean, nullable=False)
    analysis: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)


class ReviewExplanationModel(Base):
    __tablename__ = "review_explanations"
    __table_args__ = (UniqueConstraint("game_review_id", "prompt_version",
                                     name="uq_review_explanation_version"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    game_review_id: Mapped[str] = mapped_column(String(32), ForeignKey("game_reviews.id", ondelete="RESTRICT"), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(64), nullable=False)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    model: Mapped[str | None] = mapped_column(String(128))
    fallback_used: Mapped[bool] = mapped_column(Boolean, nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)


class CoachHintModel(Base):
    __tablename__ = "coach_hints"
    __table_args__ = (UniqueConstraint("game_id", "game_version", "analyzed_player",
                                     "hint_level", "prompt_version",
                                     name="uq_coach_hint_version_level"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    game_id: Mapped[str] = mapped_column(String(32), ForeignKey("games.id", ondelete="RESTRICT"), nullable=False)
    game_version: Mapped[int] = mapped_column(Integer, nullable=False)
    analyzed_player: Mapped[str] = mapped_column(String(1), nullable=False)
    hint_level: Mapped[int] = mapped_column(Integer, nullable=False)
    hint_text: Mapped[str] = mapped_column(String(240), nullable=False)
    focus_topics: Mapped[list] = mapped_column(JSON, nullable=False)
    candidate_nodes: Mapped[list] = mapped_column(JSON, nullable=False)
    best_move: Mapped[dict | None] = mapped_column(JSON(none_as_null=True))
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    model: Mapped[str | None] = mapped_column(String(128))
    prompt_version: Mapped[str] = mapped_column(String(64), nullable=False)
    fallback_used: Mapped[bool] = mapped_column(Boolean, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)


class TrainingItemModel(Base):
    __tablename__ = "training_items"
    __table_args__ = (
        UniqueConstraint("source_move_review_id", "training_type", "generation_version",
                         name="uq_training_source_type_version"),
        Index("ix_training_items_category_created", "source_category", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    source_game_id: Mapped[str] = mapped_column(String(32), ForeignKey("games.id", ondelete="RESTRICT"), nullable=False)
    source_move_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("game_moves.id", ondelete="RESTRICT"), nullable=False)
    source_move_review_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("move_reviews.id", ondelete="RESTRICT"), nullable=False)
    source_turn: Mapped[int] = mapped_column(Integer, nullable=False)
    player: Mapped[str] = mapped_column(String(1), nullable=False)
    state_snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    state_schema_version: Mapped[int] = mapped_column(Integer, nullable=False)
    original_move: Mapped[dict] = mapped_column(JSON, nullable=False)
    best_move: Mapped[dict] = mapped_column(JSON, nullable=False)
    best_score: Mapped[float] = mapped_column(DOUBLE(asdecimal=False), nullable=False)
    source_category: Mapped[str] = mapped_column(String(16), nullable=False)
    source_score_loss: Mapped[float] = mapped_column(DOUBLE(asdecimal=False), nullable=False)
    training_type: Mapped[str] = mapped_column(String(24), nullable=False)
    training_tags: Mapped[list] = mapped_column(JSON, nullable=False)
    difficulty_tag: Mapped[str] = mapped_column(String(24), nullable=False)
    scoring_config: Mapped[dict] = mapped_column(JSON, nullable=False)
    review_config_version: Mapped[int] = mapped_column(Integer, nullable=False)
    scoring_depth: Mapped[int] = mapped_column(Integer, nullable=False)
    generation_version: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)


class TrainingRecordModel(Base):
    __tablename__ = "training_records"
    __table_args__ = (
        UniqueConstraint("client_attempt_id", name="uq_training_client_attempt"),
        Index("ix_training_records_item_answered", "training_item_id", "answered_at"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    training_item_id: Mapped[str] = mapped_column(String(32), ForeignKey("training_items.id", ondelete="RESTRICT"), nullable=False)
    user_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id", ondelete="RESTRICT"))
    client_attempt_id: Mapped[str] = mapped_column(String(64), nullable=False)
    submitted_move: Mapped[dict] = mapped_column(JSON, nullable=False)
    legal: Mapped[bool] = mapped_column(Boolean, nullable=False)
    best_move_equivalent: Mapped[bool] = mapped_column(Boolean, nullable=False)
    best_score: Mapped[float] = mapped_column(DOUBLE(asdecimal=False), nullable=False)
    submitted_move_score: Mapped[float] = mapped_column(DOUBLE(asdecimal=False), nullable=False)
    score_loss: Mapped[float] = mapped_column(DOUBLE(asdecimal=False), nullable=False)
    result: Mapped[str] = mapped_column(String(16), nullable=False)
    feedback: Mapped[str] = mapped_column(String(255), nullable=False)
    search_depth: Mapped[int] = mapped_column(Integer, nullable=False)
    timed_out: Mapped[bool] = mapped_column(Boolean, nullable=False)
    hint_level_used: Mapped[int | None] = mapped_column(Integer)
    answered_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
