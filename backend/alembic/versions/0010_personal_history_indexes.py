"""Indexes for owner-filtered history and personal training totals.

Revision ID: 0010_personal_history_indexes
Revises: 0009_remote_rooms
"""

from alembic import op

revision = "0010_personal_history_indexes"
down_revision = "0009_remote_rooms"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_games_owner_created", "games", ["user_id", "created_at", "id"])
    op.create_index("ix_training_records_user_id", "training_records", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_training_records_user_id", table_name="training_records")
    op.drop_index("ix_games_owner_created", table_name="games")
