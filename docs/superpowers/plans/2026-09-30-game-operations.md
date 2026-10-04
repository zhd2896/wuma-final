# 对局操作、远程悔棋与真实终局实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让本地双人、AI 对弈和真正远程双人都具备真实悔棋、认输终局与持久化设置，并保证历史、复盘、重连和重复请求的数据一致性。

**Architecture:** 服务端继续保存权威棋局快照，将 `version` 改为单调递增的状态修订号并新增 `ply_count`；棋步通过撤销修订号保留审计记录。普通/AI 悔棋、远程悔棋申请和认输分别写入幂等事件表。小程序用控制器接收权威结果，本地双人仅保存一个可撤销局面帧，共用设置通过独立本机存储模块和展示组件接入两个对局页面。

**Tech Stack:** 微信原生小程序、TypeScript 5.9、Node.js test runner、FastAPI、Pydantic 2、SQLAlchemy 2、Alembic、MySQL、pytest。

---

## 执行前准备

- 使用 `superpowers:using-git-worktrees` 创建或复用隔离工作区，分支名使用 `codex/game-operations`。
- 以包含本实施计划的主分支最新提交为起点；设计补充提交为 `504ae71`。不要带入 `.worktrees/player-skill` 的未合并实现。
- 不修改或提交工作区中已有的 `弈智五马项目策划书.docx` 状态。
- 每个任务通过其局部测试后再提交；最终任务运行完整测试和真实 MySQL 验证。

### Task 1: 扩展终局原因和状态展示契约

**Files:**
- Modify: `miniprogram/domain/index.ts:104`
- Modify: `miniprogram/pages/game/game-state-mapper.ts:22`
- Modify: `miniprogram/services/device-history.ts:46`
- Modify: `backend/app/schemas/game.py:11`
- Modify: `backend/app/services/review_explanation/fallback.py:13`
- Test: `tests/game-state-mapper.test.mts`
- Test: `tests/device-history.test.mts`
- Test: `backend/tests/test_review.py`

- [ ] **Step 1: 写出失败测试，固定 `RESIGN` 的类型、文案和历史兼容行为**

```ts
test('RESIGN maps to a real terminal message and survives device history', () => {
  const resigned = { ...RuleEngine.initializeGame({ firstPlayer: 'A' }),
    game_status: 'FINISHED' as const, winner: 'B' as const,
    winner_reason: 'RESIGN' as const };
  assert.equal(mapGameStateToView(resigned).winnerMessage, '对方已认输');
  const store = createDeviceHistoryStore(memoryStorage());
  store.record({ id: 'local-resign', mode: 'local', state: resigned, turns: 0 });
  assert.equal(store.get('local-resign')?.winnerReason, 'RESIGN');
});
```

- [ ] **Step 2: 运行测试并确认当前因未知终局原因失败**

Run: `node --test tests/game-state-mapper.test.mts tests/device-history.test.mts`

Expected: FAIL，`RESIGN` 不能赋给 `WinnerReason` 或历史校验拒绝该记录。

- [ ] **Step 3: 在前后端统一加入终局原因及中文说明**

```ts
export type WinnerReason =
  | 'CAPTURE_ALL'
  | 'TEMPLE_TRAP'
  | 'LONE_PIECE_IMMOBILIZED'
  | 'RESIGN';

const reasonMessages: Readonly<Record<NonNullable<GameState['winner_reason']>, string>> = {
  CAPTURE_ALL: '对方棋子已全部被吃',
  TEMPLE_TRAP: '对方孤棋被困于庙宇',
  LONE_PIECE_IMMOBILIZED: '对方孤棋无路可走',
  RESIGN: '对方已认输',
};
```

Python 契约改为：

```python
WinnerReason = Literal["CAPTURE_ALL", "TEMPLE_TRAP",
                       "LONE_PIECE_IMMOBILIZED", "RESIGN"]
```

同时让设备历史校验器接受 `RESIGN`，并在复盘降级讲解映射中加入 `"RESIGN": "对方认输"`。

- [ ] **Step 4: 运行局部测试和类型检查**

Run: `node --test tests/game-state-mapper.test.mts tests/device-history.test.mts`

Run: `python -m pytest backend/tests/test_review.py -q`

Run: `npm run typecheck`

Expected: 全部 PASS。

- [ ] **Step 5: 提交终局契约**

```bash
git add miniprogram/domain/index.ts miniprogram/pages/game/game-state-mapper.ts miniprogram/services/device-history.ts backend/app/schemas/game.py backend/app/services/review_explanation/fallback.py tests/game-state-mapper.test.mts tests/device-history.test.mts backend/tests/test_review.py
git commit -m "feat: add resignation terminal reason"
```

### Task 2: 增加状态修订号、有效步数和操作事件表

**Files:**
- Create: `backend/alembic/versions/0011_game_operations.py`
- Modify: `backend/app/db/models.py`
- Modify: `backend/app/services/game_store.py`
- Test: `backend/tests/test_mysql_persistence.py`

- [ ] **Step 1: 写出失败的持久化测试，固定迁移后的数据形态**

```python
def test_game_operation_schema_tracks_revision_and_active_plies(client, db):
    game_id = create_game(client, mode="AI")
    play_one_turn(client, game_id)
    with db() as session:
        game = session.get(GameModel, game_id)
        move = session.query(GameMoveModel).filter_by(game_id=game_id).one()
        assert game.version == 1
        assert game.ply_count == 1
        assert move.created_revision == 1
        assert move.reverted_revision is None
```

再增加模型约束断言：`GameUndoEventModel`、`GameTerminalEventModel`、`RemoteUndoRequestModel` 存在，请求号唯一，原 `(game_id, turn_number)` 唯一约束已经移除。

- [ ] **Step 2: 在隔离测试数据库升级迁移并确认测试失败**

Run: `if (-not $env:WUMA_TEST_DATABASE_URL) { throw 'Set WUMA_TEST_DATABASE_URL to a MySQL database whose name ends with _test' }`

Run: `$env:DATABASE_URL = $env:WUMA_TEST_DATABASE_URL`

