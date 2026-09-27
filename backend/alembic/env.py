"""Migration environment; connection settings come from the application config."""

from alembic import context
from sqlalchemy import create_engine, pool

from backend.app.core.config import Settings
from backend.app.db.base import Base
from backend.app.db import models  # noqa: F401 - register metadata


config = context.config
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(url=Settings().database_url, target_metadata=target_metadata,
                      literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(Settings().database_url, poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
