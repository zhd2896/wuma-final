"""Initial persistent game history.

Revision ID: 0001_initial_schema
Revises:
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import DATETIME


revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("external_user_id", sa.String(128), nullable=True, unique=True),
        sa.Column("nickname", sa.String(255), nullable=True),
        sa.Column("created_at", DATETIME(fsp=6), nullable=False),
        sa.Column("updated_at", DATETIME(fsp=6), nullable=False),
        mysql_charset="utf8mb4",
    )
    op.create_table(
        "games",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("user_id", sa.String(32), sa.ForeignKey("users.id", ondelete="RESTRICT")),
        sa.Column("mode", sa.String(16), nullable=False),
        sa.Column("ai_level", sa.String(32)),
        sa.Column("first_player", sa.String(1), nullable=False),
        sa.Column("current_player", sa.String(1), nullable=False),
        sa.Column("winner", sa.String(1)),
        sa.Column("winner_reason", sa.String(40)),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("initial_state", sa.JSON(), nullable=False),
        sa.Column("current_state", sa.JSON(), nullable=False),
        sa.Column("state_schema_version", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("started_at", DATETIME(fsp=6), nullable=False),
        sa.Column("finished_at", DATETIME(fsp=6)),
        sa.Column("duration_ms", sa.BigInteger()),
        sa.Column("created_at", DATETIME(fsp=6), nullable=False),
        sa.Column("updated_at", DATETIME(fsp=6), nullable=False),
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_games_user_id", "games", ["user_id"])
    op.create_index("ix_games_status", "games", ["status"])
    op.create_table(
        "game_moves",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("game_id", sa.String(32), sa.ForeignKey("games.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("turn_number", sa.Integer(), nullable=False),
        sa.Column("player", sa.String(1), nullable=False),
        sa.Column("actor_type", sa.String(8), nullable=False),
        sa.Column("from_node", sa.String(3), nullable=False),
        sa.Column("to_node", sa.String(3), nullable=False),
        sa.Column("board_before", sa.JSON(), nullable=False),
        sa.Column("board_after", sa.JSON(), nullable=False),
        sa.Column("reserve_a_before", sa.Integer(), nullable=False),
        sa.Column("reserve_b_before", sa.Integer(), nullable=False),
        sa.Column("reserve_a_after", sa.Integer(), nullable=False),
        sa.Column("reserve_b_after", sa.Integer(), nullable=False),
        sa.Column("capture_result", sa.JSON(), nullable=False),
        sa.Column("winner", sa.String(1)),
        sa.Column("winner_reason", sa.String(40)),
        sa.Column("game_over", sa.Boolean(), nullable=False),
        sa.Column("state_before", sa.JSON(), nullable=False),
        sa.Column("state_after", sa.JSON(), nullable=False),
        sa.Column("state_schema_version", sa.Integer(), nullable=False),
        sa.Column("turn_result", sa.JSON(), nullable=False),
        sa.Column("ai_search_result", sa.JSON()),
        sa.Column("created_at", DATETIME(fsp=6), nullable=False),
        sa.UniqueConstraint("game_id", "turn_number", name="uq_game_moves_game_turn"),
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_game_moves_game_id", "game_moves", ["game_id"])


def downgrade() -> None:
    op.drop_table("game_moves")
    op.drop_table("games")
    op.drop_table("users")