Run: `python -m alembic -c backend/alembic.ini upgrade head`

Run: `python -m pytest backend/tests/test_mysql_persistence.py -q`

Expected: FAIL，模型尚无 `ply_count`、修订字段和操作事件表。

- [ ] **Step 3: 编写 `0011_game_operations` 迁移**

迁移按以下顺序执行，避免旧数据暂时违反非空约束：

```python
op.add_column("games", sa.Column("ply_count", sa.Integer(), nullable=True))
op.execute("UPDATE games SET ply_count = version")
op.alter_column("games", "ply_count", existing_type=sa.Integer(), nullable=False)

op.add_column("game_moves", sa.Column("created_revision", sa.Integer(), nullable=True))
op.add_column("game_moves", sa.Column("reverted_revision", sa.Integer(), nullable=True))
op.execute("UPDATE game_moves SET created_revision = turn_number")
op.alter_column("game_moves", "created_revision", existing_type=sa.Integer(), nullable=False)
op.drop_constraint("uq_game_moves_game_turn", "game_moves", type_="unique")
op.create_unique_constraint("uq_game_moves_game_revision", "game_moves",
                            ["game_id", "created_revision"])
op.create_index("ix_game_moves_active_turn", "game_moves",
                ["game_id", "reverted_revision", "turn_number"])
```

同一迁移创建：

```text
game_undo_events(id, game_id, client_request_id, requester,
                 before_revision, after_revision, anchor_turn,
                 reverted_count, state_after, created_at)
game_terminal_events(id, game_id, client_request_id, revision,
                     event_type, actor, winner, state_before,
                     state_after, created_at)
remote_undo_requests(id, game_id, requester, responder,
                     create_client_request_id, resolve_client_request_id,
                     base_revision, anchor_turn, status,
                     created_at, resolved_at)
```

为普通悔棋、终局和远程创建请求分别增加 `(game_id, client_request_id)` 唯一约束；远程处理请求号使用可空唯一约束。

- [ ] **Step 4: 更新 SQLAlchemy 模型和内存存储数据类型**

```python
@dataclass(frozen=True)
class StoredGame:
    game_id: str
    initial_state: GameState
    state: GameState
    version: int
    ply_count: int = 0
    mode: str = "LOCAL"
    ai_player: str | None = None
    ai_level: str | None = None
    user_id: str | None = None

@dataclass(frozen=True)
class StoredMove:
    turn_number: int
    actor_type: str
    turn: TurnResult
    search: SearchResult | None
    game_move_id: int = 0
    created_revision: int = 0
    reverted_revision: int | None = None
    client_request_id: str | None = None
```

所有创建棋局路径初始化 `ply_count=0`；普通落子写 `turn_number=ply_count+1`、`created_revision=version+1`，同时递增两个字段。

- [ ] **Step 5: 运行迁移、持久化测试和 API 回归测试**

Run: `$env:DATABASE_URL = $env:WUMA_TEST_DATABASE_URL`

Run: `python -m alembic -c backend/alembic.ini upgrade head`

Run: `python -m pytest backend/tests/test_mysql_persistence.py backend/tests/test_api.py -q`

Expected: 全部 PASS；没有配置 `TEST_DATABASE_URL` 时 MySQL 用例允许明确 SKIP，但在最终验收前必须用真实隔离库重跑。

- [ ] **Step 6: 提交数据模型**

```bash
git add backend/alembic/versions/0011_game_operations.py backend/app/db/models.py backend/app/services/game_store.py backend/tests/test_mysql_persistence.py
git commit -m "feat: add revisioned game operation storage"
```

### Task 3: 让有效棋步与复盘脱离状态版本号

**Files:**
- Modify: `backend/app/db/repositories/game.py`
- Modify: `backend/app/db/repositories/move.py`
- Modify: `backend/app/db/repositories/mysql_store.py`
- Modify: `backend/app/services/game_store.py`
- Modify: `backend/app/services/game_service.py`
- Modify: `backend/app/schemas/game.py`
- Test: `backend/tests/test_api.py`
- Test: `backend/tests/test_review.py`
- Test: `backend/tests/test_mysql_persistence.py`

- [ ] **Step 1: 写失败测试，证明版本号可以大于有效棋步数**

```python
def test_replay_uses_active_plies_instead_of_revision(client, seeded_reverted_game):
    response = client.get(f"/api/v1/game/{seeded_reverted_game}/review")
    assert response.status_code == 200
    snapshot = client.get(f"/api/v1/game/{seeded_reverted_game}").json()["data"]
    assert snapshot["version"] == 4
    assert snapshot["ply_count"] == 2
```

- [ ] **Step 2: 运行测试并确认旧断言 `len(moves) == version` 失败**

Run: `python -m pytest backend/tests/test_api.py backend/tests/test_review.py -q`

Expected: FAIL，响应缺少 `ply_count` 或复盘把状态修订数当棋步数。

- [ ] **Step 3: 修改存储读取和响应契约**

```python
class GameResponse(StrictModel):
    game_id: str
    version: int
    ply_count: int
    state: GameState
    mode: Literal["LOCAL", "AI"]
    human_player: Player | None
    ai_player: Player | None
    ai_level: Literal["STANDARD"] | None
```

`list_moves` 和 `read_replay` 只返回 `reverted_revision IS NULL` 的棋步并按 `turn_number` 排序。复盘校验改为：

```python
if len(moves) != snapshot.ply_count:
    raise ApiError("GAME_HISTORY_CORRUPT", "Active move count does not match game")
for expected_turn, item in enumerate(moves, start=1):
    if item.turn_number != expected_turn or item.turn.before_state != frames[-1]:
        raise ApiError("GAME_HISTORY_CORRUPT", "Active move chain is invalid")
```

如果棋局因认输结束，最后一手的 `state_after` 可以仍为 `PLAYING`；最终胜负从权威快照和终局事件读取，不再要求最后棋步状态等于终局快照。

- [ ] **Step 4: 修正个人历史中的手数来源**

