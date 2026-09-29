# PHASE 24 训练系统实施计划

开发前真实基线：npm test 275/275；check、typecheck 通过；隔离 MySQL pytest 82/82（1 条第三方警告）；微信分析、复盘、无 Key 解释、Coach 四条 E2E 均通过；数据库迁移为 `0007_coach_hints`。

1. 先写后端失败测试：仅从已结束 GameReview 中的 MISTAKE/BLUNDER 生成、真实 `state_before`、公开 DTO 不泄露答案、重复生成、合法与非法答题、同分不同走法、重复网络请求和源棋局不变。
2. 建立 `training_items` 与 `training_records` 迁移、内部/公开 Schema、Store 的独立训练方法。生成时沿用 MoveReview 的最佳步、评分、完成深度与 Review 配置；题目以 source move review + 类型 + generation version 去重。
3. 答题先由 Node Worker 执行历史快照副本上的走法。再复用现有 `review_move` 的全根精确评分，固定到题目保存的已完成深度；仅当搜索完成且最佳评分与存储值一致时比较分数。合法尝试以 `client_attempt_id` 原子持久化；非法尝试不保存。
4. 添加生成、列表、详情、合法目标、答题 API。公开题目仅含局面及训练标签，答案只在成功答题结果中出现。
5. 改造现有微信训练页，复用 `chess-board`，实现列表、选题、目标高亮、提交、结果、重试与下一题。请求期间防双击；网络失败保留同一 `client_attempt_id` 供重试。
6. 新增自包含真实微信 E2E：合法终局 → Review → TrainingItems → 正确和次优答题 → TrainingRecords；验证答题前答案隐藏与源游戏不变。最后执行全部旧测试/E2E 与迁移检查。
