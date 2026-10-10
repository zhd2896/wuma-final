# 局面分析行动解释验收记录

## 已实现

用户批准的三项体验改进已接入两处分析入口：

1. 推荐和最多两条备选显示这一步的目的。说明由棋规实际执行与既有证明生成：吃子是否生效、是否直接获胜、孤棋走后有多少合法走法、封锁压力是否增加、对手下一手可捕获目标是否减少。备用棋不足时明确吃子不会生效；缺少具体证据时说明战术目的未确认。保证多手获胜的文字仅用于有匹配证明的路线。
2. 点击推荐或备选在 setData 完成后滚动到棋盘，显示正在预览的路线与目的。独立分析页在三个页签间共享一个棋盘，清除时移除路线；对局页清除时恢复正常棋盘（包括原有上一手标记），棋局状态更新会清除预览状态。预览不执行棋步，不改变棋子、备用子、回合或服务器状态。
3. 普通局面标题与原因均对应当前静态局面。已完成搜索产生不同分档时另显“后续走势参考”；不根据搜索总分虚构变化路线。已验证的一步获胜、强制围堵和棋规终局使用对应依据标签。终局原因在各页签都明确真实败方。

## 验证

`node --test tests/evaluation.test.mts tests/position-analysis.test.mts tests/ai-blockade.test.mts tests/analysis-view-model.test.mts tests/analysis-controller.test.mts tests/analysis-page.test.mts tests/ai-game-page.test.mts tests/ai-game-operations.test.mts`

结果：71 项通过，0 项失败。日志：`results/analysis-guidance-tests.log`。

类型检查 `npm run typecheck`、结构检查 `npm run check` 和 `git diff --check` 通过。审查后统一终局文案，独立分析页两项测试和结构检查再次通过。

独立审查未发现重要问题，相关四个测试文件另行验证 24 项通过。没有进行实际微信渲染或真机验收，不将自动化函数级验证表述为真实界面验收。

未提交或发布。所有此前的评分引擎、后端和开发地址改动均保留。
