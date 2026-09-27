"""Historical review training questions and idempotent answer attempts."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.mysql import DATETIME, DOUBLE

revision = "0008_training"
down_revision = "0007_coach_hints"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "training_items",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("source_game_id", sa.String(32), sa.ForeignKey("games.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("source_move_id", sa.BigInteger(), sa.ForeignKey("game_moves.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("source_move_review_id", sa.BigInteger(), sa.ForeignKey("move_reviews.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("source_turn", sa.Integer(), nullable=False),
        sa.Column("player", sa.String(1), nullable=False),
        sa.Column("state_snapshot", sa.JSON(), nullable=False),
        sa.Column("state_schema_version", sa.Integer(), nullable=False),
        sa.Column("original_move", sa.JSON(), nullable=False),
        sa.Column("best_move", sa.JSON(), nullable=False),
        sa.Column("best_score", DOUBLE(asdecimal=False), nullable=False),
        sa.Column("source_category", sa.String(16), nullable=False),
        sa.Column("source_score_loss", DOUBLE(asdecimal=False), nullable=False),
        sa.Column("training_type", sa.String(24), nullable=False),
        sa.Column("training_tags", sa.JSON(), nullable=False),
        sa.Column("difficulty_tag", sa.String(24), nullable=False),
        sa.Column("scoring_config", sa.JSON(), nullable=False),
        sa.Column("review_config_version", sa.Integer(), nullable=False),
        sa.Column("scoring_depth", sa.Integer(), nullable=False),
        sa.Column("generation_version", sa.Integer(), nullable=False),
        sa.Column("created_at", DATETIME(fsp=6), nullable=False),
        sa.UniqueConstraint("source_move_review_id", "training_type", "generation_version",
                            name="uq_training_source_type_version"),
    )
    op.create_index("ix_training_items_category_created", "training_items",
                    ["source_category", "created_at"])
    op.create_table(
        "training_records",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("training_item_id", sa.String(32), sa.ForeignKey("training_items.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("user_id", sa.String(32), sa.ForeignKey("users.id", ondelete="RESTRICT")),
        sa.Column("client_attempt_id", sa.String(64), nullable=False),
        sa.Column("submitted_move", sa.JSON(), nullable=False),
        sa.Column("legal", sa.Boolean(), nullable=False),
        sa.Column("best_move_equivalent", sa.Boolean(), nullable=False),
        sa.Column("best_score", DOUBLE(asdecimal=False), nullable=False),
        sa.Column("submitted_move_score", DOUBLE(asdecimal=False), nullable=False),
        sa.Column("score_loss", DOUBLE(asdecimal=False), nullable=False),
        sa.Column("result", sa.String(16), nullable=False),
        sa.Column("feedback", sa.String(255), nullable=False),
        sa.Column("search_depth", sa.Integer(), nullable=False),
        sa.Column("timed_out", sa.Boolean(), nullable=False),
        sa.Column("hint_level_used", sa.Integer()),
        sa.Column("answered_at", DATETIME(fsp=6), nullable=False),
        sa.UniqueConstraint("client_attempt_id", name="uq_training_client_attempt"),
    )
    op.create_index("ix_training_records_item_answered", "training_records",
                    ["training_item_id", "answered_at"])


def downgrade() -> None:
    op.drop_index("ix_training_records_item_answered", table_name="training_records")
    op.drop_table("training_records")
    op.drop_index("ix_training_items_category_created", table_name="training_items")
    op.drop_table("training_items")
