import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { NODE_IDS, RuleEngine, createInitialGameState } from '../miniprogram/domain/index.ts';
import type { GameState } from '../miniprogram/domain/index.ts';

registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (specifier.startsWith('.') && context.parentURL &&
        (error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return nextResolve(url.href, context);
    }
    throw error;
  }
} });

const { RemoteGameController } = await import('../miniprogram/pages/game/remote-game.ts');
const { ApiError } = await import('../miniprogram/services/api-client.ts');
const { mapGameStateToView } = await import('../miniprogram/pages/game/game-state-mapper.ts');

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const initial = createInitialGameState();
  const turn = RuleEngine.executeTurn(initial, { from: 'P01', to: 'P02' });
  let saved: string | null = null;
  let current: GameState = initial;
  let createCount = 0;
  let moveCount = 0;
  let legalCount = 0;
  const storage = {
    read: () => saved,
    write: (id: string) => { saved = id; },
    clear: () => { saved = null; },
  };
  const api = {
    createGame: async () => { createCount++; return { game_id: `g${createCount}`,
      version: 0, ply_count: 0, state: initial }; },
    getGame: async (gameId: string) => ({ game_id: gameId,
      version: current === initial ? 0 : 1, ply_count: current === initial ? 0 : 1,
      state: current }),
    getLegalMoves: async () => { legalCount++; return { moves: [{ from: 'P01' as const, to: 'P02' as const }] }; },
    move: async () => { moveCount++; current = turn.state; return { turn }; },
    aiMove: async () => { throw new Error('AI is outside Phase 18'); },
  };
  return { initial, turn, api, storage, get saved() { return saved; },
    set saved(id: string | null) { saved = id; },
    get createCount() { return createCount; }, get moveCount() { return moveCount; },
    get legalCount() { return legalCount; }, set current(state: GameState) { current = state; } };
}

test('creates remote game, asks server for legal targets, then renders only accepted TurnResult', async () => {
  const f = fixture();
  const controller = new RemoteGameController(f.api, f.storage, () => {});
  await controller.enter();
  assert.equal(f.saved, 'g1');
  assert.equal(controller.snapshot.gameState, f.initial);
  await controller.tapNode('P01');
  assert.equal(f.legalCount, 1);
  assert.deepEqual(controller.snapshot.legalTargets, ['P02']);
  assert.equal(controller.snapshot.selectedNode, 'P01');
  await controller.tapNode('P02');
  assert.equal(f.moveCount, 1);
  assert.equal(controller.snapshot.gameState, f.turn.state);
  assert.equal(controller.snapshot.gameState?.current_player, 'B');
  assert.equal(controller.snapshot.lastMove?.to, 'P02');
  assert.deepEqual(controller.snapshot.legalTargets, []);
});

test('move pending blocks double submission and does not change board before server reply', async () => {
  const f = fixture();
  const pending = deferred<{turn: typeof f.turn}>();
  let calls = 0;
  f.api.move = async () => { calls++; return pending.promise; };
  const controller = new RemoteGameController(f.api, f.storage, () => {});
  await controller.enter();
  await controller.tapNode('P01');
  const first = controller.tapNode('P02');
  assert.equal(controller.snapshot.isSubmittingMove, true);
  assert.equal(controller.snapshot.gameState, f.initial);
  await controller.tapNode('P02');
  await controller.tapNode('P06');
  assert.equal(calls, 1);
  assert.equal(controller.snapshot.selectedNode, 'P01');
  pending.resolve({ turn: f.turn });
  await first;
  assert.equal(controller.snapshot.gameState, f.turn.state);
  assert.equal(controller.snapshot.isSubmittingMove, false);
});

