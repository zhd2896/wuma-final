# PHASE 25 Benchmark Implementation Plan

**Goal:** Produce reproducible, comparable search and self-play measurements directly from the existing TypeScript engine, with raw CSV, derived summaries, metadata, and a deterministic report.

**Architecture:** A legal position suite replays real moves through `RuleEngine.executeTurn`. Search runners call the existing Minimax, AlphaBeta variants, and IterativeDeepening classes without changing search behavior. A separate self-play runner uses seeded `RandomAI` and existing search classes, swaps sides in pairs, and executes every move through the canonical engine. Shared reporting code derives summaries from raw rows.

**Tech stack:** Node 24 `.mts`, existing TypeScript engine, Node test runner, CSV/JSON/Markdown files. No Python engine, FastAPI, MySQL, or LLM in the benchmark path.

**Verified development baseline:** `npm test` 279/279; `npm run check` and `npm run typecheck` pass; `pytest backend/tests -q` 85/85 with one third-party warning; all five WeChat E2Es pass; Alembic `0008_training` and no pending migration.

## Task 1: Legal position suite

- [x] Add `scripts/benchmark/positions.mts` with eight positions sourced from the existing 14-move finished game, a five-move canonical temple sequence, and seeded canonical self-play.
- [x] Reconstruct every state through `createInitialGameState` and `RuleEngine.executeTurn`; verify `PLAYING`, player, legal moves, and category evidence.
- [x] Add a test that detects an invalid source move and validates suite category coverage without hand-built board JSON.

## Task 2: Search harness

- [x] Write failing tests for fixed-depth equal scores, five measured repetitions excluding warm-up, exact raw row count, and time-budget separation.
- [x] Add `scripts/benchmark/search-harness.mts` calling real Minimax and three AlphaBeta configurations at identical state, root perspective, evaluation config, and depth; add IterativeDeepening runs by explicit budget.
- [x] Time externally with `performance.now`; record real search counters, full completion, ambiguity/error statuses, candidate-best equivalence, and config identifiers.

## Task 3: Self-play harness

- [x] Write failing tests for same-seed RandomAI sequence, paired side swaps, canonical turn execution, `MAX_PLIES_REACHED` versus draw, ambiguity/error separation, and raw game count.
- [x] Add `scripts/benchmark/selfplay-harness.mts` with seeded RNG, fixed-depth or explicit time-budget algorithms, configurable even game count and max plies.
- [x] Keep failed or interrupted games separate from completed wins; do not infer a draw rule.

## Task 4: Export and CLI

- [x] Write failing tests for CSV headers, summary recomputation from raw CSV, metadata, and deterministic config hash.
- [x] Add shared `scripts/benchmark/reporting.mts`, `scripts/benchmark-ai.mts`, and `scripts/self-play.mts` plus package commands.
- [x] Record OS, CPU, cores, memory, Node version, Git commit or null, seed, evaluation config, run config, and position suite version. Save raw/summary CSV, metadata JSON, and deterministic Markdown report under user-selectable output directory.
- [x] Keep default profiles bounded; support `--games 100|500|1000` explicitly without silently running large samples.

## Task 5: Real experiments and verification

- [x] Run the complete eight-position fixed-depth suite and multiple real time budgets, recording actual wall times and every raw row.
- [x] Run smoke and a reasonable standard paired self-play sample; report only completed games and actual elapsed time.
- [x] Recompute summary values from exported raw CSV and inspect any score mismatch or `RULE_AMBIGUITY` before acceptance.
- [x] Run full frontend/backend tests, five existing WeChat E2Es, and migration checks; review the resulting code and data for ungrounded claims.

**Comparison rules:** Node reduction is `(baseline total nodes - optimized total nodes) / baseline total nodes` only for matching position/depth/config rows. TT hit rate is `ttHits / ttProbes` only when probes are nonzero. Time figures are measured medians and means, never estimated. MCTS remains `NOT_IMPLEMENTED`.
