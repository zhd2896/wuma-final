"""Nullable account ownership for both remote participants."""
from alembic import op
import sqlalchemy as sa

revision = '0015_remote_participants'
down_revision = '0014_merge_auth_operations'
branch_labels = None
depends_on = None


def upgrade():
    for seat in ('host', 'guest'):
        field = seat + '_user_id'
        op.add_column('remote_rooms', sa.Column(field, sa.String(32), nullable=True))
        op.create_foreign_key('fk_remote_rooms_' + field, 'remote_rooms', 'users', [field], ['id'], ondelete='RESTRICT')
        op.create_index('ix_remote_rooms_' + field, 'remote_rooms', [field])


def downgrade():
    for seat in ('guest', 'host'):
        field = seat + '_user_id'
        op.drop_constraint('fk_remote_rooms_' + field, 'remote_rooms', type_='foreignkey')
        op.drop_index('ix_remote_rooms_' + field, table_name='remote_rooms')
        op.drop_column('remote_rooms', field)
