# AI 围堵与讲解实施计划

**Goal:** 修复真实棋谱中的庙内孤棋循环，统一 AI、分析、教练、终局提示和复盘。

**Architecture:** 共享合法棋步驱动短程证明，作为 Minimax/Alpha-Beta 叶节点延伸；围堵评分仅为启发式。新增威胁沿用已有分析与复盘传输结构，旧评分兼容默认值。

**Tech Stack:** TypeScript、Node test、微信小程序、Python/FastAPI。

依据：[设计](../specs/2026-10-08-ai-blockade-design.md)。按用户授权在当前目录执行，不改已有云端配置，不自动部署或提交。

## 1. 回归与实现

- [x] 新增 `tests/ai-blockade.test.mts`：实际第 35 手局面、入门/标准/进阶、完整路线、逃逸反例、双方对称、零预算和输入不变。先运行 `node --test tests/ai-blockade.test.mts` 并记录预期失败。
- [x] 新增 `miniprogram/ai/blockade.ts`，使用 `RuleEngine.executeTurn` 枚举孤棋所有应手，并用真实终局验证回复；不能把一个合作分支当作强制获胜。返回完整证据或 null。
- [x] `miniprogram/ai/{minimax,alpha-beta}.ts` 叶节点应用相同的有限延伸、真实 mate distance 及超时检查，正常迭代保留最后完整层。
- [x] `miniprogram/ai/evaluation.ts` 新增兼容的围堵评分项，计算静止对手时孤棋可达空区域；该数值不作为胜负判定。
- [x] 运行新测试及 `tests/{evaluation,alpha-beta,iterative-deepening,move-ordering,transposition-table,review-analysis}.test.mts`，核对搜索一致性、完整候选及训练评分深度。

## 2. 讲解传播

- [x] `miniprogram/ai/position-analysis.ts` 新增强制围堵威胁，仅标注验证通过的推荐路线，枚举全部合法应手，附真实终局原因与最多棋步。
- [x] `backend/app/schemas/game.py` 新增威胁枚举及旧评分项默认值；`miniprogram/pages/analysis/analysis-view-model.ts` 中文解释与关键棋子。
- [x] `miniprogram/ai/review-analysis.ts`、`miniprogram/services/feedback-presentation.ts`、`backend/app/services/review_explanation/fallback.py` 讲解有效围堵与错失机会，不误报即时终局。
- [x] `backend/app/services/coach/{policy,fallback,grounding}.py` 接通新证据且保持三级泄露限制；`backend/tests/test_ai_blockade.py` 验证真实 worker 的 AI、分析、教练、复盘与只读状态。
- [x] `miniprogram/guide/pages/rules/rules.wxml` 增加封口示例；`miniprogram/pages/game/game-state-mapper.ts` 明确换手后无合法走法的终局指导语。

## 3. 验收记录

- [x] 前端全量（测试源码快照保留 HEAD 本机测试地址）、`npm run typecheck`、`npm run check`、`git diff --check`。
- [x] 后端专项及与评分/讲解相关的训练、教练、分析、复盘回归；只根据具体风险扩大测试。
- [x] 独立代码审查与复查；记录实际棋谱闭环验证、预算与未完成的云端/实机验收。
