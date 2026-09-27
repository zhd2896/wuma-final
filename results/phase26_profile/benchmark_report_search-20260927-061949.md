# AI Search Benchmark

Run: 2026-09-27T06:23:19.550Z
Config hash: 8d57623c69cf6dbb8e77616cce114ec3a4663cdf86cc5694c986d76d7d2bf9db
Environment: win32 10.0.26200; AMD Ryzen 7 6800H with Radeon Graphics         ; Node v24.16.0
MCTS: NOT_IMPLEMENTED

Fixed-depth and time-budget rows are separate experiments. Time is measured by the Node high-resolution wall clock.

| Experiment | Algorithm | Depth | Budget ms | Positions | Samples | Mean nodes | Median nodes | Median ms | Max ms | Mean completed depth | Timeouts | TT hit rate |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| FIXED_DEPTH | ALPHA_BETA | 3.000 | unavailable | 8 | 8 | 4751.125 | 4481.500 | 3098.714 | 6444.881 | 3.000 | 0 | unavailable |
| FIXED_DEPTH | ALPHA_BETA_TT | 3.000 | unavailable | 8 | 8 | 2847.500 | 2697.500 | 6203.910 | 10030.021 | 3.000 | 0 | 0.156 |
| FIXED_DEPTH | MINIMAX | 3.000 | unavailable | 8 | 8 | 13723.875 | 14389.500 | 11060.974 | 16406.877 | 3.000 | 0 | unavailable |
| FIXED_DEPTH | ORDERED_ALPHA_BETA | 3.000 | unavailable | 8 | 8 | 2847.500 | 2697.500 | 6478.010 | 10728.548 | 3.000 | 0 | unavailable |
| TIME_BUDGET | ITERATIVE_DEEPENING | 3.000 | 100.000 | 8 | 8 | 84.375 | 93.500 | 100.419 | 101.236 | 1.000 | 8 | 0.000 |

## Fixed-depth ablation

Each reduction pairs the same position, root player, depth, configuration, and repetition.

| Depth | Position | Baseline | Optimized | Paired samples | Baseline nodes | Optimized nodes | Node reduction % |
|---:|---|---|---|---:|---:|---:|---:|
| 3 | ALL | MINIMAX | ALPHA_BETA | 8 | 109791 | 38009 | 65.381 |
| 3 | capture | MINIMAX | ALPHA_BETA | 1 | 10402 | 3931 | 62.209 |
| 3 | defensive | MINIMAX | ALPHA_BETA | 1 | 13748 | 4689 | 65.893 |
| 3 | forced-win | MINIMAX | ALPHA_BETA | 1 | 19721 | 8376 | 57.528 |
| 3 | lone-piece | MINIMAX | ALPHA_BETA | 1 | 1681 | 839 | 50.089 |
| 3 | midgame | MINIMAX | ALPHA_BETA | 1 | 15444 | 4308 | 72.106 |
| 3 | opening | MINIMAX | ALPHA_BETA | 1 | 14476 | 4655 | 67.843 |
| 3 | tactical | MINIMAX | ALPHA_BETA | 1 | 20016 | 7066 | 64.698 |
| 3 | temple | MINIMAX | ALPHA_BETA | 1 | 14303 | 4145 | 71.020 |
| 3 | ALL | ALPHA_BETA | ORDERED_ALPHA_BETA | 8 | 38009 | 22780 | 40.067 |
| 3 | capture | ALPHA_BETA | ORDERED_ALPHA_BETA | 1 | 3931 | 2148 | 45.357 |
| 3 | defensive | ALPHA_BETA | ORDERED_ALPHA_BETA | 1 | 4689 | 2107 | 55.065 |
| 3 | forced-win | ALPHA_BETA | ORDERED_ALPHA_BETA | 1 | 8376 | 3609 | 56.913 |
| 3 | lone-piece | ALPHA_BETA | ORDERED_ALPHA_BETA | 1 | 839 | 737 | 12.157 |
| 3 | midgame | ALPHA_BETA | ORDERED_ALPHA_BETA | 1 | 4308 | 2768 | 35.747 |
| 3 | opening | ALPHA_BETA | ORDERED_ALPHA_BETA | 1 | 4655 | 3225 | 30.720 |
| 3 | tactical | ALPHA_BETA | ORDERED_ALPHA_BETA | 1 | 7066 | 5559 | 21.327 |
| 3 | temple | ALPHA_BETA | ORDERED_ALPHA_BETA | 1 | 4145 | 2627 | 36.622 |
| 3 | ALL | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 8 | 22780 | 22780 | 0.000 |
| 3 | capture | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 1 | 2148 | 2148 | 0.000 |
| 3 | defensive | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 1 | 2107 | 2107 | 0.000 |
| 3 | forced-win | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 1 | 3609 | 3609 | 0.000 |
| 3 | lone-piece | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 1 | 737 | 737 | 0.000 |
| 3 | midgame | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 1 | 2768 | 2768 | 0.000 |
| 3 | opening | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 1 | 3225 | 3225 | 0.000 |
| 3 | tactical | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 1 | 5559 | 5559 | 0.000 |
| 3 | temple | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 1 | 2627 | 2627 | 0.000 |

Results describe this run and hardware only. Short searches may have high timing noise.
