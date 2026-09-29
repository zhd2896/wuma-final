# 《弈智五马》PHASE 26 性能优化验收报告

【阶段】

PHASE 26：性能优化。范围限于现有搜索、基准记录与回归验证；未进入 PHASE 27。

【PHASE 25 基线】

- 搜索：`search-20260927-044020`，576 条原始记录；自对弈：`selfplay-20260927-043535`，100 局。
- 六份原始/汇总/元数据文件的 SHA-256 保存在 `results/phase26_baseline_manifest.json`，阶段结束复核无变化。
- 最终对照保持 `phase25_v1` 原 8 局面、seed 25、深度 1–3、每项 1 次预热及 5 次计时、100/250/500/1000 ms 预算各 3 次、最大深度 4、相同 EvaluationConfig 和局面顺序。元数据配置哈希因新增优化标签不同，核心实验参数相同。

【性能热点】

- 改动前 Node CPU 抽样：132,641 个样本中，`executeTurn` 直接样本 44,902（33.85%）、捕获模式检测 33,586（25.32%）、棋线路径检查 18,017（13.58%）、`analyzePlayer` 9,561（7.21%）；`hashGameState` 直接样本 38（0.03%）。这些是采样器的**直接归属**，不等同于包含子调用的耗时占比。
- 排序阶段已经保存规范走子的 `TurnResult` 与子局面，递归原本没有再次执行同一走法。真正可证明的重复工作在规范走子内部：同一父局面的每个兄弟走法各自重算相同的走前捕获模式。
- TT 深度诊断在原 8 局面深度 3 的 18,399 次剩余深度 0 探表中命中 3,558 次：EXACT 561、bound 2,997，其中 bound 截断 2,669；剩余深度 1/2 均无命中，深度不匹配命中 0。节点在探表前计数，叶节点没有后续子树可跳过，因此基线正式运行虽有 17,790 次命中与 13,345 次 TT 截断，TT 与排序版深度 3 的配对节点数仍均为 113,900。根候选继续独立完整窗口搜索；未放宽 TT 同深度分数规则。

【实验优化】

同配置专项结果均为原 8 局面深度 3、40 条固定深度记录与 96 条预算记录。耗时单位 ms；`500 ms 深度` 为 24 条预算记录的平均完成深度。每一轮固定深度评分均与上一轮及 PHASE 25 Minimax 逐组相同。

| 实验 | 前→后平均节点 | 前→后耗时中位数 | 评分不一致 | 500 ms 深度前→后 | 决定 |
|---|---:|---:|---:|---:|---|
| OPT 1：增量 Zobrist | 2847.5→2847.5 | 5552.656→5400.921 | 0/40 | 1.083→1.333 | 保留，耗时改善较小，单轮数据不足以证明稳定幅度 |
| OPT 2：TT 最佳走法排序 | 2847.5→2847.5 | 5400.921→5482.778 | 0/40 | 1.333→1.250 | **NOT_RETAINED**，代码已撤回 |
| OPT 3：批量规范走子共享走前模式 | 2847.5→2847.5 | 5482.778→4997.347 | 0/40 | 1.250→1.875 | 保留 |

OPT 1 只沿搜索递归传递规范 `TurnResult` 的增量 Hash；完整 `hashGameState` 保留为根节点初始化和测试参考。固定深度 TT 搜索每次仅完整计算根 Hash 一次。专项耗时中位数下降 151.735 ms；改动前 Profile 显示完整 Hash 直接样本很少，因此**不把该差值解释为已证实的稳定整体提速**。

OPT 2 曾从相同局面但不同深度的 TT 条目读取最佳走法，只作为合法走法排序提示，不复用其评分；非法提示会忽略，根候选评分仍使用独立完整窗口。40/40 评分、最佳走法和节点数不变，耗时中位数上升 81.857 ms，四档预算完成深度未改善，因此撤回实现，保留实验原始文件。

OPT 3 增加 `executeTurns` 批量入口，多个兄弟走法只检测一次相同的走前捕获模式；每个走法仍经过原规范执行流程并生成独立子局面。排序和完整局面评分的整批走法使用该入口，寻找首个捕获机会的短路路径继续单步执行。原 8 局面全部合法走法的批量/单步结果深度相等，输入不变；40/40 固定深度评分、走法和节点数不变。专项耗时中位数下降 485.431 ms，500 ms 平均完成深度由 1.250 升至 1.875。

OPT 4 Killer Move、OPT 5 History Heuristic 与 Aspiration Window 未实施：前三项已有可测收益，继续扩展会增加行为与验证范围。

