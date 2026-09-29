# AI Search Benchmark

Run: 2026-09-27T07:37:05.923Z
Config hash: 87d08d50c84823e6f28222aa428a7f8390e44cee117d154519ff226316134e8b
Environment: win32 10.0.26200; AMD Ryzen 7 6800H with Radeon Graphics         ; Node v24.16.0
MCTS: NOT_IMPLEMENTED

Fixed-depth and time-budget rows are separate experiments. Time is measured by the Node high-resolution wall clock.

| Experiment | Algorithm | Depth | Budget ms | Positions | Samples | Mean nodes | Median nodes | Median ms | Max ms | Mean completed depth | Timeouts | TT hit rate |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| FIXED_DEPTH | ALPHA_BETA_TT | 3.000 | unavailable | 8 | 40 | 2847.500 | 2697.500 | 4997.347 | 7972.291 | 3.000 | 0 | 0.156 |
| TIME_BUDGET | ITERATIVE_DEEPENING | 4.000 | 100.000 | 8 | 24 | 121.417 | 131.000 | 100.508 | 121.780 | 1.000 | 24 | 0.000 |
| TIME_BUDGET | ITERATIVE_DEEPENING | 4.000 | 1000.000 | 8 | 24 | 913.500 | 893.000 | 1002.261 | 1021.384 | 2.000 | 24 | 0.028 |
| TIME_BUDGET | ITERATIVE_DEEPENING | 4.000 | 250.000 | 8 | 24 | 314.458 | 334.000 | 250.871 | 278.225 | 1.000 | 24 | 0.000 |
| TIME_BUDGET | ITERATIVE_DEEPENING | 4.000 | 500.000 | 8 | 24 | 595.958 | 642.000 | 501.560 | 515.188 | 1.875 | 24 | 0.000 |

## Fixed-depth ablation

Each reduction pairs the same position, root player, depth, configuration, and repetition.

| Depth | Position | Baseline | Optimized | Paired samples | Baseline nodes | Optimized nodes | Node reduction % |
|---:|---|---|---|---:|---:|---:|---:|
| 3 | ALL | MINIMAX | ALPHA_BETA | 0 | 0 | 0 | unavailable |
| 3 | ALL | ALPHA_BETA | ORDERED_ALPHA_BETA | 0 | 0 | 0 | unavailable |
| 3 | ALL | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 0 | 0 | 0 | unavailable |

Results describe this run and hardware only. Short searches may have high timing noise.
