"""Add revisioned moves and idempotent game operation events.

Revision ID: 0011_game_operations
Revises: 0010_personal_history_indexes
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

revision = "0011_game_operations"
down_revision = "0010_personal_history_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("games", sa.Column("ply_count", sa.Integer(), nullable=True))
    op.execute("UPDATE games SET ply_count = version")
    op.alter_column("games", "ply_count", existing_type=sa.Integer(), nullable=False)

    op.add_column("game_moves", sa.Column("created_revision", sa.Integer(), nullable=True))
    op.add_column("game_moves", sa.Column("reverted_revision", sa.Integer(), nullable=True))
    op.execute("UPDATE game_moves SET created_revision = turn_number")
    op.alter_column("game_moves", "created_revision", existing_type=sa.Integer(), nullable=False)
    op.drop_constraint("uq_game_moves_game_turn", "game_moves", type_="unique")
    op.create_unique_constraint(
        "uq_game_moves_game_revision", "game_moves", ["game_id", "created_revision"])
    op.create_index(
        "ix_game_moves_active_turn", "game_moves",
        ["game_id", "reverted_revision", "turn_number"])

    op.create_table(
        "game_undo_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("game_id", sa.String(length=32), nullable=False),
        sa.Column("client_request_id", sa.String(length=64), nullable=False),
        sa.Column("requester", sa.String(length=1), nullable=False),
        sa.Column("before_revision", sa.Integer(), nullable=False),
        sa.Column("after_revision", sa.Integer(), nullable=False),
        sa.Column("anchor_turn", sa.Integer(), nullable=False),
        sa.Column("reverted_count", sa.Integer(), nullable=False),
        sa.Column("state_after", sa.JSON(), nullable=False),
        sa.Column("created_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.ForeignKeyConstraint(["game_id"], ["games.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "game_id", "client_request_id", name="uq_game_undo_events_request"),
        mysql_charset="utf8mb4",
    )
    op.create_table(
        "game_terminal_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("game_id", sa.String(length=32), nullable=False),
        sa.Column("client_request_id", sa.String(length=64), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=16), nullable=False),
        sa.Column("actor", sa.String(length=1), nullable=False),
        sa.Column("winner", sa.String(length=1), nullable=False),
        sa.Column("state_before", sa.JSON(), nullable=False),
        sa.Column("state_after", sa.JSON(), nullable=False),
        sa.Column("created_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.ForeignKeyConstraint(["game_id"], ["games.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("game_id", name="uq_game_terminal_events_game"),
        sa.UniqueConstraint(
            "game_id", "client_request_id", name="uq_game_terminal_events_request"),
        mysql_charset="utf8mb4",
    )
    op.create_table(
        "remote_undo_requests",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("game_id", sa.String(length=32), nullable=False),
        sa.Column("requester", sa.String(length=1), nullable=False),
        sa.Column("responder", sa.String(length=1), nullable=False),
        sa.Column("create_client_request_id", sa.String(length=64), nullable=False),
        sa.Column("resolve_client_request_id", sa.String(length=64), nullable=True),
        sa.Column("base_revision", sa.Integer(), nullable=False),
        sa.Column("anchor_turn", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.Column("resolved_at", mysql.DATETIME(fsp=6), nullable=True),
        sa.ForeignKeyConstraint(["game_id"], ["games.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "game_id", "create_client_request_id", name="uq_remote_undo_requests_create"),
        sa.UniqueConstraint(
            "game_id", "resolve_client_request_id", name="uq_remote_undo_requests_resolve"),
        mysql_charset="utf8mb4",
    )
    op.create_index(
        "ix_remote_undo_requests_game_status", "remote_undo_requests", ["game_id", "status"])


def _guard_downgrade_against_branched_moves() -> None:
    bind = op.get_bind()
    duplicate = bind.execute(sa.text(
        "SELECT game_id, turn_number, COUNT(*) AS duplicate_count "
        "FROM game_moves GROUP BY game_id, turn_number "
        "HAVING COUNT(*) > 1 LIMIT 1"
    )).mappings().first()
    if duplicate is not None:
        raise RuntimeError(
            "Cannot downgrade 0011_game_operations: game_moves contains branched duplicate "
            "(game_id, turn_number) values; preserving audit data."
        )
    incompatible_audit_state = bind.execute(sa.text(
        "SELECT ("
        "EXISTS(SELECT 1 FROM games WHERE version <> ply_count) OR "
        "EXISTS(SELECT 1 FROM game_moves WHERE reverted_revision IS NOT NULL) OR "
        "EXISTS(SELECT 1 FROM game_undo_events) OR "
        "EXISTS(SELECT 1 FROM game_terminal_events) OR "
        "EXISTS(SELECT 1 FROM remote_undo_requests)"
        ")"
    )).scalar_one()
    if incompatible_audit_state:
        raise RuntimeError(
            "Cannot downgrade 0011_game_operations: post-0011 audit state cannot be "
            "represented by the previous schema; preserving audit data."
        )


def downgrade() -> None:
    _guard_downgrade_against_branched_moves()

    op.drop_index("ix_remote_undo_requests_game_status", table_name="remote_undo_requests")
    op.drop_table("remote_undo_requests")
    op.drop_table("game_terminal_events")
    op.drop_table("game_undo_events")

    op.drop_index("ix_game_moves_active_turn", table_name="game_moves")
    op.drop_constraint("uq_game_moves_game_revision", "game_moves", type_="unique")
    op.create_unique_constraint(
        "uq_game_moves_game_turn", "game_moves", ["game_id", "turn_number"])
    op.drop_column("game_moves", "reverted_revision")
    op.drop_column("game_moves", "created_revision")
    op.drop_column("games", "ply_count")
