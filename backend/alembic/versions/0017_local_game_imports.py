"""Atomic owner-scoped local score imports, with exact client-ID digest keys."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

revision = "0017_local_game_imports"
down_revision = "0016_training_catalog"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    def inherited_id(table):
        collation = bind.scalar(sa.text("SELECT COLLATION_NAME FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:table AND COLUMN_NAME='id'"), {"table": table})
        return sa.String(32, collation=collation)
    op.create_table("local_game_imports",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("user_id", inherited_id("users"), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("client_key", sa.String(64), nullable=False),
        sa.Column("client_game_id", sa.String(64), nullable=False),
        sa.Column("payload_digest", sa.String(64), nullable=False),
        sa.Column("game_id", inherited_id("games"), sa.ForeignKey("games.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.UniqueConstraint("user_id", "client_key", name="uq_local_import_owner_key"),
        mysql_charset="utf8mb4")


def downgrade():
    bind = op.get_bind()
    if bind.scalar(sa.text("SELECT COUNT(*) FROM local_game_imports")):
        raise RuntimeError("拒绝有损降级：已有本地棋谱同步键")
    op.drop_table("local_game_imports")
