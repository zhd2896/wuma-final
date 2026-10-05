"""Upgrade an empty MySQL test database with a non-server-default collation.

Set WUMA_TEST_MIGRATION_DATABASE_URL to an empty dedicated *_test database
created with CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci. This test leaves
the migrated schema available for persistence tests and never drops tables.
"""

import os
import sys
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url


def test_fresh_mysql_upgrade_preserves_string_foreign_key_collations(monkeypatch):
    database_url = os.getenv("WUMA_TEST_MIGRATION_DATABASE_URL")
    if not database_url:
        pytest.skip("empty isolated MySQL migration test database not configured")
    parsed_url = make_url(database_url)
    allowed_query_options = {"charset", "connect_timeout", "read_timeout", "write_timeout"}
    if (
        not parsed_url.drivername.startswith("mysql")
        or not (parsed_url.database or "").endswith("_test")
        or set(parsed_url.query) - allowed_query_options
    ):
        raise RuntimeError(
            "WUMA_TEST_MIGRATION_DATABASE_URL must name an isolated MySQL *_test database "
            "with only charset and timeout query options"
        )

    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            if connection.scalar(text("SELECT DATABASE()")) != parsed_url.database:
                raise RuntimeError("migration connected database differs from the isolated test database")
            assert not inspect(connection).get_table_names(), "migration test requires an empty database"
            collation = connection.scalar(text(
                "SELECT DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA "
                "WHERE SCHEMA_NAME = DATABASE()"
            ))
            assert collation == "utf8mb4_unicode_ci"

        monkeypatch.setenv("DATABASE_URL", database_url)
        config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
        command.upgrade(config, "head")

        with engine.connect() as connection:
            assert connection.scalar(text("SELECT version_num FROM alembic_version")) == (
                ScriptDirectory.from_config(config).get_current_head()
            )
            foreign_keys = connection.execute(text(
                "SELECT fk.TABLE_NAME, fk.COLUMN_NAME, child.COLLATION_NAME, "
                "parent.COLLATION_NAME AS referenced_collation "
                "FROM information_schema.KEY_COLUMN_USAGE AS fk "
                "JOIN information_schema.COLUMNS AS child "
                "ON child.TABLE_SCHEMA = fk.TABLE_SCHEMA "
                "AND child.TABLE_NAME = fk.TABLE_NAME AND child.COLUMN_NAME = fk.COLUMN_NAME "
                "JOIN information_schema.COLUMNS AS parent "
                "ON parent.TABLE_SCHEMA = fk.REFERENCED_TABLE_SCHEMA "
                "AND parent.TABLE_NAME = fk.REFERENCED_TABLE_NAME "
                "AND parent.COLUMN_NAME = fk.REFERENCED_COLUMN_NAME "
                "WHERE fk.TABLE_SCHEMA = DATABASE() "
                "AND fk.REFERENCED_TABLE_NAME IS NOT NULL AND child.COLLATION_NAME IS NOT NULL"
            )).all()
            assert foreign_keys, "migration must create string foreign keys"
            assert all(child == parent for _, _, child, parent in foreign_keys), foreign_keys
        verify_training_catalog_upgrade_retains_review_rows(config, engine, database_url)
    finally:
        engine.dispose()


def verify_training_catalog_upgrade_retains_review_rows(config, engine, database_url):
    """真实旧复盘记录降级再升级保留；新增精选记录拒绝有损降级。"""
    from fastapi.testclient import TestClient
    from backend.app.main import create_app
    from backend.app.core.config import Settings
    from backend.tests.test_training import finished_review
    with TestClient(create_app(Settings(database_url=database_url), require_auth=False)) as client:
        game_id, _ = finished_review(client)
        generated = client.post(f'/api/v1/game/{game_id}/training', json={})
        assert generated.status_code == 200, generated.text
        ids = [q['id'] for q in generated.json()['data']['items']]
        assert ids
        with engine.connect() as connection:
            before = connection.execute(text('SELECT id,source_game_id,source_move_id,source_move_review_id,'
                'original_move,best_move,best_score,scoring_config FROM training_items ORDER BY id')).all()
        command.downgrade(config, '0015_remote_participants')
        with engine.connect() as connection:
            assert connection.execute(text('SELECT id,source_game_id,source_move_id,source_move_review_id,'
                'original_move,best_move,best_score,scoring_config FROM training_items ORDER BY id')).all() == before
        command.upgrade(config, 'head')
        with engine.connect() as connection:
            assert connection.execute(text('SELECT id,source_game_id,source_move_id,source_move_review_id,'
                'original_move,best_move,best_score,scoring_config FROM training_items ORDER BY id')).all() == before
            assert connection.scalar(text("SELECT COUNT(*) FROM training_items WHERE source_kind='REVIEW'")) == len(ids)
        curated = client.get('/api/v1/training?source=CURATED').json()['data']
        assert curated['total'] == 3
        with pytest.raises(RuntimeError, match='拒绝有损降级'):
            command.downgrade(config, '0015_remote_participants')
        with engine.connect() as connection:
            assert connection.scalar(text('SELECT version_num FROM alembic_version')) == '0016_training_catalog'
            assert connection.scalar(text("SELECT COUNT(*) FROM training_items WHERE source_kind='CURATED' AND source_game_id IS NULL")) == 3
            assert connection.scalar(text('SELECT COUNT(*) FROM training_items')) == len(ids) + 3
        client.app.state.store.close()


@pytest.mark.parametrize("query", [
    "database=unexpected", "db=unexpected", "host=unexpected", "port=3306",
    "user=unexpected", "password=unexpected", "unix_socket=unexpected",
    "read_default_file=unexpected", "charset=utf8mb4&database=unexpected",
])
def test_migration_rejects_connection_overrides_before_connecting(monkeypatch, query):
    monkeypatch.setenv(
        "WUMA_TEST_MIGRATION_DATABASE_URL", f"mysql+pymysql://127.0.0.1/guard_test?{query}"
    )

    def refuse_connection(_database_url):
        pytest.fail("unsafe migration URL must be rejected before creating an engine")

    monkeypatch.setattr(sys.modules[__name__], "create_engine", refuse_connection)
    with pytest.raises(RuntimeError, match="isolated MySQL"):
        test_fresh_mysql_upgrade_preserves_string_foreign_key_collations(monkeypatch)


def test_migration_rejects_mismatched_active_database_before_upgrade(monkeypatch):
    monkeypatch.setenv("WUMA_TEST_MIGRATION_DATABASE_URL", "mysql+pymysql://127.0.0.1/guard_test")
    disposed = []

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def scalar(self, statement):
            if "DEFAULT_COLLATION_NAME" in str(statement):
                return "utf8mb4_unicode_ci"
            return "unexpected"

    class Engine:
        def connect(self):
            return Connection()

        def dispose(self):
            disposed.append(True)

    class Inspector:
        def get_table_names(self):
            return []

    module = sys.modules[__name__]
    monkeypatch.setattr(module, "create_engine", lambda _url: Engine())
    monkeypatch.setattr(module, "inspect", lambda _connection: Inspector())

    def refuse_upgrade(*_args):
        pytest.fail("active database mismatch must be rejected before any migration")

    monkeypatch.setattr(command, "upgrade", refuse_upgrade)
    with pytest.raises(RuntimeError, match="connected database"):
        test_fresh_mysql_upgrade_preserves_string_foreign_key_collations(monkeypatch)
    assert disposed == [True]