`personal_games()` 返回 `turns=game.ply_count`，不再返回 `game.version`。普通、AI 和远程落子的返回版本使用新状态修订号，棋步号继续使用有效步数。

- [ ] **Step 5: 运行复盘、账户和持久化测试**

Run: `python -m pytest backend/tests/test_api.py backend/tests/test_review.py backend/tests/test_accounts.py backend/tests/test_mysql_persistence.py -q`

Expected: 全部 PASS。

- [ ] **Step 6: 提交有效棋谱读取改造**

```bash
git add backend/app/db/repositories/game.py backend/app/db/repositories/move.py backend/app/db/repositories/mysql_store.py backend/app/services/game_store.py backend/app/services/game_service.py backend/app/schemas/game.py backend/tests/test_api.py backend/tests/test_review.py backend/tests/test_mysql_persistence.py
git commit -m "refactor: separate game revision from active plies"
```

### Task 4: 实现普通和 AI 棋局的幂等悔棋、认输接口

**Files:**
- Modify: `backend/app/schemas/game.py`
- Modify: `backend/app/services/game_store.py`
- Modify: `backend/app/services/game_service.py`
- Modify: `backend/app/api/v1/game.py`
- Test: `backend/tests/test_game_operations.py`

- [ ] **Step 1: 新建失败的服务测试**

覆盖以下案例：AI 已应手撤销 2 手、AI 尚未应手撤销 1 手、AI 先手但玩家未落子、本地服务棋局撤销最后 1 手、过时版本、相同请求重试、同请求号不同参数、认输和终局后拒绝操作。

```python
def test_ai_undo_reverts_from_latest_human_move(client):
    game_id = create_ai_game(client)
    play_human_and_ai(client, game_id)
    before = get_game(client, game_id)
    result = client.post(f"/api/v1/game/{game_id}/undo", json={
        "expected_version": before["version"],
        "client_request_id": "undo-ai-0001",
    }).json()["data"]
    assert result["reverted_turns"] == 2
    assert result["ply_count"] == before["ply_count"] - 2
    assert result["version"] == before["version"] + 1
```

- [ ] **Step 2: 运行新测试并确认接口不存在**

Run: `python -m pytest backend/tests/test_game_operations.py -q`

Expected: FAIL，`/undo` 和 `/resign` 返回 404。

- [ ] **Step 3: 定义操作请求和响应**

```python
ClientRequestId = Annotated[str, StringConstraints(
    min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]

class GameOperationRequest(StrictModel):
    expected_version: int = Field(ge=0)
    client_request_id: ClientRequestId

class GameOperationResponse(StrictModel):
    version: int
    ply_count: int
    state: GameState
    reverted_turns: int = 0
```

增加路由：

```python
@router.post("/{game_id}/undo", response_model=ApiResponse[GameOperationResponse])
async def undo(request: Request, game_id: str, body: GameOperationRequest):
    await require_game_owner(request, game_id)
    return ApiResponse(data=await request.app.state.service.undo(game_id, body))

@router.post("/{game_id}/resign", response_model=ApiResponse[GameOperationResponse])
async def resign(request: Request, game_id: str, body: GameOperationRequest):
    await require_game_owner(request, game_id)
    return ApiResponse(data=await request.app.state.service.resign(game_id, body))
```

- [ ] **Step 4: 在内存存储实现原子操作和幂等返回**

`commit_undo` 在锁内完成：检查请求事件、校验版本和 `PLAYING`、寻找锚点、将锚点及之后的有效棋步标记为当前新修订、恢复 `before_state`、更新 `version+1` 和锚点前的 `ply_count`、写 `game_undo_events`。AI 锚点是最新 `actor_type == "HUMAN"`，兼容 `LOCAL` 服务棋局锚点是最后有效棋步。

`commit_resign` 在锁内完成：根据 AI 人类方或当前行动方确定认输者，生成：

```python
finished = snapshot.state.model_copy(update={
    "game_status": "FINISHED",
    "winner": "B" if loser == "A" else "A",
    "winner_reason": "RESIGN",
})
```

随后递增 `version`、保持 `ply_count`、写 `game_terminal_events`。重复请求读取原事件；棋局已自然结束或被另一个请求结束时返回 `GAME_ALREADY_FINISHED`。

- [ ] **Step 5: 让分析提交同时校验版本和对局状态**

内存与 MySQL 的 `commit_analysis` 都要求版本仍相同且状态仍为 `PLAYING`，防止认输期间完成的旧分析写入。

- [ ] **Step 6: 运行接口测试**

Run: `python -m pytest backend/tests/test_game_operations.py backend/tests/test_api.py backend/tests/test_coach.py -q`

Expected: 全部 PASS。

- [ ] **Step 7: 提交普通/AI 操作接口**

```bash
git add backend/app/schemas/game.py backend/app/services/game_store.py backend/app/services/game_service.py backend/app/api/v1/game.py backend/tests/test_game_operations.py backend/tests/test_api.py backend/tests/test_coach.py
git commit -m "feat: add idempotent undo and resign endpoints"
```

### Task 5: 实现远程悔棋申请、处理和认输服务

**Files:**
- Modify: `backend/app/schemas/remote.py`
- Modify: `backend/app/services/game_store.py`
- Modify: `backend/app/services/remote_service.py`
- Modify: `backend/app/api/v1/remote.py`
- Test: `backend/tests/test_remote.py`

- [ ] **Step 1: 写失败测试覆盖远程完整状态机**

新增测试：申请者无棋步、申请后冻结落子、同意回退 1 手、对方回应后同意回退 2 手、拒绝保持版本、只有对方能处理、同时申请、创建/处理重试、旧申请失效、待申请期间任一方认输、终局后禁止操作、重连读取待申请。

```python
def test_remote_accept_undo_uses_requesters_latest_move(client):
    game_id, a, b = playing_room(client)
    move_a(client, game_id, a, "P01", "P02", version=0)
    request = client.post(f"/api/v1/remote/rooms/{game_id}/undo-requests",
        headers=a, json={"expected_version": 1,
                         "client_request_id": "undo-create-a1"}).json()["data"]
    accepted = client.post(
        f"/api/v1/remote/rooms/{game_id}/undo-requests/{request['id']}/accept",
        headers=b, json={"expected_version": 1,
                         "client_request_id": "undo-accept-b1"}).json()["data"]
    assert accepted["version"] == 2
    assert accepted["ply_count"] == 0
    assert accepted["pending_undo"] is None
```

