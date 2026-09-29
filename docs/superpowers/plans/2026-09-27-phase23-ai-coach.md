# PHASE 23 AI 教练实施计划

开发前基线：npm test 273/273；check、typecheck 通过；MySQL pytest 73/73；微信分析、复盘、无 Key 解释 E2E 均通过。数据库迁移为 0006。

1. 先写后端失败测试，覆盖三级信息裁剪、Provider 泄露拒绝、无 Key 回退、回合与版本、缓存和数据库只读。
2. 复用 Node Worker 的 PositionAnalysis，新增独立 CoachHintPolicy、提示词、grounding、回退和服务。只在 AI 人类回合提供，前后检查版本。
3. 增加 coach_hints 迁移和存储唯一约束；同版本同等级直接复用。
4. 先写 AI 页面控制器测试，再接入渐进式提示、忙碌锁、过期清理及 API 类型。
5. 增加无 Key 微信真实 E2E，验证三级隔离、棋局不变、手动落子及 AI 继续；运行全部旧测试和本阶段测试。
