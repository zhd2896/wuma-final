"""Existing WeChat and game-operation databases share a single upgrade target."""

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


def scripts():
    return ScriptDirectory.from_config(Config(str(Path(__file__).parents[1] / "alembic.ini")))


def planned_revisions(start):
    return [step.revision.revision for step in scripts()._upgrade_revs("head", start)]


def test_wechat_database_upgrades_operations_without_recreating_sessions():
    plan = planned_revisions("0011_wechat_auth_sessions")
    assert "0011_wechat_auth_sessions" not in plan
    assert plan.index("0011_game_operations") < plan.index("0012_remote_undo_idempotency")
    assert plan.index("0012_remote_undo_idempotency") < plan.index("0013_remote_undo_revert_count")
    assert plan[-1] == scripts().get_current_head()


def test_operations_database_upgrades_sessions_without_replaying_operations():
    plan = planned_revisions("0013_remote_undo_revert_count")
    assert "0011_wechat_auth_sessions" in plan
    assert not {"0011_game_operations", "0012_remote_undo_idempotency", "0013_remote_undo_revert_count"}.intersection(plan)
    assert plan[-1] == scripts().get_current_head()


def test_fresh_database_has_one_head_reachable_from_both_branches():
    script = scripts()
    assert len(script.get_heads()) == 1
    plan = planned_revisions(None)
    assert "0011_wechat_auth_sessions" in plan
    assert "0011_game_operations" in plan
    assert "0013_remote_undo_revert_count" in plan
    assert plan[-1] == script.get_current_head()