- [ ] **Step 2: 运行远程测试并确认新路径失败**

Run: `python -m pytest backend/tests/test_remote.py -q`

Expected: FAIL，新接口返回 404 或房间响应缺少 `pending_undo`。

- [ ] **Step 3: 扩展远程契约**

```python
from backend.app.schemas.game import ClientRequestId

UndoStatus = Literal["PENDING", "ACCEPTED", "DECLINED", "STALE"]

class RemoteOperationRequest(StrictModel):
    expected_version: int = Field(ge=0)
    client_request_id: ClientRequestId

class PendingUndoResponse(StrictModel):
    id: str
    requester: Player
    responder: Player
    base_revision: int
    anchor_turn: int
    revert_count: int
    status: UndoStatus

class RemoteRoomResponse(StrictModel):
    game_id: str
    seat: Player
    room_status: RoomStatus
    invite_code: str
    public: bool
    expires_at: datetime
    version: int
    ply_count: int
    state: GameState
    token: str | None = None
    pending_undo: PendingUndoResponse | None = None
```

- [ ] **Step 4: 实现内存存储事务与服务权限**

创建申请时锁定棋局、验证席位与 `PLAYING`、查找申请者最后一条有效棋步、记录 `base_revision` 和 `anchor_turn`。待申请存在时 `legal_moves` 和 `move` 返回 `REMOTE_UNDO_PENDING`。

接受时仅允许 `responder`，且当前版本必须等于 `base_revision`；撤销 `turn_number >= anchor_turn` 的所有有效棋步，恢复锚点 `before_state`，版本增加 1，有效步数变成 `anchor_turn-1`。拒绝不改变棋局版本。认输允许在待申请期间执行，并把申请改为 `STALE`。

- [ ] **Step 5: 添加四个远程路由**

```python
POST /api/v1/remote/rooms/{game_id}/undo-requests
POST /api/v1/remote/rooms/{game_id}/undo-requests/{request_id}/accept
POST /api/v1/remote/rooms/{game_id}/undo-requests/{request_id}/decline
POST /api/v1/remote/rooms/{game_id}/resign
```

每个路由都传递 `X-Room-Token`，响应统一返回最新 `RemoteRoomResponse`，便于客户端直接替换权威状态。

- [ ] **Step 6: 运行远程和通用 API 测试**

Run: `python -m pytest backend/tests/test_remote.py backend/tests/test_api.py -q`

Expected: 全部 PASS。

- [ ] **Step 7: 提交远程状态机**

```bash
git add backend/app/schemas/remote.py backend/app/services/game_store.py backend/app/services/remote_service.py backend/app/api/v1/remote.py backend/tests/test_remote.py
git commit -m "feat: add agreed remote undo and resignation"
```

### Task 6: 在 MySQL 中实现操作事务和请求墓碑

**Files:**
- Modify: `backend/app/db/repositories/game.py`
- Modify: `backend/app/db/repositories/move.py`
- Modify: `backend/app/db/repositories/remote.py`
- Modify: `backend/app/db/repositories/mysql_store.py`
- Test: `backend/tests/test_mysql_persistence.py`

- [ ] **Step 1: 写失败的 MySQL 并发与回滚测试**

测试必须证明：悔棋在一个事务中标记棋步并更新快照；相同请求只产生一个事件；被撤销远程落子的旧请求号不能重新执行；认输和悔棋竞争只有一个成功；故意触发事件写入异常时棋盘和棋步标记全部回滚。

```python
def test_reverted_remote_request_is_a_permanent_tombstone(client, db):
    game_id, a, b = playing_room(client)
    original = remote_move(client, game_id, a, request_id="move-a-0001")
    accept_one_ply_undo(client, game_id, a, b)
    retried = client.post(f"/api/v1/remote/rooms/{game_id}/move",
        headers=a, json=original.request)
    assert retried.status_code == 409
    assert retried.json()["code"] == "REMOTE_REQUEST_CONFLICT"
```

- [ ] **Step 2: 运行真实 MySQL 测试并确认存储方法尚未实现**

Run: `if (-not $env:WUMA_TEST_DATABASE_URL) { throw 'Set WUMA_TEST_DATABASE_URL to a MySQL database whose name ends with _test' }`

Run: `$env:DATABASE_URL = $env:WUMA_TEST_DATABASE_URL`

Run: `python -m alembic -c backend/alembic.ini upgrade head`

Run: `python -m pytest backend/tests/test_mysql_persistence.py -q`

Expected: FAIL，新操作方法未实现或事务断言失败。

- [ ] **Step 3: 实现行锁和普通/AI 操作事务**

所有变更先用 `SELECT ... FOR UPDATE` 锁定 `games` 行。幂等事件查询先比较同请求号的固定参数；相同则返回事件中的 `state_after`，不同则返回请求冲突。撤销棋步使用：

```python
update(GameMoveModel).where(
    GameMoveModel.game_id == game_id,
    GameMoveModel.reverted_revision.is_(None),
    GameMoveModel.turn_number >= anchor_turn,
).values(reverted_revision=new_revision)
```

更新棋局快照、事件记录和终局记录必须与棋步标记位于同一个 `session.begin()`。

- [ ] **Step 4: 实现远程申请的唯一待处理约束和事务**

锁定棋局与远程房间行后查询 `PENDING` 申请。创建、接受、拒绝、认输都在同一事务中校验 token 对应席位。数据库异常统一转换为明确 API 冲突，不泄漏完整性错误。

- [ ] **Step 5: 修正远程重复落子读取**

`get_remote_move` 返回棋步的 `created_revision` 和 `reverted_revision`。只有未撤销、请求内容相同且创建前版本相同的请求可以返回原结果；已撤销记录始终返回 `REMOTE_REQUEST_CONFLICT`。

