"""Persist AI player identity for AI games.

Revision ID: 0002_ai_player
Revises: 0001_initial_schema
"""

from alembic import op
import sqlalchemy as sa


revision = "0002_ai_player"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("games", sa.Column("ai_player", sa.String(1), nullable=True))


def downgrade() -> None:
    op.drop_column("games", "ai_player")
