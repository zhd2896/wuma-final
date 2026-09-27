# PHASE 25 Benchmark

The benchmark calls the existing TypeScript `RuleEngine` and AI classes directly. It does not use the API, database, Python rules, LLM, or a new search implementation. MCTS is `NOT_IMPLEMENTED`.

## Commands

```powershell
npm run benchmark:ai -- --profile smoke --output-dir results
npm run benchmark:ai -- --profile standard --output-dir results
npm run benchmark:selfplay -- --profile smoke --output-dir results
npm run benchmark:selfplay -- --profile standard --games 100 --seed 25 --max-plies 60 --depth 1 --output-dir results
```

Search accepts `--depth 1,2,3`, `--repetitions 5`, `--warmups 1`, `--budgets 100,250,500,1000`, `--budget-repetitions 3`, `--max-depth 4`, and `--seed 25`. The standard profile uses those values by default. The smoke profile uses depths 1–2, two repetitions, and 50/150 ms budgets. Search's seed fixes the order of positions. Each measurement creates a new AI object; warm-ups are excluded from CSV rows.

Self-play accepts `--games`, `--seed`, `--max-plies`, `--depth`, `--time-budget`, and `--matchup random-minimax|random-tt|minimax-ab|ab-tt|tt-iterative|all`. `--games` is the **total** across selected matchups and must be even. Games are allocated in swapped-side pairs; with four matchups, 100 games are allocated 26/26/24/24. `--games 500` and `--games 1000` are supported but are not default runs. The `large` profile requires an explicit game count.

## Output and interpretation

Each run writes raw CSV, a summary CSV computed from raw rows, metadata JSON, and a Markdown report in the selected directory. Keep matching run IDs together. Verify exported summary and configuration hash with:

```powershell
npm run benchmark:verify -- search results/benchmark_search_raw_RUN.csv results/benchmark_search_summary_RUN.csv results/benchmark_metadata_RUN.json
npm run benchmark:verify -- selfplay results/selfplay_raw_RUN.csv results/selfplay_summary_RUN.csv results/benchmark_metadata_RUN.json
```

For a saved raw CSV produced by an older report schema, add `--refresh` before the kind to rebuild only its derived summary and report from that raw CSV, then verify them.

The eight position fixtures in `scripts/benchmark/positions.mts` are reconstructed by legal turns through `RuleEngine.executeTurn`. Fixed-depth comparisons use the same state, root player, evaluation configuration, depth, and repetition. The four existing algorithms are Minimax, AlphaBeta, ordered AlphaBeta, and AlphaBeta with transposition table. Iterative deepening runs separately under time budgets. Nodes count positions visited, including the root; iterative deepening sums visited positions across its iterations. Timings use the Node high-resolution wall clock and reflect this machine and process.

For self-play, every move is adjudicated by `RuleEngine.executeTurn`. Random moves use a seeded RNG, and each pair swaps the algorithm assigned to player A. `COMPLETED` means the canonical engine declared a winner. `MAX_PLIES_REACHED`, `RULE_AMBIGUITY`, and `ENGINE_ERROR` are recorded separately. The game has no general draw rule, so none of those outcomes counts as a draw or a win. The move sequence and its SHA-256 hash are preserved in each raw game row.

Self-play average plies, time, nodes, and search depth use all started games, including capped or interrupted games. Win counts and `gamesFinished` use completed games only.
