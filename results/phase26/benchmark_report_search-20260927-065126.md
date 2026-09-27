# AI Search Benchmark

Run: 2026-09-27T06:56:30.241Z
Config hash: 1d6f81aea2ac6c80bcbfb96799f2c0c8fd6773254829c8d033c8aac75c5c8911
Environment: win32 10.0.26200; AMD Ryzen 7 6800H with Radeon Graphics         ; Node v24.16.0
MCTS: NOT_IMPLEMENTED

Fixed-depth and time-budget rows are separate experiments. Time is measured by the Node high-resolution wall clock.

| Experiment | Algorithm | Depth | Budget ms | Positions | Samples | Mean nodes | Median nodes | Median ms | Max ms | Mean completed depth | Timeouts | TT hit rate |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| FIXED_DEPTH | ALPHA_BETA_TT | 3.000 | unavailable | 8 | 40 | 2847.500 | 2697.500 | 5400.921 | 8736.652 | 3.000 | 0 | 0.156 |
| TIME_BUDGET | ITERATIVE_DEEPENING | 4.000 | 100.000 | 8 | 24 | 99.167 | 103.500 | 100.381 | 135.221 | 1.000 | 24 | 0.000 |
| TIME_BUDGET | ITERATIVE_DEEPENING | 4.000 | 1000.000 | 8 | 24 | 856.958 | 835.500 | 1002.771 | 1010.584 | 2.000 | 24 | 0.027 |
| TIME_BUDGET | ITERATIVE_DEEPENING | 4.000 | 250.000 | 8 | 24 | 258.708 | 273.500 | 250.588 | 257.379 | 1.000 | 24 | 0.000 |
| TIME_BUDGET | ITERATIVE_DEEPENING | 4.000 | 500.000 | 8 | 24 | 523.292 | 538.000 | 502.697 | 534.831 | 1.333 | 24 | 0.000 |

## Fixed-depth ablation

Each reduction pairs the same position, root player, depth, configuration, and repetition.

| Depth | Position | Baseline | Optimized | Paired samples | Baseline nodes | Optimized nodes | Node reduction % |
|---:|---|---|---|---:|---:|---:|---:|
| 3 | ALL | MINIMAX | ALPHA_BETA | 0 | 0 | 0 | unavailable |
| 3 | ALL | ALPHA_BETA | ORDERED_ALPHA_BETA | 0 | 0 | 0 | unavailable |
| 3 | ALL | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 0 | 0 | 0 | unavailable |

Results describe this run and hardware only. Short searches may have high timing noise.
