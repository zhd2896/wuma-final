"""Normalize missing AI search results to SQL NULL.

Revision ID: 0003_ai_search_sql_null
Revises: 0002_ai_player
"""

from alembic import op


revision = "0003_ai_search_sql_null"
down_revision = "0002_ai_player"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE game_moves SET ai_search_result = NULL "
               "WHERE JSON_TYPE(ai_search_result) = 'NULL'")


def downgrade() -> None:
    pass