- [ ] **Step 6: 运行真实 MySQL 与全部后端测试**

Run: `python -m pytest backend/tests/test_mysql_persistence.py -q`

Run: `python -m pytest backend/tests -q`

Expected: 全部 PASS；MySQL 测试不得 SKIP。

- [ ] **Step 7: 提交 MySQL 事务实现**

```bash
git add backend/app/db/repositories/game.py backend/app/db/repositories/move.py backend/app/db/repositories/remote.py backend/app/db/repositories/mysql_store.py backend/tests/test_mysql_persistence.py
git commit -m "feat: persist game operations transactionally"
```

### Task 7: 实现共用对局设置存储和组件

**Files:**
- Create: `miniprogram/services/game-settings.ts`
- Create: `miniprogram/components/game-settings/game-settings.ts`
- Create: `miniprogram/components/game-settings/game-settings.json`
- Create: `miniprogram/components/game-settings/game-settings.wxml`
- Create: `miniprogram/components/game-settings/game-settings.wxss`
- Test: `tests/game-settings.test.mts`

- [ ] **Step 1: 写失败测试固定默认值、持久化和损坏数据恢复**

```ts
test('game settings use safe defaults and persist changes', () => {
  const storage = memoryStorage();
  const store = createGameSettingsStore(storage);
  assert.deepEqual(store.read(), {
    showLegalTargets: true,
    showCaptureNotice: true,
    vibrateOnAction: true,
    aiFirstPlayer: 'A',
  });
  store.write({ ...store.read(), showLegalTargets: false, aiFirstPlayer: 'B' });
  assert.equal(createGameSettingsStore(storage).read().aiFirstPlayer, 'B');
});
```

- [ ] **Step 2: 运行测试并确认模块不存在**

Run: `node --test tests/game-settings.test.mts`

Expected: FAIL，无法导入 `game-settings.ts`。

- [ ] **Step 3: 实现版本化设置存储**

```ts
export interface GameSettings {
  readonly showLegalTargets: boolean;
  readonly showCaptureNotice: boolean;
  readonly vibrateOnAction: boolean;
  readonly aiFirstPlayer: Player;
}

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  showLegalTargets: true,
  showCaptureNotice: true,
  vibrateOnAction: true,
  aiFirstPlayer: 'A',
};
```

存储键使用 `wuma:game-settings:v1`。缺失时返回默认值；结构损坏时恢复默认值并覆盖坏数据。导出 `createWxGameSettingsStore()` 和 `vibrateForSuccessfulAction(settings)`，后者捕获不支持或调用失败，不影响操作结果。

- [ ] **Step 4: 创建无业务逻辑的共用设置组件**

组件接收 `settings` 和 `showAiFirstPlayer`，用 switch/radio 展示四项配置，通过 `change` 事件把完整 `GameSettings` 发回页面。组件不直接访问棋局控制器。

- [ ] **Step 5: 运行测试与类型检查**

Run: `node --test tests/game-settings.test.mts`

Run: `npm run typecheck`

Expected: 全部 PASS。

- [ ] **Step 6: 提交设置模块**

```bash
git add miniprogram/services/game-settings.ts miniprogram/components/game-settings tests/game-settings.test.mts
git commit -m "feat: add persistent shared game settings"
```

### Task 8: 实现本地双人的一步悔棋和真实认输

**Files:**
- Modify: `miniprogram/pages/game/local-game.ts`
- Modify: `miniprogram/services/device-history.ts`
- Modify: `miniprogram/pages/game/game.ts`
- Modify: `miniprogram/pages/game/game.wxml`
- Modify: `miniprogram/pages/game/game.wxss`
- Modify: `miniprogram/pages/game/game.json`
- Test: `tests/local-game.test.mts`
- Test: `tests/device-history.test.mts`
- Test: `tests/game-operations-page.test.mts`

- [ ] **Step 1: 写失败测试固定本地操作语义**

```ts
test('local undo restores exactly the previous state and clears its frame', () => {
  const start = createLocalGameSession();
  const move = RuleEngine.getAllLegalMoves(start.gameState)[0];
  const selected = tapLocalGameNode(start, move.from).session;
  const played = tapLocalGameNode(selected, move.to).session;
  const undone = undoLocalGame(played);
  assert.deepEqual(undone.gameState, start.gameState);
  assert.equal(undone.undoFrame, null);
});

test('local resign makes the opponent the real winner', () => {
  const resigned = resignLocalGame(createLocalGameSession('A'));
  assert.equal(resigned.gameState.winner, 'B');
  assert.equal(resigned.gameState.winner_reason, 'RESIGN');
});
```

另测旧历史没有 `localUndoFrame` 时仍能读取，继续走一步后可撤销该步。

- [ ] **Step 2: 运行测试并确认操作函数不存在**

Run: `node --test tests/local-game.test.mts tests/device-history.test.mts tests/game-operations-page.test.mts`

Expected: FAIL。

- [ ] **Step 3: 为本地会话增加单步帧**

```ts
export interface LocalUndoFrame {
  readonly gameState: GameState;
  readonly lastMove: Move | null;
}

export interface LocalGameSession {
  readonly gameState: GameState;
  readonly selectedNode: NodeId | null;
  readonly legalDestinations: readonly NodeId[];
  readonly lastMove: Move | null;
  readonly undoFrame: LocalUndoFrame | null;
}
```

成功落子时把落子前 `gameState` 和 `lastMove` 保存到 `undoFrame`。`undoLocalGame` 恢复该帧并清空选中、合法位置和帧；`resignLocalGame` 生成 `RESIGN` 终局并清空交互状态。

- [ ] **Step 4: 扩展设备历史的可选本地帧**

`DeviceHistoryEntry` 和 `RecordDeviceGame` 增加 `localUndoFrame?: LocalUndoFrame | null`。旧记录缺失此字段时按 `null` 读取；保存本地棋局时验证帧内状态并一并写入。

- [ ] **Step 5: 接入普通对局页和共用设置**

