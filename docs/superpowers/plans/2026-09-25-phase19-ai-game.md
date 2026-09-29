# PHASE 19 人机对战实施计划

**Goal:** 在现有微信游戏页接通真实人机对战，服务器验证身份、执行搜索并持久化全部回合。

**Architecture:** 后端为 AI 局持久化身份及 STANDARD 等级；独立 `AiGameController` 组织前端 Human/AI 回合，复用 API Client、Mapper 与 ChessBoard。

**Tech Stack:** TypeScript、微信小程序、FastAPI、SQLAlchemy/MySQL、Node Worker、Node test、pytest。

---

### Task 1: 后端 AI 身份和回合

- [ ] 先写创建/恢复 AI 局、错误回合、重复 AI 请求的失败 API 测试。
- [ ] 扩展 CreateGameRequest/GameResponse、StoredGame、MySQL 模型及迁移，保存 `ai_player` 与 `STANDARD`。
- [ ] 在 GameService 验证 Human/AI 回合，AI 配置只取后端设置。
- [ ] 运行 API 与 MySQL 测试，检查 bestMove、turn_number 和 SearchResult 持久化。

### Task 2: 前端 AI 回合控制器

- [ ] 先写 Human first、AI first、两轮交替、终局、网络超时同步、恢复和重复请求的失败测试。
- [ ] 扩展 game-api 类型和 AI 创建请求。
- [ ] 实现 `AiGameController`，服务端状态权威，AI thinking 锁定交互。
- [ ] 运行针对性测试。

### Task 3: 现有游戏页接入

- [ ] 先写页面交互失败测试，覆盖 AI 页棋盘、高亮、落子、thinking、重开和离开回调。
- [ ] 在现有 game.ts/WXML/WXSS 最小接入 AI 状态和先手选项；不改 ChessBoard。
- [ ] 运行页面测试、本地和远程回归。

### Task 4: 真实验证

- [ ] 运行 npm test、check、typecheck、完整 pytest。
- [ ] 用真实微信开发者工具运行 Human first 两轮和 AI first。
- [ ] SQL 核验 games/game_moves，包括 actor_type、连续 turn_number 和 AI SearchResult。
- [ ] 复核实现并按用户指定格式报告。
