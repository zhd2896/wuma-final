"""Persist remote undo resolution request signatures.

Revision ID: 0012_remote_undo_idempotency
Revises: 0011_game_operations
"""

from alembic import op
import sqlalchemy as sa


revision = "0012_remote_undo_idempotency"
down_revision = "0011_game_operations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("remote_undo_requests", sa.Column(
        "resolve_expected_version", sa.Integer(), nullable=True))
    op.add_column("remote_undo_requests", sa.Column(
        "resolve_action", sa.String(length=16), nullable=True))


def downgrade() -> None:
    op.drop_column("remote_undo_requests", "resolve_action")
    op.drop_column("remote_undo_requests", "resolve_expected_version")
