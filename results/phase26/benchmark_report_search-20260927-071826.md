# AI Search Benchmark

Run: 2026-09-27T07:23:40.072Z
Config hash: 343369245e19bed0a1e6bef49b3805353b2a141cc12b6638529399f09db043bd
Environment: win32 10.0.26200; AMD Ryzen 7 6800H with Radeon Graphics         ; Node v24.16.0
MCTS: NOT_IMPLEMENTED

Fixed-depth and time-budget rows are separate experiments. Time is measured by the Node high-resolution wall clock.

| Experiment | Algorithm | Depth | Budget ms | Positions | Samples | Mean nodes | Median nodes | Median ms | Max ms | Mean completed depth | Timeouts | TT hit rate |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| FIXED_DEPTH | ALPHA_BETA_TT | 3.000 | unavailable | 8 | 40 | 2847.500 | 2697.500 | 5482.778 | 9978.938 | 3.000 | 0 | 0.156 |
| TIME_BUDGET | ITERATIVE_DEEPENING | 4.000 | 100.000 | 8 | 24 | 95.708 | 100.000 | 100.673 | 134.054 | 1.000 | 24 | 0.000 |
| TIME_BUDGET | ITERATIVE_DEEPENING | 4.000 | 1000.000 | 8 | 24 | 837.292 | 845.500 | 1001.191 | 1011.204 | 2.000 | 24 | 0.021 |
| TIME_BUDGET | ITERATIVE_DEEPENING | 4.000 | 250.000 | 8 | 24 | 251.167 | 262.500 | 250.468 | 259.181 | 1.000 | 24 | 0.000 |
| TIME_BUDGET | ITERATIVE_DEEPENING | 4.000 | 500.000 | 8 | 24 | 507.125 | 525.000 | 501.059 | 511.151 | 1.250 | 24 | 0.000 |

## Fixed-depth ablation

Each reduction pairs the same position, root player, depth, configuration, and repetition.

| Depth | Position | Baseline | Optimized | Paired samples | Baseline nodes | Optimized nodes | Node reduction % |
|---:|---|---|---|---:|---:|---:|---:|
| 3 | ALL | MINIMAX | ALPHA_BETA | 0 | 0 | 0 | unavailable |
| 3 | ALL | ALPHA_BETA | ORDERED_ALPHA_BETA | 0 | 0 | 0 | unavailable |
| 3 | ALL | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 0 | 0 | 0 | unavailable |

Results describe this run and hardware only. Short searches may have high timing noise.
