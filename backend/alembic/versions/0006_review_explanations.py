"""Persist versioned explanations separately from immutable review calculations."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.mysql import DATETIME

revision = "0006_review_explanations"
down_revision = "0005_game_reviews"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "review_explanations",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("game_review_id", sa.String(32), sa.ForeignKey("game_reviews.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("prompt_version", sa.String(64), nullable=False),
        sa.Column("provider", sa.String(64), nullable=False),
        sa.Column("model", sa.String(128)),
        sa.Column("fallback_used", sa.Boolean(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", DATETIME(fsp=6), nullable=False),
        sa.UniqueConstraint("game_review_id", "prompt_version",
                            name="uq_review_explanation_version"),
        mysql_charset="utf8mb4",
    )


def downgrade() -> None:
    op.drop_table("review_explanations")
