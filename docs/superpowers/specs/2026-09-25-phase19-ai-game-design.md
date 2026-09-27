# PHASE 19 人机对战设计

## 范围与现状

沿用 `pages/game/game` 与 `chess-board`。当前 AI 页仍是演示；`/ai-move` 已调用 Phase 15 搜索并保存 TurnResult，但尚未区分 AI 局、棋手身份与回合。`games` 已有 `mode`、`ai_level`，缺少 `ai_player`。

## 契约

`POST /api/v1/game` 支持 `mode=AI`、`first_player=A|B`、`ai_player=A|B`、`ai_level=STANDARD`。AI 局返回 `mode`、`human_player`、`ai_player`、`ai_level`，GET 同样返回这些字段。LOCAL 局继续支持原请求。数据库迁移为 `games` 增加可空 `ai_player`，旧 LOCAL 记录无需改写。人类是 `ai_player` 的对方，身份由持久化元数据恢复。

`/move` 对 AI 局只允许人类回合；`/ai-move` 只允许 AI 局且当前轮到 AI。重复或并发请求由回合检查与数据库版本比较阻止。AI 等级仅 `STANDARD`，配置由后端控制：默认 `max_depth=4`、`time_limit_ms=1000`，使用已有 Iterative Deepening、Alpha-Beta、Move Ordering、TT。客户端不能调整搜索预算。

## 页面流程

新建及恢复均读取服务端 GameResponse。当前轮到 AI 时自动调用一次 `/ai-move`；Human Move 成功且未终局时自动进入 AI thinking。仅服务端返回的 TurnResult 更新棋盘、备用棋、胜负与最后一步。AI thinking 锁定棋盘和重新开始，仍允许离开页面。恢复时根据服务端 current_player 决定是否继续 AI，绝不依赖页面上次内存状态。

HTTP 失败，尤其是可能已提交的请求超时，先 GET 同步后决定是否继续。若 GET 失败，显示错误并锁定交互；重试先同步。`SearchResult.timedOut` 是正常搜索结果，不等同网络错误。无伪造思考进度或胜率。

## 验证

后端覆盖身份、回合拒绝、合法 AI Move、持久化与重复请求；前端覆盖 Human first、AI first、自动续走、锁定、终局、捕获、恢复和超时同步。开发者工具真实验证两轮 Human→AI，以及 AI 先手，并核查 MySQL 游戏与走棋记录。
