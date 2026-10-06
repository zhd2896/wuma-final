"""Versioned built-in piece avatars; existing users retain their nicknames."""
from alembic import op
import sqlalchemy as sa

revision = '0019_user_profiles'
down_revision = '0018_remote_training_owners'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('avatar', sa.String(32), nullable=False, server_default='piece_v1_shi'))


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT COUNT(*) FROM users WHERE avatar <> 'piece_v1_shi'")):
        raise RuntimeError('拒绝有损降级：已有用户选择的棋子头像')
    op.drop_column('users', 'avatar')
