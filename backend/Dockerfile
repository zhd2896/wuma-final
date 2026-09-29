FROM node:24.16.0-bookworm-slim AS node_runtime

FROM python:3.12.12-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    WUMA_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends libstdc++6 libatomic1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=node_runtime /usr/local/bin/node /usr/local/bin/node

COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt \
    && rm /tmp/requirements.txt

WORKDIR /app
COPY package.json /app/package.json
COPY backend /app/backend
COPY miniprogram/domain /app/miniprogram/domain
COPY miniprogram/ai /app/miniprogram/ai
COPY deploy/scripts /app/deploy/scripts

RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin app \
    && chmod 0755 /app/deploy/scripts/backend-entrypoint.sh \
    && chown -R app:app /app

USER app
EXPOSE 8000
ENTRYPOINT ["/app/deploy/scripts/backend-entrypoint.sh"]
