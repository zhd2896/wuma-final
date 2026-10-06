# 阶段四：真实六项棋力实施计划

> 按已批准设计顺序执行，采用 TDD；当前实现者不提交，父任务维护阶段进度并独立审查。

**Goal:** 当前微信账号使用真实 AI 对局、本人复盘及全部训练作答生成 `player_skill_v1` 六项指标与等级。

**Architecture:** 无迁移或计数缓存。纯 `player_skill.py` 校验证据及计算；内存与 SQL 分别聚合本人证据后调用同一计算器；严格 DTO 随 `/me/profile` 返回；小程序直接展示画像及完整门槛。

**Tech Stack:** Python/Pydantic/SQLAlchemy/MySQL 8、TypeScript/微信小程序、pytest/node:test。

- [x] 新建 `backend/tests/test_player_skill.py`，测试六项公式、非负半分向上、门槛、等级边界、异常证据；保存红结果后实现纯计算器，保存绿结果。
- [x] 新建共享证据验收及真实 MySQL 验收：两账号、人类 A/B、当前版本、排除其他模式/旧版本/空本人复盘、重复训练。先红后改两 store 聚合；固定数量 SQL 聚合查询，不逐行读取着法历史。
- [x] 新建严格个人资料 DTO 并接入 account API，验证缺漏字段及非法画像不能通过契约校验。
- [x] 扩展真实 profile page 测试，验证 0 分、部分达标、全达标、动态印章、完整局数/着数门槛、乱序请求与失败重试；先红后改 TypeScript/WXML/WXSS，移除演示样式。
- [x] 核验专用 MySQL UUID/端口；仅新建空 `_test` 库用于 fresh migration 全链验证。MySQL 全量测试只单进程串行运行；不删除数据库。
- [x] 运行前后端全量、typecheck/check、diffcheck，保存结果并记录中文验收。真实开发者工具不可用则明确报告而不声称已验证。
- [x] 通知父任务可 spec 审查；独立 spec/quality 均通过。质量反馈的 57.5 浮点抵消误差经两个业务红测复现，所有公式及综合改用 Fraction，并以多组整数比例 oracle 复验；修复后后端全量 277 项通过，前端 483 项通过，完成交付。

文件职责：`services/player_skill.py` 纯计算；`schemas/account.py` 契约；`game_store.py`/`mysql_store.py` 聚合；`account-api.ts` 强类型；`pages/profile/*` 展示；`tests/profile-page.test.mts` 与 `backend/tests/test*_player_skill.py` 验证。

测试命令：`backend/.venv/Scripts/python.exe -m pytest ...`、`node --test tests/profile-page.test.mts`，最终 `npm test`、`npm run typecheck`、`npm run check`。证据日志写 `results/staged-phase4-*`。
