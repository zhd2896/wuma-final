# PHASE 26 Performance Optimization Implementation Plan

> **For agentic workers:** Implement the tasks sequentially with red/green tests and a separate measured run after each optimization. This repository currently has no Git commits, so preserve timestamped artifacts instead of relying on commit SHAs.

**Goal:** Identify a measured search bottleneck, retain only correct and useful search optimizations, and compare against the immutable PHASE 25 benchmark without changing rules or evaluation.

**Architecture:** Keep `RuleEngine.executeTurn` as the only state transition. Add optional search-local hashing and ordering hints inside the existing AlphaBeta/TT path. Extend the PHASE 25 harness only for selecting measured algorithms and recording Phase 26 metadata. Use the original eight-position suite and seed 25 throughout.

**Tech Stack:** Node 24 TypeScript, Node test runner and CPU profiler, existing benchmark CSV/JSON/Markdown, existing FastAPI/MySQL and WeChat E2Es for regression.

---

## Task 1: Preserve and diagnose the baseline

**Files:** `results/benchmark_search_raw_search-20260927-044020.csv`, matching summary/metadata/report, `results/selfplay_raw_selfplay-20260927-043535.csv`, matching files; optional new `results/phase26_profile/*`.

- [ ] Verify both PHASE 25 standard artifact sets with `npm run benchmark:verify`; record file SHA-256 hashes and never overwrite their timestamped names.
- [ ] Use Node CPU profiling on the existing eight-position suite at depth 3, separated from formal timing. Quantify hash, signature, ordering, rule execution, and evaluation costs from real samples.
- [ ] Read TT probe/store paths and document why hits at depth 3 did not reduce nodes: classify exact/bound/depth-mismatch behavior, root full windows, and move hint usage. Do not relax same-depth score reuse.

## Task 2: Extend the existing harness for sequential experiments

**Files:** `scripts/benchmark/search-harness.mts`, `scripts/benchmark-ai.mts`, `tests/benchmark.test.mts`.

- [ ] Write a failing focused test for selecting only `ALPHA_BETA_TT` while leaving the default four-algorithm suite unchanged; run it red.
- [ ] Add validated optional `--algorithms` and `--optimization-version`/`--baseline-run-id` fields. Keep the same position suite, seed, evaluation config and CSV schema; check the focused test green.
- [ ] Run a targeted pre-optimization TT benchmark using the new selector and save its raw/summary/metadata under a new run ID. Compare fixed depth 3 and budgets 100/250/500/1000 under identical settings in each subsequent stage.

## Task 3: OPT 1, incremental Zobrist

**Files:** `miniprogram/ai/zobrist.ts`, `miniprogram/ai/alpha-beta.ts`, `miniprogram/ai/move-ordering.ts` if turn deltas must be retained, `tests/zobrist.test.mts`, `tests/alpha-beta-tt.test.mts`.

- [ ] Write failing hash-equivalence tests for canonical normal turns, multi-step turns, CLAMP, CARRY, multi-capture, reserve rejection, player switch, CAPTURE_ALL, TEMPLE_TRAP and LONE_PIECE_IMMOBILIZED; verify red.
- [ ] Add a search-only updater that XORs the changed piece, reserve, turn and terminal features from the parent hash and canonical `TurnResult`. Keep `hashGameState` as root initialization/reference. Never mutate a `GameState`.
- [ ] Thread parent hash and canonical turn result through search recursion; preserve the unmodified `stateSignature` collision guard, TT depth semantics, score normalization, and independently full-window root candidates.
- [ ] Run focused correctness tests and the separate OPT 1 targeted benchmark. Record before/after nodes, median time, budget-completed depth, TT hits and score mismatches. Retain only if measurements support value.

## Task 4: OPT 2, TT best-move ordering

**Files:** `miniprogram/ai/transposition-table.ts`, `miniprogram/ai/move-ordering.ts`, `miniprogram/ai/alpha-beta.ts`, `tests/transposition-table.test.mts`, `tests/move-ordering.test.mts`, `tests/alpha-beta-tt.test.mts`.

- [ ] Write failing tests showing a stored move is only an ordering hint, including a different-depth entry and an illegal/stale move; verify red.
- [ ] Expose the entry's `bestMove` without changing exact/bound score reuse rules. Validate it against the generated legal moves, then rank it before existing move categories. Keep root candidate scores exact.
- [ ] Run focused correctness tests and a separate OPT 2 targeted benchmark against the OPT 1 state. Record nodes, median time, completed depth, TT metrics and score mismatches; retain only with measured value.

## Task 5: OPT 3, prove and remove repeated work

**Files:** only the hot-path files identified by Task 1 profiling and their focused tests.

- [ ] Audit whether ordering already reuses `childState` and find any remaining repeated `executeTurn`, legal-move, evaluation or signature work with real profile evidence.
- [ ] If a specific repeat is material, write a failing behavioral/counter test, remove only that repeat, and run a separate targeted benchmark. If no repeat is material, document `NOT_RETAINED` without speculative edits.
- [ ] Consider Killer/History/Aspiration only if the measured preceding stages still justify them; each would require its own correctness test and benchmark.

## Task 6: Final benchmark, regression, and report

**Files:** `results/phase26_*`, `docs/phase26-performance.md`, existing tests as needed.

- [ ] Run the full PHASE 25 standard search profile on the unchanged eight-position suite, depth 1–3, five measured repetitions, one warm-up and 100/250/500/1000 ms budgets; retain raw/summary/metadata/report under a new Phase 26 run ID.
- [ ] Recompute summaries from raw CSV, compare paired score and node rows against PHASE 25, and report time using actual medians with the same configuration. Run smoke self-play and, if still practical, 100 games at seed 25, depth 1, maxPlies 60.
- [ ] Run `npm test`, `npm run check`, `npm run typecheck`, backend pytest, Alembic current/check, and the five existing WeChat E2Es on isolated services.
- [ ] Review the final code and artifacts. Report each OPT as retained or not retained with real before/after values, identify known limits, and stop before PHASE 27.
