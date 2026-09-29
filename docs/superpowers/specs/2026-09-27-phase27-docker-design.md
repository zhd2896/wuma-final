# PHASE 27 Docker Deployment Design

## Existing implementation and scope

This is the existing five-horse repository after PHASE 26. The FastAPI adapter starts one persistent Node 24 worker at `REPO_ROOT/backend/engine_worker.mjs`. That worker uses Node 24 type stripping and a resolution hook to load the canonical TypeScript files under `miniprogram/domain` and `miniprogram/ai`. `Settings` derives `REPO_ROOT` from its source path, so `/app` is a suitable Linux root. The existing `/health` checks the worker; the SQLAlchemy store is backed by MySQL and Alembic head is `0008_training`. The WeChat production API address is centralized in `miniprogram/config/api.ts` and deliberately empty until a real HTTPS domain is supplied.

No rules, evaluation, review thresholds, training grading, AI search, Node worker protocol, or WeChat UI behavior will change. Docker is absent from the current Windows PATH and the available Ubuntu WSL distribution, so container build and recovery checks require an external runtime before they can be claimed as passing.

## Architecture

`WeChat → Nginx → FastAPI → persistent Node worker → canonical TypeScript engine`, with `FastAPI → MySQL`. Compose runs one backend process and one MySQL 8.4 service. MySQL has a named volume and no published port. The backend has only an internal exposed port. Nginx is the sole published service and proxies to `backend:8000`.

The backend image uses a Node 24 slim stage to supply the runtime binary, then a Python 3.12 slim runtime stage. It installs the repository's pinned Python requirements and copies only the backend plus the two canonical engine source directories. Node modules, virtual environments, results, local environment files, certificates, and developer tool caches stay outside the image. The runtime user is non-root. This keeps the existing Node 24 TypeScript path instead of changing the engine module system for deployment.

## Startup and health

Compose waits for a credentialed MySQL health query. The backend entrypoint waits for a DB query, runs `alembic upgrade head`, and uses `exec` to start a single Uvicorn process without reload. Each failure exits nonzero. A new `/ready` checks both worker and database; Compose uses it for backend health. The existing `/health` remains compatible. Nginx starts after backend health and proxies both endpoints. Shutdown uses Docker init and FastAPI lifespan cleanup to stop the Node subprocess and close the DB store.

## Configuration, proxy, TLS, and persistence

Root `.env.example` contains only existing backend settings plus Compose settings. Passwords and optional LLM credentials come from runtime environment, never from Dockerfile `COPY`. The default local Nginx config provides HTTP on a loopback host port for automated validation. A separate TLS config template redirects port 80 to 443 and reads mounted certificate files. The production operator sets the real certificate directory, exposed host binding and WeChat request domain; no certificate or domain is invented. Nginx forwards Host, real client address and original protocol, with bounded timeouts suited to review and training. It does not serve the WeChat mini program.

Normal `docker compose down` keeps the named `mysql_data` volume. The deployment guide includes migration, update, backup, restore, rollback distinction, TLS and WeChat legal-domain configuration, logs, troubleshooting and test project isolation. No normal deployment command removes volumes.

## Validation

Add a self-contained Docker E2E that uses a unique Compose project and an HTTP port, starts the stack, waits for health through Nginx, drives real game/AI/analysis/review/coach/training APIs without an LLM key, and checks recovery across backend restart, MySQL restart and Compose down/up. It must keep the test volume unless the operator explicitly cleans it. Reuse the existing five WeChat E2Es with their API environment variables pointed at the Nginx endpoint; do not duplicate UI tests.

Run the existing Node/Python regressions and static checks on the host. If Docker remains unavailable, validate shell line endings, Python and Node syntax, Compose source structure, and the API smoke against the host stack; report image size, clean build, Compose health, persistence and Docker E2E as `NOT_RUN`. Production TLS remains `NOT_VERIFIED` without a real domain, certificate and WeChat request-domain configuration.

## Design review

The design uses existing language and persistence boundaries, keeps one backend replica to avoid migration races, and does not depend on a live LLM provider. There are no unresolved implementation choices in the deployment files. The user's detailed PHASE 27 attachment supplies the design authorization; no separate approval gate is needed before making the work reviewable.
