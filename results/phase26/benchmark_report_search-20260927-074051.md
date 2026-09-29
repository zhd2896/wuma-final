# AI Search Benchmark

Run: 2026-09-27T07:58:12.034Z
Config hash: bab556daf8ef86eb7d59cd62876fc9753960792bf5070d8cca6c46b79e0be7e0
Environment: win32 10.0.26200; AMD Ryzen 7 6800H with Radeon Graphics         ; Node v24.16.0
MCTS: NOT_IMPLEMENTED

Fixed-depth and time-budget rows are separate experiments. Time is measured by the Node high-resolution wall clock.

| Experiment | Algorithm | Depth | Budget ms | Positions | Samples | Mean nodes | Median nodes | Median ms | Max ms | Mean completed depth | Timeouts | TT hit rate |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| FIXED_DEPTH | ALPHA_BETA | 1.000 | unavailable | 8 | 40 | 25.375 | 28.000 | 13.252 | 23.171 | 1.000 | 0 | unavailable |
| FIXED_DEPTH | ALPHA_BETA_TT | 1.000 | unavailable | 8 | 40 | 25.375 | 28.000 | 21.375 | 29.250 | 1.000 | 0 | 0.000 |
| FIXED_DEPTH | MINIMAX | 1.000 | unavailable | 8 | 40 | 25.375 | 28.000 | 13.033 | 21.312 | 1.000 | 0 | unavailable |
| FIXED_DEPTH | ORDERED_ALPHA_BETA | 1.000 | unavailable | 8 | 40 | 25.375 | 28.000 | 20.792 | 25.654 | 1.000 | 0 | unavailable |
| FIXED_DEPTH | ALPHA_BETA | 2.000 | unavailable | 8 | 40 | 547.625 | 574.000 | 279.057 | 379.978 | 2.000 | 0 | unavailable |
| FIXED_DEPTH | ALPHA_BETA_TT | 2.000 | unavailable | 8 | 40 | 547.625 | 574.000 | 434.650 | 551.539 | 2.000 | 0 | 0.000 |
| FIXED_DEPTH | MINIMAX | 2.000 | unavailable | 8 | 40 | 547.625 | 574.000 | 279.566 | 393.532 | 2.000 | 0 | unavailable |
| FIXED_DEPTH | ORDERED_ALPHA_BETA | 2.000 | unavailable | 8 | 40 | 547.625 | 574.000 | 431.736 | 550.294 | 2.000 | 0 | unavailable |
| FIXED_DEPTH | ALPHA_BETA | 3.000 | unavailable | 8 | 40 | 4751.125 | 4481.500 | 2013.473 | 4285.776 | 3.000 | 0 | unavailable |
| FIXED_DEPTH | ALPHA_BETA_TT | 3.000 | unavailable | 8 | 40 | 2847.500 | 2697.500 | 5208.205 | 8299.098 | 3.000 | 0 | 0.156 |
| FIXED_DEPTH | MINIMAX | 3.000 | unavailable | 8 | 40 | 13723.875 | 14389.500 | 7256.073 | 11121.100 | 3.000 | 0 | unavailable |
| FIXED_DEPTH | ORDERED_ALPHA_BETA | 3.000 | unavailable | 8 | 40 | 2847.500 | 2697.500 | 5133.712 | 8689.410 | 3.000 | 0 | unavailable |
| TIME_BUDGET | ITERATIVE_DEEPENING | 4.000 | 100.000 | 8 | 24 | 118.958 | 129.500 | 100.405 | 123.182 | 1.000 | 24 | 0.000 |
| TIME_BUDGET | ITERATIVE_DEEPENING | 4.000 | 1000.000 | 8 | 24 | 921.542 | 885.500 | 1004.048 | 1017.464 | 2.042 | 24 | 0.036 |
| TIME_BUDGET | ITERATIVE_DEEPENING | 4.000 | 250.000 | 8 | 24 | 318.083 | 341.500 | 250.618 | 287.472 | 1.000 | 24 | 0.000 |
| TIME_BUDGET | ITERATIVE_DEEPENING | 4.000 | 500.000 | 8 | 24 | 602.208 | 642.500 | 500.703 | 510.769 | 1.875 | 24 | 0.000 |

## Fixed-depth ablation

Each reduction pairs the same position, root player, depth, configuration, and repetition.