【最终保留优化】

保留 OPT 1 与 OPT 3。最终完整基准运行 ID：`search-20260927-074051`，自对弈运行 ID：`selfplay-20260927-080451767`。最终版本不包含 OPT 2 提示排序。

【搜索正确性】

- 最终完整基准四算法同批比较：评分不一致 0；与 PHASE 25 原始固定深度记录逐组比较：480/480 局面、算法、深度、重复序号匹配，评分不一致 0、节点不一致 0、最佳走法不一致 0。
- 根候选的独立精确评分、快胜慢负顺序、三类终局分数、`RULE_AMBIGUITY` 传播、输入不变性和 TT 搜索作用域均通过回归测试。
- 没有修改合法走法、捕获、储备、终局、EvaluationConfig 或和棋规则。

【Fixed Depth Benchmark】

完整标准运行均为 8 局面 × 5 次。下表为深度 3；深度 1/2 的全部均值、中位数与最大值保存在对应 summary CSV。时间列为 `mean / median / max`，单位 ms。

| 算法 | 节点均值/中位数，前→后 | 时间均值，前→后 | 时间中位数，前→后 | 最大时间，前→后 |
|---|---:|---:|---:|---:|
| MINIMAX | 13723.875/14389.5→相同 | 9904.975→6972.269 | 10266.990→7256.073 | 14819.806→11121.100 |
| ALPHA_BETA | 4751.125/4481.5→相同 | 3126.099→2232.286 | 2907.314→2013.473 | 5909.228→4285.776 |
| ORDERED_ALPHA_BETA | 2847.5/2697.5→相同 | 5639.570→4921.206 | 5863.036→5133.712 | 10131.599→8689.410 |
| ALPHA_BETA_TT | 2847.5/2697.5→相同 | 5487.671→4772.923 | 5737.238→5208.205 | 10453.508→8299.098 |

【Time Budget Benchmark】

每档 8 局面 × 3 次；时间是实际平均耗时，单位 ms。预算到点后保留上一个完整深度，所有 96 条记录 `timedOut=true`。

| 预算 | 完成深度均值/中位数，前→后 | 节点均值，前→后 | 实际时间均值，前→后 | 超时数，前→后 |
|---:|---:|---:|---:|---:|
| 100 | 1/1→1/1 | 85.500→118.958 | 100.800→103.792 | 24→24 |
| 250 | 1/1→1/1 | 223.583→318.083 | 251.208→256.029 | 24→24 |
| 500 | 1.125/1→1.875/2 | 479.625→602.208 | 501.380→502.882 | 24→24 |
| 1000 | 2/2→2.042/2 | 771.708→921.542 | 1002.944→1006.009 | 24→24 |

【TT】

最终深度 3 固定搜索：`ttProbes=113860`，`ttHits=17790`，命中率 `17790/113860=15.624%`，`ttCutoffs=13345`，节点仍为 113,900 总数；这不是额外的节点节省。四档预算合计：`ttProbes=46821`、`ttHits=802`、`ttCutoffs=503`。TT move ordering effect：专项没有降低节点或改善完成深度，已撤回。保持同深度分数复用、碰撞签名保护、mate 归一化、search-scoped TT。

【Zobrist】

基线在每个 TT 访问节点完整扫描局面；现在每次固定深度搜索只对根状态完整重算一次，子节点从规范 `TurnResult` 增量更新。普通/长线走法、CLAMP、CARRY、多重捕获、储备不足、轮换、CAPTURE_ALL、TEMPLE_TRAP、LONE_PIECE_IMMOBILIZED、原 8 局面的全部合法走法与多轮随机对局均验证增量 Hash 等于完整重算。专项墙钟中位数 5552.656→5400.921 ms，幅度小且受计时波动影响；不声称 Hash 独立带来确定的整体加速。

【Self Play】

Smoke：8 局，1 局按棋规终局、7 局达到最大步数。标准：100 局、seed 25、深度 1、最大 60 步，37 局按棋规终局、63 局 `MAX_PLIES_REACHED`、`RULE_AMBIGUITY=0`、`ENGINE_ERROR=0`、`draw=0`。100/100 局走法序列 Hash 与 PHASE 25 完全相同，终止原因也完全相同。`MAX_PLIES_REACHED != DRAW`。

【真实性能结论】

