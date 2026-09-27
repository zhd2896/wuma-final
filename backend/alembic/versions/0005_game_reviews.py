"""Persist complete structured game and move reviews."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.mysql import DATETIME

revision = "0005_game_reviews"
down_revision = "0004_ai_analysis"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "game_reviews",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("game_id", sa.String(32), sa.ForeignKey("games.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("reviewed_player", sa.String(1), nullable=False),
        sa.Column("overall_score", sa.Float(precision=53)),
        sa.Column("good_moves", sa.Integer(), nullable=False),
        sa.Column("normal_moves", sa.Integer(), nullable=False),
        sa.Column("mistakes", sa.Integer(), nullable=False),
        sa.Column("blunders", sa.Integer(), nullable=False),
        sa.Column("best_move_rate", sa.Float(precision=53), nullable=False),
        sa.Column("turning_points", sa.JSON(), nullable=False),
        sa.Column("winner", sa.String(1)),
        sa.Column("winner_reason", sa.String(40)),
        sa.Column("review_config", sa.JSON(), nullable=False),
        sa.Column("review_config_version", sa.Integer(), nullable=False),
        sa.Column("created_at", DATETIME(fsp=6), nullable=False),
        sa.UniqueConstraint("game_id", "reviewed_player", "review_config_version",
                            name="uq_game_review_version"),
    )
    op.create_table(
        "move_reviews",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("game_review_id", sa.String(32), sa.ForeignKey("game_reviews.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("game_move_id", sa.BigInteger(), sa.ForeignKey("game_moves.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("turn_number", sa.Integer(), nullable=False),
        sa.Column("player", sa.String(1), nullable=False),
        sa.Column("actual_move", sa.JSON(), nullable=False),
        sa.Column("best_move", sa.JSON(), nullable=False),
        sa.Column("score_before", sa.Float(precision=53), nullable=False),
        sa.Column("score_after", sa.Float(precision=53), nullable=False),
        sa.Column("best_score", sa.Float(precision=53), nullable=False),
        sa.Column("actual_move_score", sa.Float(precision=53), nullable=False),
        sa.Column("score_loss", sa.Float(precision=53), nullable=False),
        sa.Column("category", sa.String(16), nullable=False),
        sa.Column("evaluation_before", sa.JSON(), nullable=False),
        sa.Column("evaluation_after", sa.JSON(), nullable=False),
        sa.Column("candidate_moves", sa.JSON(), nullable=False),
        sa.Column("threats", sa.JSON(), nullable=False),
        sa.Column("engine_explanation", sa.String(512), nullable=False),
        sa.Column("search_depth", sa.Integer(), nullable=False),
        sa.Column("timed_out", sa.Boolean(), nullable=False),
        sa.Column("analysis", sa.JSON(), nullable=False),
        sa.Column("created_at", DATETIME(fsp=6), nullable=False),
        sa.UniqueConstraint("game_review_id", "game_move_id", name="uq_move_review_source"),
    )


def downgrade() -> None:
    op.drop_table("move_reviews")
    op.drop_table("game_reviews")
