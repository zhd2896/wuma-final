"""Wait for the configured application database without logging its credentials."""

import sys
import time

from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.pool import NullPool

from backend.app.core.config import Settings


def main() -> int:
    engine = create_engine(Settings().database_url, poolclass=NullPool,
                           connect_args={"connect_timeout": 3})
    try:
        for attempt in range(30):
            try:
                with engine.connect() as connection:
                    connection.execute(text("SELECT 1"))
                print("Database ready", flush=True)
                return 0
            except SQLAlchemyError:
                if attempt == 29:
                    print("Database unavailable after 30 attempts", file=sys.stderr,
                          flush=True)
                    return 1
                time.sleep(2)
    finally:
        engine.dispose()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
