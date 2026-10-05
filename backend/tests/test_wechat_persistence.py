"""SQL store account persistence on an isolated local SQLite file.

This checks SQL ownership operations, not MySQL locking or migration compatibility.
"""
import asyncio
import hashlib
import pytest
from sqlalchemy import select
from backend.app.db.models import UserModel
from backend.app.core.errors import ApiError
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.app.db.base import Base
from backend.app.db.repositories.mysql_store import MySQLGameStore
from backend.app.schemas.game import GameState, BoardState


def sqlite_store(url):
    store = MySQLGameStore.__new__(MySQLGameStore)
    store.engine = create_engine(url)
    store.sessions = sessionmaker(store.engine, expire_on_commit=False)
    return store


def test_sql_wechat_identity_sessions_and_migration_survive_restart(tmp_path):
    url = "sqlite:///" + (tmp_path / "accounts.sqlite").as_posix()
    store = sqlite_store(url)
    Base.metadata.create_all(store.engine)
    expires = datetime.now(timezone.utc) + timedelta(days=1)
    old_id = asyncio.run(store.register_device("a" * 64))
    state = GameState(board=BoardState(occupancy={f"P{i:02}": None for i in range(1, 30)}),
        players={"A": {"reserve_count": 4}, "B": {"reserve_count": 4}},
        first_player="A", current_player="A", game_status="PLAYING", winner=None, winner_reason=None)
    game = asyncio.run(store.create(state, user_id=old_id))
    target = asyncio.run(store.login_wechat("wx-app:alice", "b" * 64, expires))
    assert target != old_id
    assert asyncio.run(store.login_wechat("wx-app:alice", "c" * 64, expires, "a" * 64)) == target
    assert asyncio.run(store.resolve_device("a" * 64)) is None
    assert asyncio.run(store.get_snapshot(game)).user_id == target
    with pytest.raises(ApiError) as exc:
        asyncio.run(store.create(state, user_id=old_id))
    assert exc.value.code == "AUTH_INVALID"
    with store.sessions() as session:
        external = session.scalar(select(UserModel.external_user_id).where(UserModel.id == target))
        assert external == "wechat:" + hashlib.sha256(b"wx-app:alice").hexdigest()
    store.close()
    restarted = sqlite_store(url)
    try:
        assert asyncio.run(restarted.resolve_device("b" * 64)) == target
        assert asyncio.run(restarted.resolve_device("c" * 64)) == target
        assert asyncio.run(restarted.login_wechat("wx-app:alice", "d" * 64, expires)) == target
        assert asyncio.run(restarted.personal_profile(target))["games"] == 1
        expired = asyncio.run(restarted.login_wechat("wx-app:bob", "e" * 64,
            datetime.now(timezone.utc) - timedelta(seconds=1)))
        assert expired != target
        assert asyncio.run(restarted.resolve_device("e" * 64)) is None
    finally:
        restarted.close()