test('switching selected pieces discards an older legal-move response', async () => {
  const f = fixture();
  const older = deferred<{ moves: Array<{ from: 'P01'; to: 'P02' }> }>();
  f.api.getLegalMoves = async (_gameId: string, node: 'P01' | 'P06') =>
    node === 'P01' ? older.promise : { moves: [{ from: 'P06' as const, to: 'P07' as const }] };
  const controller = new RemoteGameController(f.api, f.storage, () => {});
  await controller.enter();
  const first = controller.tapNode('P01');
  await controller.tapNode('P06');
  older.resolve({ moves: [{ from: 'P01', to: 'P02' }] });
  await first;
  assert.equal(controller.snapshot.selectedNode, 'P06');
  assert.deepEqual(controller.snapshot.legalTargets, ['P07']);
});

test('server capture result drives replacement pieces, reserve and terminal display', async () => {
  const f = fixture();
  const occupancy = { ...f.initial.board.occupancy };
  for (const node of NODE_IDS) occupancy[node] = null;
  Object.assign(occupancy, { P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A' });
  const position = { ...f.initial, board: { occupancy } };
  const capture = RuleEngine.executeTurn(position, { from: 'P19', to: 'P13' });
  f.api.createGame = async () => ({ game_id: 'capture', version: 0, ply_count: 0,
    state: position });
  f.api.getLegalMoves = async () => ({ moves: [{ from: 'P19', to: 'P13' }] });
  f.api.move = async () => ({ turn: capture });
  const controller = new RemoteGameController(f.api, f.storage, () => {});
  await controller.enter();
  await controller.tapNode('P19');
  await controller.tapNode('P13');
  assert.equal(controller.snapshot.lastCapture?.was_applied, true);
  const view = mapGameStateToView(controller.snapshot.gameState!);
  assert.equal(view.board.pieces.find(piece => piece.nodeId === 'P12')?.side, 'black');
  assert.ok(view.reserve.A < position.players.A.reserve_count);
  assert.equal(view.gameOver, true);
  assert.equal(view.winnerMessage, '对方棋子已全部被吃');
});

test('duplicate game creation is blocked while the first request is pending', async () => {
  const f = fixture();
  const pending = deferred<{ game_id: string; version: number; ply_count: number; state: GameState }>();
  let calls = 0;
  f.api.createGame = async () => { calls++; return pending.promise; };
  const controller = new RemoteGameController(f.api, f.storage, () => {});
  const first = controller.enter();
  await controller.enter();
  assert.equal(calls, 1);
  pending.resolve({ game_id: 'g1', version: 0, ply_count: 0, state: f.initial });
  await first;
  assert.equal(controller.snapshot.gameId, 'g1');
});

test('new controller restores from stored ID and continues from server state', async () => {
  const f = fixture();
  const first = new RemoteGameController(f.api, f.storage, () => {});
  await first.enter();
  await first.tapNode('P01');
  await first.tapNode('P02');
  first.dispose();
  const restored = new RemoteGameController(f.api, f.storage, () => {});
  await restored.enter();
  assert.equal(f.createCount, 1);
  assert.equal(restored.snapshot.gameState, f.turn.state);
  assert.equal(restored.snapshot.selectedNode, null);
  assert.deepEqual(restored.snapshot.legalTargets, []);
});

test('missing stored game clears ID and creates a fresh game', async () => {
  const f = fixture();
  f.saved = 'deleted';
  f.api.getGame = async () => { throw new ApiError('GAME_NOT_FOUND', 404); };
  const controller = new RemoteGameController(f.api, f.storage, () => {});
  await controller.enter();
  assert.equal(f.saved, 'g1');
  assert.equal(controller.snapshot.gameId, 'g1');
});

test('inaccessible stored game from an older device account is replaced', async () => {
  const f = fixture();
  f.saved = 'other-account-game';
  f.api.getGame = async () => { throw new ApiError('AUTH_FORBIDDEN', 403); };
  const controller = new RemoteGameController(f.api, f.storage, () => {});
  await controller.enter();
  assert.equal(f.createCount, 1);
  assert.equal(f.saved, 'g1');
  assert.equal(controller.snapshot.gameId, 'g1');
  assert.equal(controller.snapshot.errorMessage, null);
});

test('conflict reloads authoritative state and clears stale selection', async () => {
  const f = fixture();
  f.api.move = async () => { throw new ApiError('GAME_STATE_CONFLICT', 409); };
  f.current = f.turn.state;
  const controller = new RemoteGameController(f.api, f.storage, () => {});
  await controller.enter();
  await controller.tapNode('P01');
  await controller.tapNode('P02');
  assert.equal(controller.snapshot.gameState, f.turn.state);
  assert.equal(controller.snapshot.selectedNode, null);
  assert.deepEqual(controller.snapshot.legalTargets, []);
  assert.equal(controller.snapshot.notice, '棋局状态已更新');
});

test('failed conflict reload locks stale board until a successful retry', async () => {
  const f = fixture();
  let reloadFails = false;
  f.api.getGame = async gameId => {
    if (reloadFails) throw new ApiError('NETWORK_ERROR', 0);
    return { game_id: gameId, version: 1, ply_count: 1, state: f.turn.state };
  };
  f.api.move = async () => { throw new ApiError('GAME_STATE_CONFLICT', 409); };
  const controller = new RemoteGameController(f.api, f.storage, () => {});
  await controller.enter();
  reloadFails = true;
  await controller.tapNode('P01');
  await controller.tapNode('P02');
  assert.equal(controller.snapshot.gameState, f.initial);
  assert.equal(controller.snapshot.needsResync, true);
  const previousLegalCalls = f.legalCount;
  await controller.tapNode('P06');
  assert.equal(f.legalCount, previousLegalCalls);
  reloadFails = false;
  await controller.enter();
  assert.equal(controller.snapshot.needsResync, false);
  assert.equal(controller.snapshot.gameState, f.turn.state);
});

test('engine outage leaves server board unchanged and never falls back to local rules', async () => {
  const f = fixture();
  f.api.move = async () => { throw new ApiError('ENGINE_UNAVAILABLE', 503); };
  const controller = new RemoteGameController(f.api, f.storage, () => {});
  await controller.enter();
  await controller.tapNode('P01');
  await controller.tapNode('P02');
  assert.equal(controller.snapshot.gameState, f.initial);
  assert.match(controller.snapshot.errorMessage ?? '', /暂时不可用/);
  assert.equal(controller.snapshot.isSubmittingMove, false);
});

test('invalid move clears stale highlights without changing the board', async () => {
  const f = fixture();
  f.api.move = async () => { throw new ApiError('INVALID_MOVE', 400); };
  const controller = new RemoteGameController(f.api, f.storage, () => {});
  await controller.enter();
  await controller.tapNode('P01');
  await controller.tapNode('P02');
  assert.equal(controller.snapshot.gameState, f.initial);
  assert.equal(controller.snapshot.selectedNode, null);
  assert.deepEqual(controller.snapshot.legalTargets, []);
  assert.equal(controller.snapshot.errorMessage, '落子无效，请重新选择');
});

test('invalid move reloads a newer server state when another client already moved', async () => {
  const f = fixture();
  f.api.move = async () => { throw new ApiError('INVALID_MOVE', 400); };
  f.current = f.turn.state;
  const controller = new RemoteGameController(f.api, f.storage, () => {});
  await controller.enter();
  await controller.tapNode('P01');
  await controller.tapNode('P02');
  assert.equal(controller.snapshot.gameState, f.turn.state);
  assert.equal(controller.snapshot.selectedNode, null);
  assert.deepEqual(controller.snapshot.legalTargets, []);
});

test('terminal server result blocks further taps and restart creates a new game ID', async () => {
  const f = fixture();
  const finished = { ...f.turn, state: { ...f.turn.state, game_status: 'FINISHED' as const,
    winner: 'A' as const, winner_reason: 'CAPTURE_ALL' as const }, game_over: true };
  f.api.move = async () => ({ turn: finished });
  const controller = new RemoteGameController(f.api, f.storage, () => {});
  await controller.enter();
  await controller.tapNode('P01');
  await controller.tapNode('P02');
  await controller.tapNode('P05');
  assert.equal(f.legalCount, 1);
  assert.equal(controller.snapshot.gameState?.winner_reason, 'CAPTURE_ALL');
  await controller.restart();
  assert.equal(f.saved, 'g2');
  assert.equal(controller.snapshot.gameState, f.initial);
});

test('disposed page ignores late request response', async () => {
  const f = fixture();
  const pending = deferred<{ game_id: string; version: number; ply_count: number; state: GameState }>();
  f.api.createGame = async () => pending.promise;
  let updates = 0;
  const controller = new RemoteGameController(f.api, f.storage, () => { updates++; });
  const started = controller.enter();
  const beforeDispose = updates;
  controller.dispose();
  pending.resolve({ game_id: 'late', version: 0, ply_count: 0, state: f.initial });
  await started;
  assert.equal(updates, beforeDispose);
  assert.equal(f.saved, null);
});

test('compatible LOCAL remote controller applies authoritative one-ply undo and resignation', async () => {
  const f = fixture();
  const requests: any[] = [];
  f.api.createGame = async () => ({ game_id: 'g1', version: 1, ply_count: 1,
    state: f.turn.state });
  (f.api as any).undo = async (_id: string, request: any) => {
    requests.push(['undo', request]);
    return { version: 2, ply_count: 0, state: f.initial, reverted_turns: 1 };
  };
  (f.api as any).resign = async (_id: string, request: any) => {
    requests.push(['resign', request]);
    return { version: 3, ply_count: 0,
      state: { ...f.initial, game_status: 'FINISHED', winner: 'B', winner_reason: 'RESIGN' },
      reverted_turns: 0 };
  };
  const c = new RemoteGameController(f.api as any, f.storage, () => {});
  await c.enter();
  assert.equal(c.snapshot.plyCount, 1);
  await c.undo();
  assert.equal(c.snapshot.plyCount, 0);
  assert.deepEqual(c.snapshot.gameState, f.initial);
  assert.equal(requests[0][1].expected_version, 1);
  await c.resign();
  assert.equal(c.snapshot.gameState?.winner_reason, 'RESIGN');
  assert.equal(c.snapshot.isOperating, false);
});

test('compatible controller never treats revision as ply count', async () => {
  const f = fixture();
  f.api.createGame = async () => ({ game_id: 'g1', version: 81, ply_count: 1,
    state: f.turn.state });
  const c = new RemoteGameController(f.api as any, f.storage, () => {});
  await c.enter();
  assert.equal(c.snapshot.gameVersion, 81);
  assert.equal(c.snapshot.plyCount, 1);
});

test('compatible controller rejects missing and invalid operation ply counts', async () => {
  const f = fixture();
  f.api.createGame = async () => ({ game_id: 'g1', version: 5, ply_count: 1,
    state: f.turn.state });
  const c = new RemoteGameController(f.api as any, f.storage, () => {});
  await c.enter();
  f.api.getGame = async gameId => ({ game_id: gameId, version: 5, ply_count: 1,
    state: f.turn.state });
  (f.api as any).undo = async () => ({ version: 6, ply_count: 1.5,
    state: f.initial, reverted_turns: 1 });
  await c.undo();
  assert.equal(c.snapshot.gameVersion, 5);
  assert.equal(c.snapshot.plyCount, 1);
  assert.deepEqual(c.snapshot.gameState, f.turn.state);
  assert.equal(c.snapshot.errorMessage, '棋局数据异常，请刷新重试');

  const broken = fixture();
  broken.api.createGame = async () => ({ game_id: 'bad', version: 42,
    state: broken.initial } as any);
  const rejected = new RemoteGameController(broken.api as any, broken.storage, () => {});
  await rejected.enter();
  assert.equal(rejected.snapshot.gameId, null);
  assert.equal(rejected.snapshot.plyCount, 0);
  assert.equal(broken.saved, null);
  assert.equal(rejected.snapshot.errorMessage, '棋局数据异常，请刷新重试');
});
