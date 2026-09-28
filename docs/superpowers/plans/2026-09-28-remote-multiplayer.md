# Remote Multiplayer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the home remote entry a real two-device game with room seats, invitation or matching, authoritative turns, resync, and reconnect.

**Architecture:** A durable `REMOTE` room owns an authoritative server game and two independently issued seat tokens. A dedicated mini program page consumes room APIs and saves its own token per game; the existing local and AI game modes retain their behavior.

**Tech Stack:** FastAPI, SQLAlchemy/Alembic/MySQL, canonical TypeScript chess worker, WeChat mini program TypeScript, pytest and Node test runner.

---

### Task 1: Contract and room persistence

**Files:** `backend/app/schemas/remote.py`, `backend/app/services/game_store.py`, `backend/app/db/models.py`, `backend/app/db/repositories/mysql_store.py`, `backend/alembic/versions/0009_remote_rooms.py`, `backend/tests/test_remote.py`.

- [ ] Add a failing backend test that creates a waiting room and confirms the invite code, A seat and version 0. Run `backend/.venv/Scripts/python.exe -m pytest backend/tests/test_remote.py -q` and observe failure at the missing remote route.
- [ ] Define the room response and request DTOs with strict validation. Extend `GameStore` and both implementations for atomic room creation, joining, matching, cancellation, token lookup and remote move lookup/commit.
- [ ] Add the `remote_rooms` table and nullable `game_moves.client_request_id` with a per-game unique constraint in migration 0009. Run focused tests again; confirm room lifecycle and old API tests pass.

### Task 2: Remote service and HTTP API

**Files:** `backend/app/services/remote_service.py`, `backend/app/api/v1/remote.py`, `backend/app/main.py`, `backend/app/services/game_service.py`, `backend/app/core/errors.py`, `backend/tests/test_remote.py`.

- [ ] Write failing tests for two seat tokens, third join denial, wrong-seat move, stale version, same request ID retry, different move with reused ID, cancellation, matching and read-after-reconnect.
- [ ] Implement room creation/join/match/status/cancel/legal-moves/move endpoints. Hash tokens before persistence, protect room methods by token, and reject direct generic moves on `REMOTE` games.
- [ ] Run focused tests and complete backend suite. Record any MySQL tests skipped because `WUMA_TEST_DATABASE_URL` is absent.

### Task 3: Mini program API and room controller

**Files:** `miniprogram/services/remote-api.ts`, `miniprogram/pages/online/online-controller.ts`, `miniprogram/services/device-history.ts`, `tests/online-controller.test.mts`.

- [ ] Write failing controller tests for create/join/match, own-turn selection, server accepted move, polling opponent move, page hide, retry and stored room restoration.
- [ ] Implement room API DTOs and the visible-page controller. Store tokens per room in `wx` storage and write accepted snapshots to history mode `online`.
- [ ] Run focused tests and `npm run typecheck`.

### Task 4: Mini program page and routes

**Files:** `miniprogram/pages/online/online.ts`, `.wxml`, `.wxss`, `.json`, `miniprogram/app.json`, `miniprogram/mock/game.ts`, `miniprogram/pages/history/history.ts`, `tests/online-page.test.mts`.

- [ ] Write a failing page test proving the home remote card opens the online room page and that an online history record reopens by game ID.
- [ ] Build create/join/match/wait/play/cancel/reconnect states, copy/share invite code, own-seat board interaction, error and retry actions. Update routes and history titles.
- [ ] Run page tests, `npm run check`, and `npm run typecheck`.

### Task 5: Stage acceptance

**Files:** `docs/remote-multiplayer-acceptance.md`, `README.md`, `docs/frontend-feature-implementation-prompt.md`.

- [ ] Run full frontend and backend tests and verify exact counts. Run available two-client and MySQL E2E against a dedicated `*_test` database only.
- [ ] Document implemented behavior, exact test evidence, skipped integration checks and a PASS/FAIL stage gate. Do not begin a later feature if the gate remains incomplete.
