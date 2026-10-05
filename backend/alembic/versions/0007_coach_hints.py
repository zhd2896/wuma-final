"""Persist version-bound, level-specific live Coach hints."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.mysql import DATETIME

revision = "0007_coach_hints"
down_revision = "0006_review_explanations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "coach_hints",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("game_id", sa.String(32), sa.ForeignKey("games.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("game_version", sa.Integer(), nullable=False),
        sa.Column("analyzed_player", sa.String(1), nullable=False),
        sa.Column("hint_level", sa.Integer(), nullable=False),
        sa.Column("hint_text", sa.String(240), nullable=False),
        sa.Column("focus_topics", sa.JSON(), nullable=False),
        sa.Column("candidate_nodes", sa.JSON(), nullable=False),
        sa.Column("best_move", sa.JSON(none_as_null=True)),
        sa.Column("provider", sa.String(64), nullable=False),
        sa.Column("model", sa.String(128)),
        sa.Column("prompt_version", sa.String(64), nullable=False),
        sa.Column("fallback_used", sa.Boolean(), nullable=False),
        sa.Column("created_at", DATETIME(fsp=6), nullable=False),
        sa.UniqueConstraint("game_id", "game_version", "analyzed_player", "hint_level",
                            "prompt_version", name="uq_coach_hint_version_level"),
        mysql_charset="utf8mb4",
    )


def downgrade() -> None:
    op.drop_table("coach_hints")
