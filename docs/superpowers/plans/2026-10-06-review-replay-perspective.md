# 第六阶段复盘回放与视角 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. 本实施代理独立执行，父代理负责 SPEC、QUALITY 和提交。

**Goal:** 在真实复盘页面展示有效棋谱的保存局面，并让普通 LOCAL 所有者选择 A/B 的统计、解释和训练视角。

**Architecture:** 复用 read_replay 和 _validated_replay，新增严格的 Replay DTO 与普通/房间只读接口。页面以独立回放状态映射控制步骤，保留走前路线对照；请求代次保护加载、解释和训练。训练生成与仓储列表按真实 player 筛选。

**Tech Stack:** FastAPI/Pydantic、内存/MySQL repository、原生微信小程序 TypeScript/WXML、pytest、node:test。

## Task 1 — 保存棋谱只读接口
- [x] 写 backend/tests/test_replay.py：owner/auth/stranger、REMOTE 席位 token/account、有效 undo 分支、自然终局、零手认输、旧快照不调用 execute_turn、完整 capture/reserve 与版本。
- [x] 运行 `backend/.venv/Scripts/python.exe -m pytest backend/tests/test_replay.py -q`，记录 404 的预期红灯。
- [x] schemas/game.py 添加 GameReplay(game_id,version,ply_count,initial_state,steps)，步骤含 kind/ply/game_move_id/player/move/capture/state；MOVE 保存 created_revision，RESIGN 独立终局。
- [x] game_service.py 受控 `_get_replay(remote=False)`；game.py owner 接口；remote_service.py 前后鉴权，remote.py 房间接口。
- [x] 同命令绿灯，保留日志 results/staged-phase6-backend-*.log。

## Task 2 — 训练视角一致性
- [x] 写生成 legacy mixed review/返旧双方记录过滤、memory/MySQL list player+total+pagination 行为测试，先运行看到不符预期。
- [x] training_service.py 来源及返回均限定 review.reviewedPlayer；game_store.py、mysql_store.py、training_repository.py 的 list 增加 player，training.py 严格 Player query。
- [x] 同测试绿灯，SQL 仅经 UUID 核验的 34365 专用实例，不修改 schema。

## Task 3 — 页面回放与视角
- [x] 写 tests/review-replay.test.mts：真实 Page 请求、安全元数据、前后首尾跳转、实际走后与走前对照、空认输终局、LOCAL/AI/REMOTE 视角权限、参数、迟到请求与 hide/unload。
- [x] 写 training filters/generate API 与真实训练 Page 筛选、分页、清理测试；运行 `node --test tests/review-replay.test.mts tests/training-perspective.test.mts` 记录红灯。
- [x] api-contract.ts + game-api.ts/online-api.ts 严格 Replay 返回校验；review-replay.ts 纯映射；review.ts generation/生命周期与服务器 LOCAL/AI 元数据、视角、安全请求上下文。
- [x] review.wxml/wxss 加实际回放棋盘、前后首尾、slider、A/B selector，明确走前路线对照；check.cjs 允许原生 slider。训练 API/Page/controller 保留 player，改来源清理。
- [x] 更新已有真实 Page fixtures 适应必要 game/replay 请求；同 focused tests + typecheck/check 绿灯后通知父开始 SPEC。

## Task 4 — 验收与独立审查
- [x] dedicated MySQL UUID 与 auto.cnf 核验，创建唯一空 *_test migration 库，运行全 backend suite，保留 prepare 脚本与日志。
- [x] `npm test`、`npm run typecheck`、`npm run check` 全量各一次；真实失败或变更后才重跑必要范围。
- [x] 修复父 SPEC/QUALITY 发现的真实问题，先补红灯 regression，再绿灯。
- [x] 中文验收 results/staged-phase6-acceptance.md：命令、计数/no skip、权限与读取不变、限制及 WX/真机/部署待验；本计划勾齐，临时编辑脚本清理、`git diff --check`。不提交、不改 staged roadmap。


最终验收：前端507 passed / 后端318 passed，均0 skip；typecheck、check、diff --check PASS。独立SPEC与QUALITY通过；详细命令、红绿证据、专用MySQL及外部待验见 results/staged-phase6-acceptance.md。