页面增加 `showUndoConfirm`、`operationBusy` 和 `settings`。可见操作区加入“结束”按钮；悔棋与结束使用独立确认文案。成功后更新本机历史，按设置控制合法点高亮、吃子提示和一次震动。AI 首手设置只保存，重新开始时读取。

```xml
<view id="action-resign" class="{{operationBusy ? 'action-disabled' : ''}}"
      data-action="resign" bindtap="onAction">
  <text>旗</text><view>结束</view>
</view>
<confirm-dialog visible="{{showUndoConfirm}}" title="确认悔棋？"
  message="将撤销最近一手。" bind:cancel="cancelUndo" bind:confirm="confirmUndo" />
```

- [ ] **Step 6: 运行页面、历史和本地棋局测试**

Run: `node --test tests/local-game.test.mts tests/device-history.test.mts tests/game-operations-page.test.mts tests/history-game-page.test.mts`

Run: `npm run typecheck`

Expected: 全部 PASS。

- [ ] **Step 7: 提交本地操作**

```bash
git add miniprogram/pages/game/local-game.ts miniprogram/services/device-history.ts miniprogram/pages/game/game.ts miniprogram/pages/game/game.wxml miniprogram/pages/game/game.wxss miniprogram/pages/game/game.json tests/local-game.test.mts tests/device-history.test.mts tests/game-operations-page.test.mts
git commit -m "feat: add local undo and resignation"
```

### Task 9: 接入 AI 和兼容云端棋局操作

**Files:**
- Modify: `miniprogram/services/api-contract.ts`
- Modify: `miniprogram/services/game-api.ts`
- Modify: `miniprogram/services/api-client.ts`
- Modify: `miniprogram/pages/game/ai-game.ts`
- Modify: `miniprogram/pages/game/remote-game.ts`
- Modify: `miniprogram/pages/game/game.ts`
- Modify: `miniprogram/pages/game/game.wxml`
- Test: `tests/game-api.test.mts`
- Test: `tests/ai-game-operations.test.mts`
- Test: `tests/remote-game.test.mts`
- Test: `tests/ai-game-page.test.mts`

- [ ] **Step 1: 写失败的 API 与控制器测试**

```ts
test('AI undo replaces the snapshot with the authoritative server result', async () => {
  const controller = new AiGameController(apiWithUndoResult({
    version: 4, ply_count: 2, state: humanTurnState, reverted_turns: 2,
  }), storage, () => {});
  await controller.enter();
  await controller.undo();
  assert.equal(controller.snapshot.gameVersion, 4);
  assert.equal(controller.snapshot.plyCount, 2);
  assert.deepEqual(controller.snapshot.gameState, humanTurnState);
});
```

同时覆盖认输、忙碌时拒绝操作、网络结果不确定后刷新、操作后清理分析/教练/选中状态，以及兼容 `remote-game.ts` 的服务端 `LOCAL` 一手回退。

- [ ] **Step 2: 运行测试并确认接口缺失**

Run: `node --test tests/game-api.test.mts tests/ai-game-operations.test.mts tests/remote-game.test.mts tests/ai-game-page.test.mts`

Expected: FAIL，`GameApi` 没有 `undo`/`resign`，快照没有 `plyCount`。

- [ ] **Step 3: 扩展前端契约与 API**

```ts
export interface GameOperationRequestDto {
  readonly expected_version: number;
  readonly client_request_id: string;
}
export interface GameOperationDto {
  readonly version: number;
  readonly ply_count: number;
  readonly state: GameState;
  readonly reverted_turns: number;
}
```

`GameDto` 增加 `ply_count`，`GameApi` 增加：

```ts
undo(gameId: string, request: GameOperationRequestDto): Promise<GameOperationDto>;
resign(gameId: string, request: GameOperationRequestDto): Promise<GameOperationDto>;
```

为新增错误码补充中文提示：无棋可悔、已有待处理申请、版本冲突、棋局已结束和无权处理。

- [ ] **Step 4: 在控制器实现互斥操作和权威刷新**

快照增加 `plyCount`、`isOperating`。`undo()`/`resign()` 使用稳定请求号直到请求明确成功；成功后替换状态并清理临时分析，失败若属于网络不确定或版本冲突则调用 `getGame()` 恢复权威状态。

- [ ] **Step 5: 页面使用 `plyCount` 保存历史并完成设置接线**

`renderAi` 和 `renderRemote` 用 `plyCount` 保存历史手数；合法点和吃子提示受设置控制。重新开始 AI 对局时读取 `settings.aiFirstPlayer`，不再把玩家先手硬编码为 `A`。

- [ ] **Step 6: 运行 AI、兼容云端和页面测试**

Run: `node --test tests/game-api.test.mts tests/ai-game.test.mts tests/ai-game-operations.test.mts tests/remote-game.test.mts tests/ai-game-page.test.mts tests/remote-game-page.test.mts`

Run: `npm run typecheck`

Expected: 全部 PASS。

- [ ] **Step 7: 提交 AI 与兼容模式操作**

```bash
git add miniprogram/services/api-contract.ts miniprogram/services/game-api.ts miniprogram/services/api-client.ts miniprogram/pages/game/ai-game.ts miniprogram/pages/game/remote-game.ts miniprogram/pages/game/game.ts miniprogram/pages/game/game.wxml tests/game-api.test.mts tests/ai-game-operations.test.mts tests/remote-game.test.mts tests/ai-game-page.test.mts
git commit -m "feat: connect AI undo and resignation controls"
```

### Task 10: 接入真正远程双人的申请悔棋和认输页面

**Files:**
- Create: `miniprogram/services/online-credentials.ts`
- Modify: `miniprogram/services/online-api.ts`
- Modify: `miniprogram/pages/online/online-game.ts`
- Modify: `miniprogram/pages/online/online.ts`
- Modify: `miniprogram/pages/online/online.wxml`
- Modify: `miniprogram/pages/online/online.wxss`
- Modify: `miniprogram/pages/online/online.json`
- Test: `tests/online-game.test.mts`
- Test: `tests/online-page.test.mts`
- Test: `tests/online-history.test.mts`
- Test: `tests/online-operations.test.mts`

