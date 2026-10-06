"""统一精选残局和私有复盘题，保留旧数据。"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import DOUBLE

revision = '0016_training_catalog'
down_revision = '0015_remote_participants'
branch_labels = None
depends_on = None

FIELDS = {'source_game_id': sa.String(32), 'source_move_id': sa.BigInteger(),
          'source_move_review_id': sa.BigInteger(), 'source_turn': sa.Integer(),
          'original_move': sa.JSON(), 'source_category': sa.String(16),
          'source_score_loss': DOUBLE(asdecimal=False)}


def upgrade():
    op.add_column('training_items', sa.Column('source_kind', sa.String(16), nullable=False, server_default='REVIEW'))
    op.add_column('training_items', sa.Column('title', sa.String(128), nullable=False, server_default='复盘最佳走法'))
    op.add_column('training_items', sa.Column('catalog_version', sa.Integer(), nullable=True))
    op.add_column('training_items', sa.Column('difficulty_basis', sa.JSON(), nullable=True))
    for name, kind in FIELDS.items():
        op.alter_column('training_items', name, existing_type=kind, nullable=True)
    op.create_index('ix_training_items_source_id', 'training_items', ['source_kind', 'id'])


def downgrade():
    connection = op.get_bind()
    incompatible = connection.scalar(sa.text(
        "SELECT COUNT(*) FROM training_items WHERE source_kind <> 'REVIEW' OR " +
        ' OR '.join(f'{name} IS NULL' for name in FIELDS)))
    if incompatible:
        raise RuntimeError('精选题/答题记录存在，拒绝有损降级；请先备份并明确处理新增数据。')
    op.drop_index('ix_training_items_source_id', table_name='training_items')
    for name, kind in FIELDS.items():
        op.alter_column('training_items', name, existing_type=kind, nullable=False)
    for name in ('difficulty_basis', 'catalog_version', 'title', 'source_kind'):
        op.drop_column('training_items', name)
