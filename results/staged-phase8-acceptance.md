# 阶段8：真实 AI 三档难度验收

基线：e0bfbf7，分支 codex/staged-completion。预算版本 ai_budget_v1；没有新棋规，没有新DDL，也不宣称人类棋力等级或必胜。

## 行为与预算

入门 BEGINNER：默认深度2、500ms；标准 STANDARD：默认深度4、1000ms；进阶 ADVANCED：默认深度6、2000ms。标准保留 Settings 正常配置；标准深度2..8/100..3000ms，入门标准整除2（深度1..4/50..1500ms），进阶标准加2/时间乘2（深度4..10/200..6000ms）。非整数、布尔、非正、空值回退4/1000；过大整数截断标准上限。每项预算同一配置严格递增。

每次对战搜索从保存的 Game.ai_level 读取；aiMove 严格空body，拒绝客户端覆盖。AI创建省略level默认STANDARD；LOCAL拒绝AI选项，REMOTE既有独立约束不变。保存现有列，get/恢复/个人历史返回真实level。

v1旧偏好缺defaultAiLevel默认STANDARD并保留其它字段。原生picker字符串index正确处理；改设置不改保存当前棋局，只影响首次/重开/AI先手下一局。当前顶部、玩家卡片和名称取真实快照。设备/云端历史显示实际档位；旧历史缺metadata保留无难度标签，不伪装档位。

局面分析、三级教练、复盘、训练保持独立Settings/ReviewConfig与保存scoringConfig。前端独立coach/replay接受全部AI档位。真实worker验证入门/进阶相同学习配置与训练评分标准。

## 红绿记录与检查

- `python -m pytest backend/tests/test_ai_levels.py -q`：初始7失败/2通过，新档位创建被422拒绝，预算模块未实现；`staged-phase8-backend-red.log`。
- `node --test tests/ai-levels.test.mts`：初始偏好、picker和实际Page难度行为失败；`staged-phase8-frontend-red.log`。后续顶部档位缺失断言真实失败：`staged-phase8-title-red.log`（同轮replay测试调用签名错误已修正，未据此声称实现缺陷）。
- Page 历史记录自审新增红测试：重开 ADVANCED 后设备记录错误读取上一局 BEGINNER；`staged-phase8-snapshot-history-red.log`。修复为显式传入本次保存 snapshot 的档位，最新5项聚焦全部通过，包含AI先手重开。
- 新API/既有API聚焦34通过，学习聚焦11通过；最新实际Page/原生picker/coach/replay/history聚焦5通过；零失败/零跳过。
- 专用MySQL三档SQL保存、personal history、重启app及真实worker budget：3通过，39 deselected，零失败/跳过；`staged-phase8-mysql-focus.log`。
- 最新增强版前端全量：`npm test` 519通过/零失败/零跳过；`npm run typecheck`、`npm run check` 均退出0，check验证11注册页面/18组件。日志 `staged-phase8-frontend-final.log` / `staged-phase8-typecheck.log` / `staged-phase8-check.log`。

聚焦后端实际命令使用 `& backend/.venv/Scripts/python.exe -m pytest backend/tests/test_ai_levels.py backend/tests/test_api.py -q`；学习聚焦使用 `& backend/.venv/Scripts/python.exe -m pytest backend/tests/test_ai_levels.py -q`。SQL 聚焦命令：

```powershell
& backend/.venv/Scripts/python.exe results/staged-phase8-mysql-prepare.py staged_phase8_20261006_final_test
$env:WUMA_TEST_DATABASE_URL='mysql+pymysql://root@127.0.0.1:34365/staged_features_test?charset=utf8mb4'
& backend/.venv/Scripts/python.exe -m pytest backend/tests/test_mysql_persistence.py -k ai_level_sql -q
```

## 隔离数据库与最终验收

`results/staged-phase8-mysql-prepare.py` 校验server UUID `79904ab3-c0d6-11f1-b2bb-088fc3774c8f` 与端口34365；新建此前不存在且为空的 `staged_phase8_20261006_final_test`（utf8mb4_unicode_ci），专供最终全量迁移测试。功能库 staged_features_test 检查0018_remote_training_owners；没有删除schema或操作业务库，没有关闭实例。

独立 SPEC 已 PASS（reviewer 内存后端48与 Node32+36，两组有重叠不相加）；独立 QUALITY 已 PASS（内存后端38、Node66与8类非法难度metadata拒绝，无阻断项）。详细记录见 [独立审查](../docs/reviews/2026-10-06-ai-levels-review.md)。设备AI终局历史“查看终局”按钮实际进入复盘的非阻断文案项，由父代理列入后续阶段9，本阶段不修改。

最终后端full命令：

```powershell
& backend/.venv/Scripts/python.exe results/staged-phase8-mysql-final-guard.py
$env:WUMA_TEST_DATABASE_URL='mysql+pymysql://root@127.0.0.1:34365/staged_features_test?charset=utf8mb4'
$env:WUMA_TEST_MIGRATION_DATABASE_URL='mysql+pymysql://root@127.0.0.1:34365/staged_phase8_20261006_final_test?charset=utf8mb4'
& backend/.venv/Scripts/python.exe -m pytest backend/tests -q
```

Final guard 再次验证 UUID/port、功能库head以及唯一迁移库仍为空并使用 utf8mb4_unicode_ci。最终全量结果：**371 passed，0 failed，0 skipped，退出码0，366.04秒**。包含真实 MySQL 持久化及从新空库迁移到head；日志 `staged-phase8-backend-full.log`。14条既有依赖弃用警告（Starlette/httpx 1条、Alembic配置13条），没有失败或跳过。

## FINAL DONE

阶段8生产接线、新增行为红绿、真实SQL聚焦与全量、前端519全量、typecheck/check以及独立SPEC/QUALITY均已通过。实施时 `git diff --check` 退出0，但该工作区检查未包含当时未跟踪的新增文件；父代理暂存后的检查发现新测试EOF空行及三份红日志行尾空白，已仅规范化空白并保留原红测内容。最终暂存区检查由父代理重新暂存后独立执行，不能用原工作区检查代替。SQL准备与final guard脚本、红绿/最终日志均保留；临时编辑脚本已清除。交回父代理进行阶段提交，本实施代理没有 commit/push/merge/deploy，没有启动阶段9。

## 实际限制

未执行真实微信开发者工具、真机或部署验证。既有Node模块类型提示与Starlette/httpx、Alembic弃用提示不属于测试失败。本阶段不修改规则、学习评分标准、业务数据库、密钥或后续阶段9业务功能。
