# 阶段9：个人资料、发布配置与最终权限验证

> 按已批准的 profile-release 设计在当前会话执行；父代理负责两轮审查与提交，本实施者不发布、不提交。

**目标：** 持久化主动设置的昵称和内置棋子头像，安全处理未开放环境，补齐普通棋局写入的最终账号授权，并收口真实展示与部署文档。

**架构：** 复用严格 account DTO、个人页 generation 和现有 store 事务。公开地址使用独立的原生兼容校验函数；构建脚本只配置公开地址。最终写入按 User → Game → Review 锁序验证活跃 actor 和归属，专用 REMOTE 流程保持独立。

**技术：** TypeScript 原生小程序、Node test、FastAPI/Pydantic、SQLAlchemy/MySQL、Alembic。

## 执行与验证

- [x] 资料契约：新增 `backend/tests/test_profile_edit.py`，以 HTTP POST 保存、非法输入、重登和合并优先级红测；在 `schemas/account.py`、`api/v1/account.py`、memory/SQL stores 与 `0019_user_profiles.py` 实现严格资料和迁移。运行该文件至全绿。
- [x] 最终授权：新增 `backend/tests/test_ordinary_actor_races.py`，在真实 engine 返回与 commit 之间合并账号，断言 AUTH_INVALID 且版本/棋谱不变；复盘、解释、教练和操作用同样可复现边界。API 将 `require_game_owner` 返回值传入 service/store；缓存返回也再次验证。SQL 先锁 User 再 Game/Review。运行新红测至绿并追加 MySQL 行为/锁序验证。
- [x] 资料页面：在 `account-api.ts` 与 `profile.ts/wxml/wxss` 增加严格 avatar DTO、编辑/取消/保存；失败保留草稿；hide/unload/logout、token/root/account 切换废弃异步结果。真实 Page 测试覆盖草稿、保存、失败与切换。
- [x] 发布配置：新增原生兼容 URL 校验、公开配置构建脚本和 `check:release`；trial/release 空配置保持待部署，现有 AppID 保留。非法配置在入口/login/client 层安全回登录并显示服务暂未开放；不发登录/网络请求。红测覆盖 URL 矩阵、前缀、安全错误和实际页面。
- [x] 展示收口：清理 demo 状态与不可达提示；LOCAL 提示打开真实 analysis route，AI 保留三级教练；设备 AI 历史显示查看复盘。更新 README、历史缺口快照、中文微信发布指南。
- [x] SQL 迁移：先核对 dedicated instance UUID/port；仅创建全新唯一 `_test` 空库，升级 head，验证旧默认/保存/重登/合并与 downgrade 保护。单进程独占 SQL。
- [x] 独立审查：SPEC PASS（memory24/Node15）、QUALITY PASS（backend50/Node38），见 `docs/reviews/2026-10-06-profile-release-review.md`。
- [x] 审查后前端最终验证：`npm test` 527通过、零失败零跳过；`npm run typecheck`、`npm run check` 均通过。此次只修复SQL复盘测试替身的actor/token参数兼容，前端源代码未变化。
- [x] 最终验收：源代码审查稳定后前端527项、backend411项全量通过，零失败零跳过；typecheck/check通过。后端使用新 `staged_phase9_finish_full_20261006_test` 与另一新 empty `staged_phase9_finish_empty_20261006_test`，单进程全量exit0；复盘SQL测试替身actor/token参数兼容完成红→绿，第二条外键失败及两表整体回滚断言保持。数据库只读收尾通过，SQL已释放父代理。日志见 `results/staged-phase9-acceptance.md`。
- [x] 对所有新增及修改文件扫描尾空白，100个文件检查尾空白0、`git diff --check` exit0。交付父代理 SPEC → QUALITY 审查及全分支最终检查；不声称已部署或微信真机验收。