- [ ] **Step 1: 写失败测试固定申请方与响应方体验**

```ts
test('same-version polling still publishes a new pending undo request', async () => {
  const f = onlineFixture();
  const controller = new OnlineGameController(f.api, f.storage, () => {});
  await controller.restore();
  f.room = { ...f.room, pending_undo: pendingUndoFrom('B'), version: f.room.version };
  await controller.refresh();
  assert.equal(controller.snapshot.room?.pending_undo?.requester, 'B');
  assert.equal(controller.snapshot.canRespondToUndo, true);
});
```

再覆盖：发起后冻结点击、预计回退 1/2 手、同意/拒绝、操作重试、认输、轮询恢复、终局、`ply_count` 写入设备历史、背景轮询不触发震动。

- [ ] **Step 2: 运行联机测试并确认契约和控制器方法缺失**

Run: `node --test tests/online-game.test.mts tests/online-page.test.mts tests/online-history.test.mts tests/online-operations.test.mts`

Expected: FAIL。

- [ ] **Step 3: 扩展 `OnlineApi`**

```ts
requestUndo(id: string, token: string, request: OnlineOperationRequest): Promise<OnlineRoom>;
acceptUndo(id: string, token: string, undoId: string,
           request: OnlineOperationRequest): Promise<OnlineRoom>;
declineUndo(id: string, token: string, undoId: string,
            request: OnlineOperationRequest): Promise<OnlineRoom>;
resign(id: string, token: string, request: OnlineOperationRequest): Promise<OnlineRoom>;
```

`OnlineRoom` 增加 `ply_count` 和 `pending_undo`。所有方法沿用 `X-Room-Token`，客户端请求号在一次未确定结果的重试期间保持不变。

```ts
export interface OnlineOperationRequest {
  readonly expected_version: number;
  readonly client_request_id: string;
}
```

把 `ACTIVE_ONLINE_KEY`、设备 ID 键和席位 token 键移入 `online-credentials.ts`，导出经过类型校验的 `readOnlineSeat(storage, gameId)`、`writeOnlineSeat(...)` 和 `removeOnlineSeat(...)`。控制器与后续复盘页共用该模块，避免各自拼接凭证键。

- [ ] **Step 4: 扩展 `OnlineGameController` 状态机**

快照增加 `isOperating`、`canRequestUndo`、`canRespondToUndo` 和操作提示。`tapNode` 在待申请时直接返回。`refresh()` 即使 `version` 未变化也必须比较并发布 `room_status`、`pending_undo` 与终局状态，解决拒绝申请不增加版本时的同步问题。

- [ ] **Step 5: 修改远程页面**

增加“申请悔棋”“认输”“设置”按钮；申请方显示等待卡片，响应方显示回退手数和同意/拒绝按钮。认输使用 `confirm-dialog`。所有成功操作后立即调用一次 `refresh()`，历史使用 `room.ply_count`。合法点、吃子提示和本机成功操作震动使用 Task 7 的共用设置；轮询更新不震动。

```xml
<view wx:if="{{snapshot.room.pending_undo}}" class="undo-request-card">
  <view wx:if="{{snapshot.canRespondToUndo}}">
    对方申请悔棋，将回退 {{snapshot.room.pending_undo.revert_count}} 手
    <button bindtap="acceptUndo">同意</button>
    <button bindtap="declineUndo">拒绝</button>
  </view>
  <view wx:else>等待对方处理悔棋申请…</view>
</view>
```

- [ ] **Step 6: 运行联机测试和类型检查**

Run: `node --test tests/online-game.test.mts tests/online-page.test.mts tests/online-history.test.mts tests/online-operations.test.mts`

Run: `npm run typecheck`

Expected: 全部 PASS。

- [ ] **Step 7: 提交真正远程双人页面**

```bash
git add miniprogram/services/online-credentials.ts miniprogram/services/online-api.ts miniprogram/pages/online/online-game.ts miniprogram/pages/online/online.ts miniprogram/pages/online/online.wxml miniprogram/pages/online/online.wxss miniprogram/pages/online/online.json tests/online-game.test.mts tests/online-page.test.mts tests/online-history.test.mts tests/online-operations.test.mts
git commit -m "feat: add remote undo agreement and resignation UI"
```

### Task 11: 完成复盘、历史和认输终局回归

**Files:**
- Modify: `backend/app/api/v1/remote.py`
- Modify: `backend/app/services/remote_service.py`
- Modify: `backend/app/services/game_service.py`
- Modify: `backend/app/services/review_explanation/fallback.py`
- Modify: `miniprogram/services/online-api.ts`
- Modify: `miniprogram/services/online-credentials.ts`
- Modify: `miniprogram/pages/history/history.ts`
- Modify: `miniprogram/pages/history/history.wxml`
- Modify: `miniprogram/pages/review/review.ts`
- Modify: `miniprogram/pages/review/review.wxml`
- Modify: `miniprogram/pages/online/online.ts`
- Modify: `miniprogram/pages/online/online.wxml`
- Test: `backend/tests/test_review.py`
- Test: `backend/tests/test_remote.py`
- Test: `tests/history-page.test.mts`
- Test: `tests/review-page.test.mts`
- Test: `tests/online-history.test.mts`

- [ ] **Step 1: 写失败测试覆盖零手认输与撤销分支复盘**

```python
def test_review_accepts_resignation_without_fabricating_a_move(client):
    game_id = create_ai_game(client)
    resign(client, game_id, request_id="resign-zero-001")
    review = client.post(f"/api/v1/game/{game_id}/review", json={}).json()["data"]
    assert review["winnerReason"] == "RESIGN"
    assert review["moveReviews"] == []
```

前端测试断言历史卡片显示具体认输方（例如“玩家 A 认输”），对局和复盘终局区域显示“对方已认输”，且有效手数来自 `ply_count`。

远程测试还要断言：缺失或错误席位 token 不能读取复盘；持有 A/B 席位 token 分别读取或创建以本人席位为复盘视角的结构化复盘；已撤销棋步不会出现在 `moveReviews` 中。

