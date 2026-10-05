"""Upgrade an empty MySQL test database with a non-server-default collation.

Set WUMA_TEST_MIGRATION_DATABASE_URL to an empty dedicated *_test database
created with CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci. This test leaves
the migrated schema available for persistence tests and never drops tables.
"""

import os
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
    if not parsed_url.drivername.startswith("mysql") or not (
        parsed_url.database or ""
    ).endswith("_test"):
        raise RuntimeError(
            "WUMA_TEST_MIGRATION_DATABASE_URL must name a MySQL database ending in _test"
        )

    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
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
    finally:
        engine.dispose()