1. OPT 3 的单项实验在相同 8 局面、深度与种子下缩短了深度 3 TT 耗时中位数，并提高了 500 ms 预算的平均完成深度；评分与节点保持相同。这支持保留批量走子共享计算。
2. 最终完整运行的深度 3 TT 耗时中位数由 5737.238 降至 5208.205 ms；同一整套运行的 Minimax 也变快，故这项跨轮差异不能全部归因于优化代码。
3. OPT 2 在目标局面集没有带来收益，已撤回。TT 深度 3 命中主要发生在叶节点，不能由命中次数直接推断节点会下降。

【Benchmark 文件】

| 用途 | raw | summary | metadata | report |
|---|---|---|---|---|
| PHASE 25 搜索基线 | `results/benchmark_search_raw_search-20260927-044020.csv` | `results/benchmark_search_summary_search-20260927-044020.csv` | `results/benchmark_metadata_search-20260927-044020.json` | `results/benchmark_report_search-20260927-044020.md` |
| OPT 前 TT | `results/phase26/benchmark_search_raw_search-20260927-063631.csv` | 同 run ID 的 `benchmark_search_summary_*.csv` | 同 run ID 的 `benchmark_metadata_*.json` | 同 run ID 的 `benchmark_report_*.md` |
| OPT 1 | `results/phase26/benchmark_search_raw_search-20260927-065126.csv` | 同 run ID | 同 run ID | 同 run ID |
| OPT 2 | `results/phase26/benchmark_search_raw_search-20260927-071826.csv` | 同 run ID | 同 run ID | 同 run ID |
| OPT 3 | `results/phase26/benchmark_search_raw_search-20260927-073218.csv` | 同 run ID | 同 run ID | 同 run ID |
| 最终搜索 | `results/phase26/benchmark_search_raw_search-20260927-074051.csv` | `results/phase26/benchmark_search_summary_search-20260927-074051.csv` | `results/phase26/benchmark_metadata_search-20260927-074051.json` | `results/phase26/benchmark_report_search-20260927-074051.md` |
| PHASE 25 自对弈基线 | `results/selfplay_raw_selfplay-20260927-043535.csv` | `results/selfplay_summary_selfplay-20260927-043535.csv` | `results/benchmark_metadata_selfplay-20260927-043535.json` | `results/selfplay_report_selfplay-20260927-043535.md` |
| 最终自对弈 | `results/phase26/selfplay_raw_selfplay-20260927-080451767.csv` | `results/phase26/selfplay_summary_selfplay-20260927-080451767.csv` | `results/phase26/benchmark_metadata_selfplay-20260927-080451767.json` | `results/phase26/selfplay_report_selfplay-20260927-080451767.md` |

诊断资料：`results/phase26_profile/baseline-depth3.cpuprofile`、`results/phase26_profile/tt-depth-diagnostic.json`；自对弈 smoke 原始运行 ID 为 `selfplay-20260927-080428600`。所有上述正式 raw/summary/metadata 已由现有 verifier 校验。

【测试结果】

- `npm test`：297/297 通过；`npm run check`、`npm run typecheck`：通过。
- `backend/.venv/Scripts/python.exe -m pytest backend/tests -q`，使用专用 `wuma_test` MySQL：85/85 通过；Alembic `current=0008_training (head)`，`check` 无新迁移。
- `npm run test:e2e:wechat`、`test:e2e:review`、`test:e2e:llm-review`、`test:e2e:coach`、`test:e2e:training`：五组全部通过，连接隔离数据库与现有微信开发工具。
- `npm run benchmark:ai -- --profile standard ...`：576/576 完成，同批评分不一致 0；100 局标准自对弈、8 局 smoke 与相关原始文件校验通过。
- 新增单元测试先失败后通过：增量/完整 Hash 等价，批量/单步规范走子等价，无同批 Minimax 时不伪报 0 mismatch，同名基准文件不能覆盖。

【当前已知问题】

MCTS 仍为 `NOT_IMPLEMENTED`；无一般和棋规则；第三方 LLM Provider 未做真实密钥 smoke test；Grounding 为第一版；复盘分类阈值仍为 heuristic；HTTPS 尚未配置。直接运行系统 Python 缺少 `pytest`，本项目测试使用仓库内 `backend/.venv`。性能数据是本机单次正式运行及逐项实验，跨轮计时会受到系统状态影响。

【是否满足 PHASE 26 验收】

**是。** 正确性、规则保持、原始基线保全、逐项实验、至少一项有数据支持的优化、完整基准、自对弈和全部指定回归均满足。

【下一阶段】

PHASE 27：Docker 部署。此阶段未开始。
