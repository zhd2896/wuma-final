# 全方无合法走法判负实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 按用户确认的规则，在本手移动和吃子结算后换手，下一方所有在场棋子无合法走法时判该方负。

**Architecture:** 共用 RuleEngine 负责判定；新增 `ALL_PIECES_IMMOBILIZED` 表示多子全部被堵，保留既有孤棋与庙困终局。前后端合同、历史、复盘和中文提示同步接受新原因。后端存储使用现有字符串与 JSON 字段，无需数据库迁移。历史服务器快照不按新规则重写。

**Tech Stack:** TypeScript/Node 24 规则引擎、微信原生小程序、Python/FastAPI、MySQL。

**执行范围:** 用户已确认规则并要求立即实施，在当前 `codex/growth-feedback` 工作分支逐项执行；保留云端 API 配置和部署文档。此次不改变 AI 围堵策略、备用棋规则、重复局面规则，不自动部署云端。

## 1. 先证明缺失行为

- [x] 新增 `tests/player-immobilization.test.mts`，覆盖两子/三子被堵、主盘/庙区、双方对称、只有部分棋被堵不判负、吃子结算先于判负、备用不足保留敌棋、终局搜索不报错。
- [x] 修改 `tests/game-engine.test.mts` 中旧的“多子全堵继续”断言为终局断言。
- [x] 扩充 `tests/game-state-mapper.test.mts`、`backend/tests/test_api.py` 和 `backend/tests/test_mysql_persistence.py` 的终局参数，包括新原因。
- [x] 运行 `node --test tests/player-immobilization.test.mts tests/game-state-mapper.test.mts`，确认新规则未实现导致失败。

## 2. 实现与合同传播

- [x] 在 `miniprogram/domain/index.ts` 新增通用 `checkPlayerImmobilized`，仅检查当前行动方；非终局、在场棋不少于一枚、全部合法走法为零才判负。单子保留旧原因，多子返回 `ALL_PIECES_IMMOBILIZED`。`executeTurn` 换手后调用新判定。
- [x] 将新原因加入 `backend/app/schemas/game.py`、`miniprogram/services/{online-api,replay-contract,device-history}.ts` 的终局合同。
- [x] 更新 `miniprogram/pages/game/game-state-mapper.ts`、`miniprogram/services/feedback-presentation.ts`、`backend/app/services/review_explanation/fallback.py` 的中文终局解释。
- [x] 更新搜索中旧规则歧义注释；保留针对直接构造、未经换手判定的矛盾 PLAYING 输入的防御检查。正常 executeTurn 的多子堵塞必须得到终局，搜索后继不再抛规则歧义。
- [x] 更新旧的搜索后继歧义测试为真实多子堵塞终局/获胜评分测试。补充本地存档、云端/联机合同和复盘验收。
- [x] 在玩法讲解页增加显式胜负规则：无论剩几枚，轮到己方时全部无合法走法即判负；还有任何合法走法就继续。

## 3. 验证与记录

- [x] 跑前端全量 `npm test`、`npm run typecheck`、`npm run check` 和 `git diff --check`。
- [x] 跑后端测试；若可启动隔离 MySQL，则对新增终局落库、历史、复盘和后续落子拒绝做真实数据库验收，不写用户业务库。
- [x] 审查新增终局从共享引擎到本地、AI 和联机页面的传递，记录实际通过数量、跳过项、云端部署和真实设备验收状态。

## 审查补充

- [x] 独立分析页新增终局原因中文显示。
- [x] 兼容旧规则保存的“多子全堵但仍 PLAYING”历史：只允许新终局与旧记录之间的胜负字段差异，其余棋盘、备用、行棋方必须完全一致；原棋谱和认输结果不改写，复盘明确使用现行规则评价。
- [x] 用真实 MySQL 验证 LOCAL、AI 自动应手和 REMOTE 的新终局落库、个人历史、复盘、幂等重试与双方读取。
- [x] 训练回归按源复盘的分类、来源手数和实际搜索深度核对，取消旧规则下的固定题数、固定深度假设。

结果与实机验收门槛见 [阶段验收记录](../../reviews/2026-10-08-all-pieces-immobilized-acceptance.md)。

**验收局面:** 黑方占 P27/P28/P08/P05/P10/P15/P20/P25，红方占 P26/P29；黑方 P08→P03 后应换到红方、红方合法走法为零、黑方获胜、`ALL_PIECES_IMMOBILIZED`，后续不能再落子。
