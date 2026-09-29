# PHASE 18 Remote Game Implementation Plan

> **For agentic workers:** Use test-driven development for each behavior and verify each command's result.

**Goal:** Connect the existing WeChat board to Phase 17 FastAPI/MySQL while preserving local two-player play.

**Architecture:** A typed API client and remote controller drive the existing page and board through one shared `GameState` mapper. The backend stays authoritative and unchanged.

**Tech Stack:** WeChat Mini Program TypeScript, Node test runner, FastAPI, MySQL 8, Node Worker.

---

### Task 1: API contract and client

- [ ] Add failing tests for envelope success/error, network failure, URL/path, move body and AI transport.
- [ ] Add `miniprogram/config/api.ts`, `miniprogram/services/api-client.ts`, `game-api.ts`, and typed DTOs.
- [ ] Run the targeted Node tests and TypeScript typecheck.

### Task 2: Shared board projection

- [ ] Add failing mapper tests for initial pieces, Reserve/current player, captures, three winner reasons and immutable input.
- [ ] Add `game-state-mapper.ts`; make `local-game.ts` use it without changing local game behavior.
- [ ] Run existing local-game tests.

### Task 3: Remote session controller

- [ ] Add failing tests for create, restore, legal selection, server-accepted move, pending input lock, conflict reload, missing game, engine outage, terminal, restart and disposal.
- [ ] Implement `remote-game.ts` with an injected game API and ID storage.
- [ ] Run targeted tests and typecheck.

### Task 4: Existing page integration

- [ ] Add a remote home entry and minimal WXML state/error/retry/restart controls to the current game page.
- [ ] Wire the controller to `onLoad`, `onNode`, `onUnload` and `setData`; keep AI demo and local branches.
- [ ] Run page integration tests, `npm run check` and `npm run typecheck`.

### Task 5: End-to-end verification

- [ ] Run all Node and Python tests with isolated MySQL 8.
- [ ] Verify migration, API create/legal/move/restore/continue and database rows.
- [ ] Attempt the installed WeChat developer tool CLI or simulator link and report precisely which portion ran.
- [ ] Review changes for rule duplication, stale UI updates and hidden fallbacks.