- [ ] **Step 2: 运行回归测试并确认旧复盘终态假设失败**

Run: `python -m pytest backend/tests/test_review.py -q`

Run: `node --test tests/history-page.test.mts tests/review-page.test.mts`

Expected: FAIL，旧逻辑要求最后棋步状态等于终局快照或缺少认输文案。

- [ ] **Step 3: 修正复盘终态和页面文案**

复盘分析只遍历有效棋步，允许零手棋；胜方和终局原因始终取权威棋局快照。历史与复盘页面为 `RESIGN` 显示“对方认输”，不创建虚假棋步或虚假评分。

远程服务增加席位鉴权后的结构化复盘路由：

```text
GET  /api/v1/remote/rooms/{game_id}/review
POST /api/v1/remote/rooms/{game_id}/review
```

`RemoteService` 先用房间 token 验证 A/B 席位，再把该席位作为 `reviewed_player` 调用允许 `REMOTE` 模式的内部 `GameService.get_review/create_review`。通用 `/api/v1/game/{id}/review` 继续拒绝远程棋局，避免绕过席位鉴权。

`OnlineApi` 增加带 `X-Room-Token` 的 `getReview/createReview`。复盘页接收 `mode=online`，从 `online-credentials.ts` 读取对应棋局的席位 token，并使用远程接口。远程模式只显示真实结构化复盘，隐藏需要账号归属的自然语言讲解和训练生成入口。

历史页把已结束 `online` 记录纳入“可复盘”筛选，按钮改为“查看复盘”，跳转到：

```text
/pages/review/review?mode=online&gameId={encodedGameId}
```

独立远程页终局区域也提供同一路径的“查看复盘”按钮。

- [ ] **Step 4: 运行历史、复盘、训练回归**

Run: `python -m pytest backend/tests/test_review.py backend/tests/test_remote.py backend/tests/test_explanation.py backend/tests/test_training.py -q`

Run: `node --test tests/history-page.test.mts tests/online-history.test.mts tests/review-page.test.mts tests/review-analysis.test.mts tests/training.test.mts`

Expected: 全部 PASS。

- [ ] **Step 5: 提交历史与复盘兼容**

```bash
git add backend/app/api/v1/remote.py backend/app/services/remote_service.py backend/app/services/game_service.py backend/app/services/review_explanation/fallback.py miniprogram/services/online-api.ts miniprogram/services/online-credentials.ts miniprogram/pages/history/history.ts miniprogram/pages/history/history.wxml miniprogram/pages/review/review.ts miniprogram/pages/review/review.wxml miniprogram/pages/online/online.ts miniprogram/pages/online/online.wxml backend/tests/test_review.py backend/tests/test_remote.py tests/history-page.test.mts tests/online-history.test.mts tests/review-page.test.mts
git commit -m "fix: replay active moves and resignation outcomes"
```

### Task 12: 端到端验收、文档更新和阶段判定

**Files:**
- Create: `scripts/game-operations-devtool-e2e.cjs`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/frontend-feature-implementation-prompt.md`
- Test: `scripts/game-operations-devtool-e2e.cjs`

- [ ] **Step 1: 新增微信开发者工具端到端脚本**

脚本至少自动验证：本地落子后悔棋、本地认输、AI 悔棋、AI 认输、设置刷新后保留、远程页面操作入口和同设备模拟的申请状态。为 `package.json` 增加：

```json
"test:e2e:game-operations": "node scripts/game-operations-devtool-e2e.cjs"
```

- [ ] **Step 2: 运行完整前端检查**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run check`

Expected: 全部 PASS。

- [ ] **Step 3: 运行完整后端与迁移检查**

Run: `python -m pytest backend/tests -q`

Run: `if (-not $env:WUMA_TEST_DATABASE_URL) { throw 'Set WUMA_TEST_DATABASE_URL to a MySQL database whose name ends with _test' }`

Run: `$env:DATABASE_URL = $env:WUMA_TEST_DATABASE_URL`

Run: `python -m pytest backend/tests/test_mysql_persistence.py -q`

Run: `python -m alembic -c backend/alembic.ini upgrade head`

Expected: 全部 PASS，MySQL 用例不得 SKIP，数据库位于最新迁移 `0013_remote_undo_revert_count`。`0012_remote_undo_idempotency` 与 `0013_remote_undo_revert_count` 为实现期间幂等审查补充；此处是验收要求，不代表真实数据库已验收。

- [ ] **Step 4: 运行开发者工具端到端测试**

Run: `npm run test:e2e:game-operations`

Expected: PASS；如本机未启动微信开发者工具自动化端口，记录为环境阻塞，不能把本阶段标记为已完成。

- [ ] **Step 5: 完成两设备远程手工验收**

依次验证：

1. A 刚落子后申请，B 同意，双方回退 1 手且版本一致；
2. A 落子、B 回应后，A 申请，B 同意，双方回退 2 手；
3. B 拒绝后双方继续落子；
4. 申请期间退出重进仍恢复待处理状态；
5. A、B 分别认输一次，双方终局、历史和复盘一致；
6. 断网重试不产生重复落子、重复悔棋或重复终局。

- [ ] **Step 6: 更新阶段文档**

`README.md` 和总提示词只记录已经由自动测试和手工验收证明的结果。若两设备验收未完成，状态必须写“代码完成，尚未满足验收条件”，并列出唯一剩余检查；全部通过后才写“本阶段完成，可以进入下一阶段”。

- [ ] **Step 7: 提交验收脚本与阶段记录**

```bash
git add scripts/game-operations-devtool-e2e.cjs package.json README.md docs/frontend-feature-implementation-prompt.md
git commit -m "test: verify game operations end to end"
```

- [ ] **Step 8: 按 `superpowers:verification-before-completion` 复核最终证据**

重新读取本任务所有测试输出和 `git status --short`。确认仅包含本分支预期改动，没有策划书或其他工作树文件，然后再报告完成内容、未完成验收项以及能否进入下一阶段。
