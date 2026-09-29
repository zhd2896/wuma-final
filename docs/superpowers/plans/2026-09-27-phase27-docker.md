# PHASE 27 Docker Deployment Implementation Plan

> **For agentic workers:** Implement tasks sequentially, verify each change, and preserve existing game behavior. The repository has no Git commits, so do not create an unrelated all-files commit.

**Goal:** Deliver reviewable Docker Compose deployment assets for the existing FastAPI, Node 24 worker, MySQL and Nginx stack, then validate every check this environment permits.

**Architecture:** One non-root Python 3.12 backend image also contains Node 24 and canonical TypeScript sources. Compose orders MySQL health, backend migration/readiness, then Nginx; a named volume preserves MySQL. Local HTTP and a certificate-mount TLS template share the same backend.

**Tech Stack:** Docker Compose, Python 3.12, Node 24 native TypeScript stripping, MySQL 8.4, Nginx, Alembic, existing Node/Python tests.

---

## Task 1: Readiness contract

**Files:** `backend/app/main.py`, `backend/app/db/repositories/mysql_store.py`, `backend/app/services/game_store.py`, `backend/tests/test_api.py`.

- [ ] Write a failing API test showing `/ready` checks the worker and store and that a store failure gives the existing error envelope.
- [ ] Add a store `ping` backed by `SELECT 1`, with a no-op in the isolated in-memory test store; call it from `/ready` after worker ping.
- [ ] Run targeted backend tests, then the full backend suite with the isolated MySQL test database.

## Task 2: Minimal runtime image and startup

**Files:** `backend/Dockerfile`, `.dockerignore`, `deploy/scripts/backend-entrypoint.sh`, `deploy/scripts/wait-for-db.py`.

- [ ] Add Dockerfile using official Node 24 and Python 3.12 slim stages, existing requirements and only runtime engine source. Keep `npm` available without installing mini-program development modules.
- [ ] Add a credential-free-log DB readiness probe, then LF shell entrypoint that waits, upgrades Alembic to head and `exec`s one Uvicorn process.
- [ ] Verify script syntax/line endings and the worker's real `/app` path. Build and run inside Docker when the runtime exists; record `NOT_RUN` otherwise.

## Task 3: Compose, reverse proxy, and runtime settings

**Files:** `compose.yml`, `.env.example`, `deploy/nginx/conf.d/local.conf`, `deploy/nginx/conf.d/tls.conf.example`, `deploy/nginx/empty-certs/.gitkeep`, `.gitignore`.

- [ ] Configure MySQL 8.4 with utf8mb4, credentialed health query, required external passwords, private port and named volume.
- [ ] Configure backend to wait for MySQL health, expose only 8000 internally, run one process, use `/ready` health and optional empty LLM settings.
- [ ] Configure Nginx after backend health, local HTTP through `backend:8000`, bounded proxy timeouts and basic forwarding/security headers. Add TLS template with mounted certificate paths and 80→443 redirect.
- [ ] Validate static paths, environment keys, no embedded secrets or host absolute paths, and Compose syntax when Docker is available.

## Task 4: Automated deployment validation

**Files:** `scripts/phase27-api-smoke.mjs`, `scripts/phase27-docker-e2e.mjs`, `package.json`.

- [ ] Add an API-only smoke through a configurable base URL: health/readiness, create/get/legal moves/human move, AI move/analysis, finished-game review and no-key explanation, coach fallback, training answer.
- [ ] Add Docker orchestration using an isolated Compose project and port. It starts the stack, waits through Nginx, runs API smoke, checks backend/MySQL/recreate recovery and keeps the test volume. Never silently delete a volume.
- [ ] Test the smoke against the local host stack and the full orchestration when Docker exists. Record exact game IDs and statuses from real runs only.

## Task 5: Documentation and regressions

**Files:** `docs/deployment.md`, `docs/phase27-deployment-report.md`, existing README link if useful.

- [ ] Document build/start/stop/restart/update/logs/migration/backup/restore/TLS/WeChat domain/troubleshooting, with separate application and migration rollback instructions.
- [ ] Run `npm test`, `npm run check`, `npm run typecheck`, all backend tests against isolated MySQL, Alembic current/check and the five existing WeChat E2Es against the available local/API endpoint.
- [ ] Run Compose clean and repeated builds, Docker E2E, volume and worker recovery if Docker becomes available. Clearly mark all unavailable checks `NOT_RUN`; do not claim PHASE 27 acceptance without required evidence.
