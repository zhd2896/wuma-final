"""Durable remote rooms and idempotent remote move requests."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.mysql import DATETIME

revision = "0009_remote_rooms"
down_revision = "0008_training"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "remote_rooms",
        sa.Column("game_id", sa.String(32), sa.ForeignKey("games.id", ondelete="RESTRICT"), primary_key=True),
        sa.Column("invite_code", sa.String(8), nullable=False, unique=True),
        sa.Column("host_token_hash", sa.String(64), nullable=False),
        sa.Column("guest_token_hash", sa.String(64)),
        sa.Column("host_device_id", sa.String(64), nullable=False),
        sa.Column("guest_device_id", sa.String(64)),
        sa.Column("public", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("expires_at", DATETIME(fsp=6), nullable=False),
        sa.Column("created_at", DATETIME(fsp=6), nullable=False),
        sa.Column("updated_at", DATETIME(fsp=6), nullable=False),
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_remote_rooms_match", "remote_rooms", ["public", "status", "expires_at"])
    op.add_column("game_moves", sa.Column("client_request_id", sa.String(64)))
    op.create_unique_constraint("uq_game_moves_client_request", "game_moves",
                                ["game_id", "client_request_id"])


def downgrade() -> None:
    op.drop_constraint("uq_game_moves_client_request", "game_moves", type_="unique")
    op.drop_column("game_moves", "client_request_id")
    op.drop_index("ix_remote_rooms_match", table_name="remote_rooms")
    op.drop_table("remote_rooms")
