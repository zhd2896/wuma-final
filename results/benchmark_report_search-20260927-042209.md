# AI Search Benchmark

Run: 2026-09-27T04:23:01.113Z
Config hash: 66e6dba6dd2c9b745c5e3a9297ec44dfaf33fde19958332e03ea5281e23b9b42
Environment: win32 10.0.26200; AMD Ryzen 7 6800H with Radeon Graphics         ; Node v24.16.0
MCTS: NOT_IMPLEMENTED

Fixed-depth and time-budget rows are separate experiments. Time is measured by the Node high-resolution wall clock.

| Experiment | Algorithm | Depth | Budget ms | Positions | Samples | Mean nodes | Median nodes | Median ms | Max ms | Mean completed depth | Timeouts | TT hit rate |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| FIXED_DEPTH | ALPHA_BETA | 1.000 | unavailable | 8 | 16 | 25.375 | 28.000 | 18.669 | 26.923 | 1.000 | 0 | unavailable |
| FIXED_DEPTH | ALPHA_BETA_TT | 1.000 | unavailable | 8 | 16 | 25.375 | 28.000 | 27.668 | 30.551 | 1.000 | 0 | 0.000 |
| FIXED_DEPTH | MINIMAX | 1.000 | unavailable | 8 | 16 | 25.375 | 28.000 | 18.411 | 24.762 | 1.000 | 0 | unavailable |
| FIXED_DEPTH | ORDERED_ALPHA_BETA | 1.000 | unavailable | 8 | 16 | 25.375 | 28.000 | 26.373 | 33.105 | 1.000 | 0 | unavailable |
| FIXED_DEPTH | ALPHA_BETA | 2.000 | unavailable | 8 | 16 | 547.625 | 574.000 | 390.302 | 558.419 | 2.000 | 0 | unavailable |
| FIXED_DEPTH | ALPHA_BETA_TT | 2.000 | unavailable | 8 | 16 | 547.625 | 574.000 | 535.128 | 714.899 | 2.000 | 0 | 0.000 |
| FIXED_DEPTH | MINIMAX | 2.000 | unavailable | 8 | 16 | 547.625 | 574.000 | 386.515 | 548.504 | 2.000 | 0 | unavailable |
| FIXED_DEPTH | ORDERED_ALPHA_BETA | 2.000 | unavailable | 8 | 16 | 547.625 | 574.000 | 529.090 | 686.437 | 2.000 | 0 | unavailable |
| TIME_BUDGET | ITERATIVE_DEEPENING | 3.000 | 150.000 | 8 | 16 | 140.750 | 155.000 | 150.479 | 153.435 | 1.000 | 16 | 0.000 |
| TIME_BUDGET | ITERATIVE_DEEPENING | 3.000 | 50.000 | 8 | 16 | 40.563 | 43.000 | 50.345 | 60.667 | 1.000 | 16 | 0.000 |

## Fixed-depth ablation

Each reduction pairs the same position, root player, depth, configuration, and repetition.

| Depth | Baseline | Optimized | Paired samples | Baseline nodes | Optimized nodes | Node reduction % |
|---:|---|---|---:|---:|---:|---:|
| 1 | MINIMAX | ALPHA_BETA | 16 | 406 | 406 | 0.000 |
| 1 | ALPHA_BETA | ORDERED_ALPHA_BETA | 16 | 406 | 406 | 0.000 |
| 1 | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 16 | 406 | 406 | 0.000 |
| 2 | MINIMAX | ALPHA_BETA | 16 | 8762 | 8762 | 0.000 |
| 2 | ALPHA_BETA | ORDERED_ALPHA_BETA | 16 | 8762 | 8762 | 0.000 |
| 2 | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 16 | 8762 | 8762 | 0.000 |

Results describe this run and hardware only. Short searches may have high timing noise.
