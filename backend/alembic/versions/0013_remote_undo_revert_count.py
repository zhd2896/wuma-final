"""Persist the remote undo result count for stable idempotent retries.

Revision ID: 0013_remote_undo_revert_count
Revises: 0012_remote_undo_idempotency
"""

from alembic import op
import sqlalchemy as sa


revision = "0013_remote_undo_revert_count"
down_revision = "0012_remote_undo_idempotency"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("remote_undo_requests", sa.Column(
        "revert_count", sa.Integer(), nullable=True))
    op.execute(
        "UPDATE remote_undo_requests AS request "
        "SET revert_count = ("
        "SELECT COUNT(*) FROM game_moves AS move "
        "WHERE move.game_id = request.game_id "
        "AND move.turn_number >= request.anchor_turn "
        "AND move.created_revision <= request.base_revision "
        "AND (move.reverted_revision IS NULL "
        "OR move.reverted_revision > request.base_revision))"
    )
    op.alter_column(
        "remote_undo_requests", "revert_count",
        existing_type=sa.Integer(), nullable=False)


def downgrade() -> None:
    op.drop_column("remote_undo_requests", "revert_count")
