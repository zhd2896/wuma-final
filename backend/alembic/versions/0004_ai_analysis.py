"""Versioned read-only AI position analysis.

Revision ID: 0004_ai_analysis
Revises: 0003_ai_search_sql_null
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.mysql import DATETIME


revision = "0004_ai_analysis"
down_revision = "0003_ai_search_sql_null"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_analysis",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("game_id", sa.String(32), sa.ForeignKey("games.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("game_version", sa.Integer(), nullable=False),
        sa.Column("analyzed_player", sa.String(1), nullable=False),
        sa.Column("best_move", sa.JSON(), nullable=True),
        sa.Column("best_score", sa.Float(precision=53), nullable=False),
        sa.Column("score_perspective", sa.String(1), nullable=False),
        sa.Column("evaluation_before", sa.JSON(), nullable=False),
        sa.Column("evaluation_breakdown", sa.JSON(), nullable=False),
        sa.Column("candidate_moves", sa.JSON(), nullable=False),
        sa.Column("threats", sa.JSON(), nullable=False),
        sa.Column("search_depth", sa.Integer(), nullable=False),
        sa.Column("nodes_searched", sa.BigInteger(), nullable=False),
        sa.Column("thinking_time_ms", sa.Float(precision=53), nullable=False),
        sa.Column("algorithm", sa.String(64), nullable=False),
        sa.Column("tt_hits", sa.BigInteger(), nullable=False),
        sa.Column("timed_out", sa.Boolean(), nullable=False),
        sa.Column("terminal", sa.Boolean(), nullable=False),
        sa.Column("winner", sa.String(1), nullable=True),
        sa.Column("winner_reason", sa.String(40), nullable=True),
        sa.Column("created_at", DATETIME(fsp=6), nullable=False),
    )
    op.create_index("ix_ai_analysis_game_version", "ai_analysis", ["game_id", "game_version"])


def downgrade() -> None:
    op.drop_index("ix_ai_analysis_game_version", table_name="ai_analysis")
    op.drop_table("ai_analysis")
