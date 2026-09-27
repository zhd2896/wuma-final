# PHASE 20 Position Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deliver pure, explainable, versioned position analysis through the canonical engine and existing WeChat game page.

**Architecture:** TypeScript composes Evaluation and Iterative Deepening; Node worker exposes one analysis command; FastAPI loads the authoritative snapshot and stores versioned results; the existing AI page requests and renders them manually.

**Tech Stack:** TypeScript, Node worker, FastAPI, SQLAlchemy/Alembic, MySQL 8, WeChat mini program.

---

### Task 1: Canonical analysis

- [x] Write failing TypeScript tests for perspective, static evaluation, exact ranked candidates, candidate limit, threats, terminal states, timeout, and immutability.
- [x] Run `node --test tests/position-analysis.test.mts` and confirm feature-absence failure.
- [x] Implement `miniprogram/ai/position-analysis.ts` by composing existing `evaluatePosition`, `IterativeDeepeningAI`, and `orderMoves`.
- [x] Run focused tests and `npm run typecheck`.

### Task 2: Worker and HTTP contract

- [x] Write failing adapter and API tests for `analyze_position`, game-id-only request, unknown game, terminal result, unavailable engine, and no move execution.
- [x] Run focused pytest and confirm failures.
- [x] Add worker dispatch, adapter parsing, strict DTOs, route, and service orchestration with server-owned analysis budget.
- [x] Run focused API tests.

### Task 3: Versioned persistence

- [x] Write failing MySQL tests for analysis insert, unchanged game and move rows, duplicate analysis, and stale-version rejection.
- [x] Run focused MySQL tests and confirm failures.
- [x] Add `ai_analysis` model, Alembic migration, and short-transaction version-checked store methods.
- [x] Upgrade isolated MySQL schemas and run focused tests.

### Task 4: WeChat integration

- [x] Write failing controller and page tests for manual request, loading lock, real result display, stale result removal, and continued play.
- [x] Run focused frontend tests and confirm failures.
- [x] Extend API client, AI game controller, existing game page, and small WXML/WXSS panel.
- [x] Run focused frontend tests and page checker.

### Task 5: End-to-end and final verification

- [x] Add a WeChat Developer Tool E2E script that creates/restores an AI game, analyzes it, checks unchanged board, and continues Human/AI moves.
- [x] Run full `npm test`, `npm run check`, `npm run typecheck`, and MySQL-backed pytest.
- [x] Run real WeChat E2E and read MySQL rows to verify `game_version`, search metrics, and no analysis move.
- [x] Review code and report measured results and remaining limits.
