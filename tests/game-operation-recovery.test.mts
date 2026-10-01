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
const { RemoteGameController } = await import('../miniprogram/pages/game/remote-game.ts');
const { ApiError } = await import('../miniprogram/services/api-client.ts');

for (const [name, Controller] of [['AI', AiGameController], ['compatible LOCAL', RemoteGameController]] as const) {
  function fixture() {
    const initial = createInitialGameState();
    const human = RuleEngine.executeTurn(initial, { from: 'P01', to: 'P02' }).state;
    const played = RuleEngine.executeTurn(human, RuleEngine.getAllLegalMoves(human)[0]).state;
    let authority: any = { game_id: 'g1', version: 2, ply_count: 2, state: played,
      mode: 'AI', human_player: 'A', ai_player: 'B', ai_level: 'STANDARD' };
    const requests: any[] = [];
    let getCalls = 0;
    let otherCalls = 0;
    const api: any = {
      getGame: async () => { getCalls++; return authority; },
      createGame: async () => { otherCalls++; return authority; },
      getLegalMoves: async () => { otherCalls++; return { moves: [{ from: 'P01', to: 'P02' }] }; },
      move: async () => { otherCalls++; throw new Error('unexpected move'); },
      aiMove: async () => { otherCalls++; throw new Error('unexpected AI move'); },
      analyzeGame: async () => { otherCalls++; throw new Error('unexpected analysis'); },
      getCoachHint: async () => { otherCalls++; throw new Error('unexpected hint'); },
      undo: async (_id: string, request: any) => {
        requests.push(request);
        return { version: 3, ply_count: 0, state: initial, reverted_turns: 2 };
      },
      resign: async () => { otherCalls++; throw new Error('unexpected resignation'); },
    };
    const c = new Controller(api, { read: () => 'g1', write: () => {}, clear: () => {} }, () => {});
    return { c, api, requests, initial, played,
      get authority() { return authority; }, set authority(value: any) { authority = value; },
      get getCalls() { return getCalls; }, get otherCalls() { return otherCalls; } };
  }

  test(`${name} malformed operation refreshes authority and retries original request`, async () => {
    const f = fixture();
    await f.c.enter();
    f.api.undo = async (_id: string, request: any) => {
      f.requests.push(request);
      if (f.requests.length === 1) {
        f.authority = { ...f.authority, version: 3, ply_count: 0, state: f.initial };
        return { version: 3, state: f.initial, reverted_turns: 2 };
      }
      return { version: 3, ply_count: 0, state: f.initial, reverted_turns: 2 };
    };
    assert.equal(await f.c.undo(), false);
    assert.equal(f.getCalls, 2);
    assert.equal(f.c.snapshot.gameVersion, 3);
    assert.equal(f.c.snapshot.plyCount, 0);
    assert.deepEqual(f.c.snapshot.gameState, f.initial);
    assert.equal(f.c.snapshot.errorMessage, '棋局数据异常，请刷新重试');
    await f.c.tapNode('P01');
    await f.c.tapNode('P02');
    await f.c.resign();
    await f.c.restart();
    if (f.c instanceof AiGameController) {
      await f.c.analyze();
      await f.c.requestCoachHint();
    }
    assert.equal(f.otherCalls, 0);
    assert.equal(await f.c.undo(), true);
    assert.equal(f.requests.length, 2);
    assert.deepEqual(f.requests[1], f.requests[0]);
    assert.equal(f.requests[1].expected_version, 2);
    assert.equal(f.c.snapshot.errorMessage, null);
    await f.c.tapNode('P01');
    assert.equal(f.otherCalls, 1);
  });

  test(`${name} malformed operation and GET preserve old authority while same request can retry`, async () => {
    const f = fixture();
    await f.c.enter();
    const before = structuredClone(f.c.snapshot);
    f.api.undo = async (_id: string, request: any) => {
      f.requests.push(request);
      return { version: 3, ply_count: f.requests.length === 1 ? -1 : 0,
        state: f.initial, reverted_turns: 2 };
    };
    f.api.getGame = async () => ({ ...f.authority, version: 3, ply_count: 0.5, state: f.initial });
    await f.c.undo();
    assert.equal(f.c.snapshot.needsResync, true);
    assert.equal(f.c.snapshot.gameVersion, before.gameVersion);
    assert.equal(f.c.snapshot.plyCount, before.plyCount);
    assert.deepEqual(f.c.snapshot.gameState, before.gameState);
    assert.equal(f.c.snapshot.errorMessage, '棋局数据异常，请刷新重试');
    await f.c.tapNode('P01');
    await f.c.resign();
    await f.c.restart();
    assert.equal(f.otherCalls, 0);
    assert.equal(await f.c.undo(), true);
    assert.equal(f.requests.length, 2);
    assert.deepEqual(f.requests[1], f.requests[0]);
    assert.equal(f.c.snapshot.needsResync, false);
  });

  test(`${name} GET refresh alone preserves unresolved request and blocks AI resumption`, async () => {
    const f = fixture();
    await f.c.enter();
    f.api.undo = async (_id: string, request: any) => {
      f.requests.push(request);
      return { version: 3, ply_count: f.requests.length === 1 ? undefined : 0,
        state: f.initial, reverted_turns: 2 };
    };
    await f.c.undo();
    f.authority = { ...f.authority, version: 4,
      state: { ...f.played, current_player: 'B' } };
    await f.c.enter();
    assert.equal(f.c.snapshot.gameVersion, 4);
    assert.equal(f.c.snapshot.errorMessage, '棋局数据异常，请刷新重试');
    assert.equal(f.otherCalls, 0);
    assert.equal(await f.c.undo(), true);
    assert.deepEqual(f.requests[1], f.requests[0]);
  });

  test(`${name} terminal resignation response recovery retries original ID through retry entry`, async () => {
    const f = fixture();
    await f.c.enter();
    const finished = { ...f.played, game_status: 'FINISHED', winner: 'B', winner_reason: 'RESIGN' };
    f.api.resign = async (_id: string, request: any) => {
      f.requests.push(request);
      f.authority = { ...f.authority, version: 3, state: finished };
      return { version: 3, ply_count: f.requests.length === 1 ? undefined : 2,
        state: finished, reverted_turns: 0 };
    };
    await f.c.resign();
    assert.equal(f.c.snapshot.gameState?.game_status, 'FINISHED');
    assert.equal(await f.c.undo(), false);
    await f.c.retry();
    assert.equal(f.requests.length, 2);
    assert.deepEqual(f.requests[1], f.requests[0]);
    assert.equal(f.c.snapshot.errorMessage, null);
    assert.equal(f.c.snapshot.notice, '已认输');
  });

  test(`${name} unresolved refresh cannot replace the original game`, async () => {
    const f = fixture();
    await f.c.enter();
    f.api.undo = async () => ({ version: 3, state: f.initial, reverted_turns: 2 });
    await f.c.undo();
    f.api.getGame = async () => { throw new ApiError('GAME_NOT_FOUND', 404); };
    await f.c.enter();
    assert.equal(f.otherCalls, 0);
    assert.equal(f.c.snapshot.gameId, 'g1');
    await f.c.tapNode('P01');
    assert.equal(f.otherCalls, 0);
  });

  for (const code of ['GAME_STATE_CONFLICT', 'OPERATION_REQUEST_CONFLICT', 'GAME_ALREADY_FINISHED']) {
    test(`${name} definite retry rejection ${code} refreshes before unlocking`, async () => {
      const f = fixture();
      await f.c.enter();
      f.api.undo = async (_id: string, request: any) => {
        f.requests.push(request);
        if (f.requests.length === 1) return { version: 3, state: f.initial, reverted_turns: 2 };
        throw new ApiError(code, 409);
      };
      await f.c.undo();
      f.authority = { ...f.authority, version: 8, ply_count: 0, state: f.initial };
      await f.c.retry();
      assert.equal(f.c.snapshot.gameVersion, 8);
      assert.equal(f.c.snapshot.plyCount, 0);
      assert.deepEqual(f.requests[1], f.requests[0]);
      await f.c.tapNode('P01');
      assert.equal(f.otherCalls, 1);
      f.api.undo = async (_id: string, request: any) => {
        f.requests.push(request);
        return { version: 9, ply_count: 0, state: f.initial, reverted_turns: 0 };
      };
      assert.equal(await f.c.undo(), true);
      assert.notEqual(f.requests[2].client_request_id, f.requests[0].client_request_id);
      assert.equal(f.requests[2].expected_version, 8);
    });
  }
}
