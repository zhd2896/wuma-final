# Device History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock history page with real games recorded on this device, including resumable local, AI, and server-backed two-player games.

**Architecture:** A versioned local storage index records immutable game summaries and local snapshots. Game pages update it only when an authoritative state changes. The history page reads that index, resumes active games, and opens finished server games in the existing review page.

**Tech Stack:** WeChat mini program TypeScript, Node test runner, existing FastAPI game API.

---

### Task 1: Device history store

**Files:** Create `miniprogram/services/device-history.ts`; test `tests/device-history.test.mts`.

- [x] Write a failing test for an empty index, deduplicated upsert, sorting, local snapshot restoration, and corrupt-storage error.
- [x] Run `node --test tests/device-history.test.mts` and confirm the test fails because the store does not exist.
- [x] Implement a versioned `wuma:history:v1` store using an injected `{get,set,remove}` adapter and `wx` adapter; preserve initial creation time and store real `GameState` only for local games.
- [x] Run the focused test and confirm zero failures.

### Task 2: Record and resume actual games

**Files:** Modify `miniprogram/pages/game/game.ts`, `miniprogram/pages/game/remote-game.ts`; test `tests/history-game-page.test.mts`.

- [x] Write a failing page test: starting a local game records it, a legal move updates it, reopening by ID restores it, and AI/remote snapshots create distinct records.
- [x] Run `node --test tests/history-game-page.test.mts` and confirm the missing behavior fails.
- [x] Update history only after a real state transition. Add an explicit history `gameId` route to the existing AI/remote controller storage adapter. Preserve old active-game resume behavior and use server version as move count.
- [x] Run the focused test and existing game-page tests; correct test storage stubs to model separate storage keys.

### Task 3: Replace the history page and broken routes

**Files:** Modify `miniprogram/pages/history/history.ts`, `.wxml`, `.wxss`, `miniprogram/mock/game.ts`, `miniprogram/pages/coach/coach.ts`, `miniprogram/pages/profile/profile.wxml`, `miniprogram/services/index.ts`, `miniprogram/services/contracts.ts`, `README.md`; test `tests/history-page.test.mts`.

- [x] Write a failing page test for empty state, real records, finished-game `gameId` navigation, and active-game resume.
- [x] Run `node --test tests/history-page.test.mts` and confirm failure at the old Mock behavior.
- [x] Render device records with actual status, result, move count, and timestamps. Route review entry points through finished-history selection and remove demo toggles/content.
- [x] Run the focused test and the static page checker.

### Task 4: Stage acceptance

**Files:** Create `docs/device-history-acceptance.md` with the actual evidence and remaining runtime gaps.

- [x] Run `npm test`, `npm run check`, and `npm run typecheck` and record exact results.
- [x] Check whether a usable WeChat DevTools automation endpoint and backend service exist. If available, run the real page E2E; otherwise mark runtime acceptance as pending rather than claiming a pass.
- [x] Review the stage criteria line by line, write PASS only if all required evidence exists, and stop before any next-stage implementation.
