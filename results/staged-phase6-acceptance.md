# 第六阶段：逐手回放与非 AI 视角验收

基线 `b817e09`，迁移 head `0017_local_game_imports`；本阶段不新增迁移、不部署、不操作业务数据库。

## 已实现行为

- 普通 `GET /api/v1/game/{id}/replay` 要求当前所有者；REMOTE 经 `/api/v1/remote/rooms/{id}/replay` 和房间 token + 已绑定当前账号双重校验，读取完成后再次校验。旧未绑定席位须先经过既有 claim 流程，保留房间探测兼容。
- `read_replay` 的有效棋步与头保持既有快照一致性。校验有效手数、连续 turn、走前与上一局面、版本正数递增且不超头、真实保存终局/认输事件。自然结束属于最后真实棋步，认输独立步骤不增加 ply；零手认输展示初始+终局。撤销分支不返回。
- 回放读取历史保存的 state/capture/reserve，不调用未来 Engine.execute_turn、不修改棋局、棋步或复盘。走前路线对照保留且明确区分实际走后回放。
- 真实 Review Page 增加原生首局面/上一手/下一手/终局/slider；同步棋盘、最后走法、备用棋、行动方、吃子结果和当前解释。对手步骤标注“对手走法，没有本人评价”。
- LOCAL A/B 选择权限来自服务器实际 GameDto；AI 固定保存 ai_player 反方 human，REMOTE 固定恢复本人 seat。get/createReview、get/explainReview、generateTraining 全部传当前玩家。generation + hide/unload 防止旧 view 的加载、解释、训练覆盖状态或跳错列表。
- Training.generate 同时过滤新增来源和仓储返回的旧记录，仅当前 review.reviewedPlayer 的 MISTAKE/BLUNDER。旧对方题目保留。训练列表可选 player，内存与 SQL 的 items/total/分页共用真实 player 条件；Review 跳转携带 source=REVIEW&gameId&player。Page/controller 更换题源清掉不适用来源棋局、玩家和类别，保留 CURATED/进度筛选。
- 第一阶段正常 navigateBack 和 root/login fallback，以及第五阶段本地棋谱导入与联机席位恢复不回归。

## TDD 与检查证据

| 命令/日志 | 结果 |
| --- | --- |
| pytest test_replay.py 首次（staged-phase6-backend-red.log） | 新接口缺失预期红灯；同步导入测试构造随后修正为鉴权模式 |
| pytest test_replay.py + test_training_perspective.py（staged-phase6-training-red.log） | 原生成/列表未过滤玩家，预期红灯；REMOTE status 保持既有403 |
| node --test tests/review-replay.test.mts tests/training-perspective.test.mts（staged-phase6-front-red.log） | 新页面操作/筛选缺失预期红灯 |
| staged-phase6-replay-contract-red.log → front focused | 有效 undo 后 header 大于最后 MOVE 版本的错误拒绝，已红绿修复 |
| staged-phase6-controller-red.log → controller-green.log | 更换题源仍携带 player/game，已红绿修复；11 passed，无 skip |
| staged-phase6-version-red.log → backend-focus.log | 原后端接受0/超头/重复revision及自然终局头不符，已红绿修复 |
| staged-phase6-legacy-seat-red.log → backend-focus.log | 原新回放接受未claim旧席位，已红绿修复 |
| pytest test_replay.py test_review.py test_remote_accounts.py test_training_perspective.py（backend-focus.log） | 49 passed，0 skipped |
| node focused（front-focus.log） | 21 passed，0 skipped，包含无本地token房间恢复 |
| npm test（front-full.log） | 507 passed，0 failed，0 skipped |
| npm run typecheck（typecheck.log） | PASS |
| npm run check（check.log） | PASS，11 pages / 18 components |
| pytest backend/tests -q（backend-full.log） | 318 passed，0 failed，0 skipped，256.89s |
| 独立 SPEC | PASS：34 backend / 21 node、0 skip；原始损坏版本与旧未绑定席位复现已复核 |
| 独立 QUALITY | PASS：49 backend memory / 21 node，0 failed / 0 skipped，无阻塞问题 |
| git diff --check | PASS；本代理新增日志均已清除行尾空白 |

前端首次 full 中旧恢复测试未提供新增 replay 响应（front-full-first.log）；补充一致版本的 fixture 并保留原席位恢复断言后最终全量507通过。MySQL 首轮 fixture 使用了 memory-only update，已改用真实14手合法完整棋谱，不添加生产测试后门。

## 专用 MySQL

仅使用端口34365、server_uuid `79904ab3-c0d6-11f1-b2bb-088fc3774c8f`；核对 `results/staged-mysql-20261006/auto.cnf`。features 为 `staged_features_test`；新迁移库 `staged_phase6_20261006_0535_test` 创建时 inspect 表列表为空、字符集 utf8mb4 / utf8mb4_unicode_ci。prepare 脚本与日志保留，没有删除数据库，实例保持供后续阶段使用。

MySQL focus（staged-phase6-mysql-focus.log）4 passed、0 skipped：真实自然终局/capture/reserve/只读不变，undo有效分支与零手导入认输，双方生成后玩家筛选/计数/分页，REMOTE token/account 和读取中token旋转拒绝。

全后端命令：

```powershell
$env:WUMA_TEST_DATABASE_URL = 'mysql+pymysql://root@127.0.0.1:34365/staged_features_test?charset=utf8mb4'
$env:WUMA_TEST_MIGRATION_DATABASE_URL = 'mysql+pymysql://root@127.0.0.1:34365/staged_phase6_20261006_0535_test?charset=utf8mb4'
& 'backend/.venv/Scripts/python.exe' -m pytest backend/tests -q
```

完整后端已通过：318 passed、0 failed、0 skipped，耗时256.89秒（staged-phase6-backend-full.log）。覆盖新增真实 SQL 损坏版本只读拒绝及旧未绑定席位 claim 前后权限。独立 QUALITY 已通过：49 backend memory / 21 node，0 failed / 0 skipped，无阻塞问题。

## 外部限制

这是实际页面事件自动化及真实专用 MySQL 验收，不等同于微信真机、微信开发者工具或已部署服务验收。WX/真机/部署后双设备回放与视角检查待执行；联机解释/训练属于下一阶段。既有 Node MODULE_TYPELESS_PACKAGE_JSON、Starlette TestClient 与 Alembic path_separator 弃用警告保留（后端12 warnings），不跳过用例。本阶段不读取或修改密钥、不 push/merge/deploy。


实施计划已全部勾齐；没有遗留本代理临时编辑脚本，SQL prepare 脚本与真实测试日志保留。父代理负责 roadmap、独立审查记录及提交；本代理没有 commit 或修改这些父负责文件。
