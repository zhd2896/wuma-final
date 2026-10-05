"""Merge the existing WeChat-session and game-operation migration branches."""

revision = "0014_merge_auth_operations"
down_revision = ("0013_remote_undo_revert_count", "0011_wechat_auth_sessions")
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
