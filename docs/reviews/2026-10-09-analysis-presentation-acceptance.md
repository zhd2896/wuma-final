# 局面分析展示调整验收记录

用户批准将内部评分改为面向玩家的局面判断、事实说明和可点击的走法建议。

## 已实现

- 对局页与独立分析页复用 evaluation-panel 和共享说明映射。
- 默认显示局面结论、最多三条事实原因、一条推荐和最多两条备选；不铺开评分和搜索数据。
- AI 模式使用你/AI，双人模式使用黑方/红方；已保存 AI 对局以服务器 human_player 判断称呼。
- 同分依据完整数值，四舍五入显示相同但原值不同的走法不标为相当。
- 点击走法只修改棋盘引导标记，不执行棋步，不修改状态或棋子。
- 详情明确区分当前棋盘评分与推荐路线搜索评分，展示分项、权重、完整精度计算提示和搜索信息，数值保留一位小数。
- 终局由棋规结果说明，风险和已验证的强制围堵分开表达；尚未完成搜索或达到时限时说明分析有限。
- 移除固定优势条。展示分档 150/400 仅作阅读提示，并在详情说明不代表经过校准的胜率。

## 验证

命令：`node --test tests/evaluation.test.mts tests/position-analysis.test.mts tests/ai-blockade.test.mts tests/analysis-view-model.test.mts tests/analysis-controller.test.mts tests/analysis-page.test.mts tests/ai-game-page.test.mts tests/ai-game-operations.test.mts`

结果：66 项通过，0 项失败。日志：`results/analysis-presentation-tests.log`。

`npm run typecheck`、`npm run check` 与 `git diff --check` 通过。审查提出的同分文案问题已修改，独立页两项测试和结构检查再次通过。

审查未发现重要问题。现有 Node 模块类型提示与 Git 换行提示不影响检查结果。

## 验证限制

本机微信开发者工具自动化端口 9420 未开启，连接返回 ECONNREFUSED，因此没有声称完成真实界面截图验收或真机验证。

保留工作区原有的引擎、后端和开发地址改动；未提交或发布本次改动。
