#!/bin/sh
set -eu

python /app/deploy/scripts/wait-for-db.py
alembic -c /app/backend/alembic.ini upgrade head
exec uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
