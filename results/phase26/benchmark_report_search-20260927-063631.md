# AI Search Benchmark

Run: 2026-09-27T06:41:40.047Z
Config hash: 6376510e24771681c7589bcf7d49cedcb388b21acdebb61d3088223b47e2d17d
Environment: win32 10.0.26200; AMD Ryzen 7 6800H with Radeon Graphics         ; Node v24.16.0
MCTS: NOT_IMPLEMENTED

Fixed-depth and time-budget rows are separate experiments. Time is measured by the Node high-resolution wall clock.

| Experiment | Algorithm | Depth | Budget ms | Positions | Samples | Mean nodes | Median nodes | Median ms | Max ms | Mean completed depth | Timeouts | TT hit rate |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| FIXED_DEPTH | ALPHA_BETA_TT | 3.000 | unavailable | 8 | 40 | 2847.500 | 2697.500 | 5552.656 | 8765.947 | 3.000 | 0 | 0.156 |
| TIME_BUDGET | ITERATIVE_DEEPENING | 4.000 | 100.000 | 8 | 24 | 96.667 | 103.000 | 100.480 | 126.542 | 1.000 | 24 | 0.000 |
| TIME_BUDGET | ITERATIVE_DEEPENING | 4.000 | 1000.000 | 8 | 24 | 848.083 | 825.000 | 1006.502 | 1017.199 | 2.000 | 24 | 0.028 |
| TIME_BUDGET | ITERATIVE_DEEPENING | 4.000 | 250.000 | 8 | 24 | 257.417 | 274.500 | 250.499 | 256.208 | 1.000 | 24 | 0.000 |
| TIME_BUDGET | ITERATIVE_DEEPENING | 4.000 | 500.000 | 8 | 24 | 507.917 | 534.000 | 500.525 | 513.009 | 1.083 | 24 | 0.000 |

## Fixed-depth ablation

Each reduction pairs the same position, root player, depth, configuration, and repetition.

| Depth | Position | Baseline | Optimized | Paired samples | Baseline nodes | Optimized nodes | Node reduction % |
|---:|---|---|---|---:|---:|---:|---:|
| 3 | ALL | MINIMAX | ALPHA_BETA | 0 | 0 | 0 | unavailable |
| 3 | ALL | ALPHA_BETA | ORDERED_ALPHA_BETA | 0 | 0 | 0 | unavailable |
| 3 | ALL | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 0 | 0 | 0 | unavailable |

Results describe this run and hardware only. Short searches may have high timing noise.