| Depth | Position | Baseline | Optimized | Paired samples | Baseline nodes | Optimized nodes | Node reduction % |
|---:|---|---|---|---:|---:|---:|---:|
| 1 | ALL | MINIMAX | ALPHA_BETA | 40 | 1015 | 1015 | 0.000 |
| 1 | capture | MINIMAX | ALPHA_BETA | 5 | 95 | 95 | 0.000 |
| 1 | defensive | MINIMAX | ALPHA_BETA | 5 | 145 | 145 | 0.000 |
| 1 | forced-win | MINIMAX | ALPHA_BETA | 5 | 160 | 160 | 0.000 |
| 1 | lone-piece | MINIMAX | ALPHA_BETA | 5 | 35 | 35 | 0.000 |
| 1 | midgame | MINIMAX | ALPHA_BETA | 5 | 150 | 150 | 0.000 |
| 1 | opening | MINIMAX | ALPHA_BETA | 5 | 130 | 130 | 0.000 |
| 1 | tactical | MINIMAX | ALPHA_BETA | 5 | 165 | 165 | 0.000 |
| 1 | temple | MINIMAX | ALPHA_BETA | 5 | 135 | 135 | 0.000 |
| 1 | ALL | ALPHA_BETA | ORDERED_ALPHA_BETA | 40 | 1015 | 1015 | 0.000 |
| 1 | capture | ALPHA_BETA | ORDERED_ALPHA_BETA | 5 | 95 | 95 | 0.000 |
| 1 | defensive | ALPHA_BETA | ORDERED_ALPHA_BETA | 5 | 145 | 145 | 0.000 |
| 1 | forced-win | ALPHA_BETA | ORDERED_ALPHA_BETA | 5 | 160 | 160 | 0.000 |
| 1 | lone-piece | ALPHA_BETA | ORDERED_ALPHA_BETA | 5 | 35 | 35 | 0.000 |
| 1 | midgame | ALPHA_BETA | ORDERED_ALPHA_BETA | 5 | 150 | 150 | 0.000 |
| 1 | opening | ALPHA_BETA | ORDERED_ALPHA_BETA | 5 | 130 | 130 | 0.000 |
| 1 | tactical | ALPHA_BETA | ORDERED_ALPHA_BETA | 5 | 165 | 165 | 0.000 |
| 1 | temple | ALPHA_BETA | ORDERED_ALPHA_BETA | 5 | 135 | 135 | 0.000 |
| 1 | ALL | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 40 | 1015 | 1015 | 0.000 |
| 1 | capture | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 5 | 95 | 95 | 0.000 |
| 1 | defensive | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 5 | 145 | 145 | 0.000 |
| 1 | forced-win | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 5 | 160 | 160 | 0.000 |
| 1 | lone-piece | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 5 | 35 | 35 | 0.000 |
| 1 | midgame | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 5 | 150 | 150 | 0.000 |
| 1 | opening | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 5 | 130 | 130 | 0.000 |
| 1 | tactical | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 5 | 165 | 165 | 0.000 |
| 1 | temple | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 5 | 135 | 135 | 0.000 |
| 2 | ALL | MINIMAX | ALPHA_BETA | 40 | 21905 | 21905 | 0.000 |
| 2 | capture | MINIMAX | ALPHA_BETA | 5 | 2330 | 2330 | 0.000 |
| 2 | defensive | MINIMAX | ALPHA_BETA | 5 | 2765 | 2765 | 0.000 |
| 2 | forced-win | MINIMAX | ALPHA_BETA | 5 | 3435 | 3435 | 0.000 |
| 2 | lone-piece | MINIMAX | ALPHA_BETA | 5 | 1290 | 1290 | 0.000 |
| 2 | midgame | MINIMAX | ALPHA_BETA | 5 | 2945 | 2945 | 0.000 |
| 2 | opening | MINIMAX | ALPHA_BETA | 5 | 2885 | 2885 | 0.000 |
| 2 | tactical | MINIMAX | ALPHA_BETA | 5 | 3400 | 3400 | 0.000 |
| 2 | temple | MINIMAX | ALPHA_BETA | 5 | 2855 | 2855 | 0.000 |
| 2 | ALL | ALPHA_BETA | ORDERED_ALPHA_BETA | 40 | 21905 | 21905 | 0.000 |
| 2 | capture | ALPHA_BETA | ORDERED_ALPHA_BETA | 5 | 2330 | 2330 | 0.000 |
| 2 | defensive | ALPHA_BETA | ORDERED_ALPHA_BETA | 5 | 2765 | 2765 | 0.000 |
| 2 | forced-win | ALPHA_BETA | ORDERED_ALPHA_BETA | 5 | 3435 | 3435 | 0.000 |
| 2 | lone-piece | ALPHA_BETA | ORDERED_ALPHA_BETA | 5 | 1290 | 1290 | 0.000 |
| 2 | midgame | ALPHA_BETA | ORDERED_ALPHA_BETA | 5 | 2945 | 2945 | 0.000 |
| 2 | opening | ALPHA_BETA | ORDERED_ALPHA_BETA | 5 | 2885 | 2885 | 0.000 |
| 2 | tactical | ALPHA_BETA | ORDERED_ALPHA_BETA | 5 | 3400 | 3400 | 0.000 |
| 2 | temple | ALPHA_BETA | ORDERED_ALPHA_BETA | 5 | 2855 | 2855 | 0.000 |
| 2 | ALL | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 40 | 21905 | 21905 | 0.000 |
| 2 | capture | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 5 | 2330 | 2330 | 0.000 |
| 2 | defensive | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 5 | 2765 | 2765 | 0.000 |
| 2 | forced-win | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 5 | 3435 | 3435 | 0.000 |
| 2 | lone-piece | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 5 | 1290 | 1290 | 0.000 |
| 2 | midgame | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 5 | 2945 | 2945 | 0.000 |
| 2 | opening | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 5 | 2885 | 2885 | 0.000 |
| 2 | tactical | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 5 | 3400 | 3400 | 0.000 |
| 2 | temple | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 5 | 2855 | 2855 | 0.000 |
| 3 | ALL | MINIMAX | ALPHA_BETA | 40 | 548955 | 190045 | 65.381 |
| 3 | capture | MINIMAX | ALPHA_BETA | 5 | 52010 | 19655 | 62.209 |
| 3 | defensive | MINIMAX | ALPHA_BETA | 5 | 68740 | 23445 | 65.893 |
| 3 | forced-win | MINIMAX | ALPHA_BETA | 5 | 98605 | 41880 | 57.528 |
| 3 | lone-piece | MINIMAX | ALPHA_BETA | 5 | 8405 | 4195 | 50.089 |
| 3 | midgame | MINIMAX | ALPHA_BETA | 5 | 77220 | 21540 | 72.106 |
| 3 | opening | MINIMAX | ALPHA_BETA | 5 | 72380 | 23275 | 67.843 |
| 3 | tactical | MINIMAX | ALPHA_BETA | 5 | 100080 | 35330 | 64.698 |
| 3 | temple | MINIMAX | ALPHA_BETA | 5 | 71515 | 20725 | 71.020 |
| 3 | ALL | ALPHA_BETA | ORDERED_ALPHA_BETA | 40 | 190045 | 113900 | 40.067 |
| 3 | capture | ALPHA_BETA | ORDERED_ALPHA_BETA | 5 | 19655 | 10740 | 45.357 |
| 3 | defensive | ALPHA_BETA | ORDERED_ALPHA_BETA | 5 | 23445 | 10535 | 55.065 |
| 3 | forced-win | ALPHA_BETA | ORDERED_ALPHA_BETA | 5 | 41880 | 18045 | 56.913 |
| 3 | lone-piece | ALPHA_BETA | ORDERED_ALPHA_BETA | 5 | 4195 | 3685 | 12.157 |
| 3 | midgame | ALPHA_BETA | ORDERED_ALPHA_BETA | 5 | 21540 | 13840 | 35.747 |
| 3 | opening | ALPHA_BETA | ORDERED_ALPHA_BETA | 5 | 23275 | 16125 | 30.720 |
| 3 | tactical | ALPHA_BETA | ORDERED_ALPHA_BETA | 5 | 35330 | 27795 | 21.327 |
| 3 | temple | ALPHA_BETA | ORDERED_ALPHA_BETA | 5 | 20725 | 13135 | 36.622 |
| 3 | ALL | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 40 | 113900 | 113900 | 0.000 |
| 3 | capture | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 5 | 10740 | 10740 | 0.000 |
| 3 | defensive | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 5 | 10535 | 10535 | 0.000 |
| 3 | forced-win | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 5 | 18045 | 18045 | 0.000 |
| 3 | lone-piece | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 5 | 3685 | 3685 | 0.000 |
| 3 | midgame | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 5 | 13840 | 13840 | 0.000 |
| 3 | opening | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 5 | 16125 | 16125 | 0.000 |
| 3 | tactical | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 5 | 27795 | 27795 | 0.000 |
| 3 | temple | ORDERED_ALPHA_BETA | ALPHA_BETA_TT | 5 | 13135 | 13135 | 0.000 |

Results describe this run and hardware only. Short searches may have high timing noise.
