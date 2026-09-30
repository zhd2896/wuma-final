import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { RuleEngine, createInitialGameState } from '../miniprogram/domain/index.ts';

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

const { AiGameController } = await import('../miniprogram/pages/game/ai-game.ts');
const { ApiError } = await import('../miniprogram/services/api-client.ts');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

function fixture() {
  const initial = createInitialGameState();
  const human = RuleEngine.executeTurn(initial, { from: 'P01', to: 'P02' }).state;
  const played = RuleEngine.executeTurn(human, RuleEngine.getAllLegalMoves(human)[0]).state;
  let authoritative = { game_id: 'ai1', version: 2, ply_count: 2, state: played,
    mode: 'AI' as const, human_player: 'A' as const, ai_player: 'B' as const,
    ai_level: 'STANDARD' as const };
  const undoRequests: any[] = [];
  const resignRequests: any[] = [];
  let getCalls = 0;
  const api: any = {
    createGame: async () => authoritative,
    getGame: async () => { getCalls++; return authoritative; },
    getLegalMoves: async () => ({ moves: [] }), move: async () => { throw new Error('unused'); },
    aiMove: async () => { throw new Error('unused'); },
    undo: async (_id: string, request: any) => {
      undoRequests.push(request);
      return { version: 3, ply_count: 0, state: initial, reverted_turns: 2 };
    },
    resign: async (_id: string, request: any) => {
      resignRequests.push(request);
      return { version: 3, ply_count: 2,
        state: { ...played, game_status: 'FINISHED', winner: 'B', winner_reason: 'RESIGN' },
        reverted_turns: 0 };
    },
    analyzeGame: async () => { throw new Error('unused'); },
    getCoachHint: async () => { throw new Error('unused'); },
  };
  const storage = { read: () => 'ai1', write: () => {}, clear: () => {} };
  return { api, storage, initial, played, undoRequests, resignRequests,
    get getCalls() { return getCalls; },
    set authoritative(value: typeof authoritative) { authoritative = value; } };
}

test('AI undo replaces all derived state with authoritative server result', async () => {
  const f = fixture();
  const c = new AiGameController(f.api, f.storage, () => {});
  await c.enter();
  await c.undo();
  assert.equal(c.snapshot.gameVersion, 3);
  assert.equal(c.snapshot.plyCount, 0);
  assert.deepEqual(c.snapshot.gameState, f.initial);
  assert.equal(c.snapshot.selectedNode, null);
  assert.deepEqual(c.snapshot.legalTargets, []);
  assert.equal(c.snapshot.analysis, null);
  assert.equal(c.snapshot.coachHint, null);
  assert.equal(c.snapshot.lastMove, null);
  assert.equal(c.snapshot.isOperating, false);
  assert.equal(f.undoRequests[0].expected_version, 2);
  assert.match(f.undoRequests[0].client_request_id, /^game-undo-/);
});

test('AI resign uses server terminal state and operation mutex blocks a second operation', async () => {
  const f = fixture();
  const pending = deferred<any>();
  f.api.undo = () => pending.promise;
  const c = new AiGameController(f.api, f.storage, () => {});
  await c.enter();
  const undoing = c.undo();
  assert.equal(c.snapshot.isOperating, true);
  await c.resign();
  assert.equal(f.resignRequests.length, 0);
  pending.resolve({ version: 3, ply_count: 0, state: f.initial, reverted_turns: 2 });
  await undoing;
  f.api.resign = async (_id: string, request: any) => {
    f.resignRequests.push(request);
    return { version: 4, ply_count: 0,
      state: { ...f.initial, game_status: 'FINISHED', winner: 'B', winner_reason: 'RESIGN' },
      reverted_turns: 0 };
  };
  await c.resign();
  assert.equal(c.snapshot.gameState?.winner_reason, 'RESIGN');
  assert.equal(c.snapshot.gameVersion, 4);
});

test('AI uncertain undo refreshes and reuses request id on retry', async () => {
  const f = fixture();
  let attempts = 0;
  f.api.undo = async (_id: string, request: any) => {
    f.undoRequests.push(request); attempts++;
    if (attempts === 1) {
      f.authoritative = { game_id: 'ai1', version: 3, ply_count: 0, state: f.initial,
        mode: 'AI', human_player: 'A', ai_player: 'B', ai_level: 'STANDARD' };
      throw new ApiError('NETWORK_ERROR', 0);
    }
    return { version: 3, ply_count: 0, state: f.initial, reverted_turns: 2 };
  };
  const c = new AiGameController(f.api, f.storage, () => {});
  await c.enter();
  await c.undo();
  assert.equal(f.getCalls, 2);
  assert.equal(c.snapshot.needsResync, false);
  await c.undo();
  assert.equal(f.undoRequests[0].client_request_id, f.undoRequests[1].client_request_id);
  assert.equal(f.undoRequests[1].expected_version, f.undoRequests[0].expected_version);
});

test('AI version conflict refreshes authority and a retry uses refreshed version', async () => {
  const f = fixture();
  const newer = { ...f.played, current_player: 'B' as const };
  f.authoritative = { game_id: 'ai1', version: 4, ply_count: 3, state: newer,
    mode: 'AI', human_player: 'A', ai_player: 'B', ai_level: 'STANDARD' };
  let attempts = 0;
  f.api.undo = async (_id: string, request: any) => {
    f.undoRequests.push(request); attempts++;
    if (attempts === 1) throw new ApiError('GAME_STATE_CONFLICT', 409);
    return { version: 5, ply_count: 2, state: f.played, reverted_turns: 1 };
  };
  const c = new AiGameController(f.api, f.storage, () => {});
  await c.enter();
  await c.undo();
  assert.equal(c.snapshot.gameVersion, 4);
  assert.equal(c.snapshot.plyCount, 3);
  await c.undo();
  assert.equal(f.undoRequests[1].expected_version, 4);
  assert.notEqual(f.undoRequests[0].client_request_id, f.undoRequests[1].client_request_id);
});
