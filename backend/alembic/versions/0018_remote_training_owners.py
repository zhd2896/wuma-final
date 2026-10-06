"""Private remote review questions carry their participant account owner."""
from alembic import op
import sqlalchemy as sa

revision = '0018_remote_training_owners'
down_revision = '0017_local_game_imports'
branch_labels = None
depends_on = None


def upgrade():
    collation = op.get_bind().scalar(sa.text("SELECT COLLATION_NAME FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='id'"))
    op.add_column('training_items', sa.Column('user_id', sa.String(32, collation=collation), nullable=True))
    op.create_foreign_key('fk_training_items_owner', 'training_items', 'users', ['user_id'], ['id'], ondelete='RESTRICT')
    op.create_index('ix_training_items_user_id', 'training_items', ['user_id'])


def downgrade():
    if op.get_bind().scalar(sa.text('SELECT COUNT(*) FROM training_items WHERE user_id IS NOT NULL')):
        raise RuntimeError('拒绝有损降级：已有私有联机训练题归属')
    op.drop_constraint('fk_training_items_owner', 'training_items', type_='foreignkey')
    op.drop_index('ix_training_items_user_id', table_name='training_items')
    op.drop_column('training_items', 'user_id')
