import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { createInitialGameState } from '../miniprogram/domain/index.ts';

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

const { analyzePosition } = await import('../miniprogram/ai/position-analysis.ts');
const { ApiError } = await import('../miniprogram/services/api-client.ts');
const { IndependentAnalysisController } = await import(
  '../miniprogram/pages/analysis/analysis-controller.ts');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

function localEntry(id = 'local-1') {
  const state = createInitialGameState();
  return { id, mode: 'local' as const, startedAt: 1, updatedAt: 1, turns: 0,
    status: state.game_status, winner: null, winnerReason: null, localState: state,
    lastMove: null };
}

test('online source restores a bound seat and analyzes actual room version without generic APIs', async () => {
  const entry = localEntry();
  const analysis = analyzePosition(entry.localState, { maxDepth: 1, timeLimitMs: 1000, now: () => 0 });
  const calls: unknown[] = [];
  const controller = new IndependentAnalysisController({
    api: { getGame: async () => { throw new Error('generic API forbidden'); },
      analyzeGame: async () => { throw new Error('generic API forbidden'); } },
    restoreOnline: async id => ({ token: 'own-token', room: {
      game_id: id, seat: 'B', version: 7, room_status: 'PLAYING', state: entry.localState } }),
    analyzeOnline: async (id, token, version) => { calls.push([id, token, version]);
      return { ...analysis, game_id: id, game_version: version }; },
    readIdentity: () => 'account-1',
    readLocalGame: () => { throw new Error('online cannot read local'); }, readActiveLocalId: () => null,
    onChange: () => {},
  });
  await controller.enter({ mode: 'online', gameId: 'room-1' });
  assert.equal(controller.snapshot.state, 'success');
  assert.equal(controller.snapshot.seat, 'B');
  assert.deepEqual(calls, [['room-1', 'own-token', 7]]);
});

test('online account switch discards late analysis and unavailable rooms never analyze', async () => {
  const entry = localEntry(); let identity = 'a'; const reply = deferred<any>();
  const controller = new IndependentAnalysisController({
    api: { getGame: async () => { throw new Error('generic'); }, analyzeGame: async () => { throw new Error('generic'); } },
    restoreOnline: async id => ({ token: 'token', room: { game_id: id, seat: 'A', version: 0,
      room_status: 'PLAYING', state: entry.localState } }), analyzeOnline: () => reply.promise,
    readIdentity: () => identity, readLocalGame: () => null, readActiveLocalId: () => null, onChange: () => {},
  });
  const pending = controller.enter({ mode: 'online', gameId: 'room' });
  await Promise.resolve(); identity = 'b';
  reply.resolve({ ...analyzePosition(entry.localState), game_id: 'room', game_version: 0 }); await pending;
  assert.notEqual(controller.snapshot.state, 'success');
  for (const status of ['WAITING', 'CANCELLED', 'EXPIRED']) {
    let calls = 0;
    const waiting = new IndependentAnalysisController({
      api: { getGame: async () => { throw new Error('generic'); }, analyzeGame: async () => { throw new Error('generic'); } },
      restoreOnline: async id => ({ token: 'token', room: { game_id: id, seat: 'A', version: 0,
        room_status: status, state: entry.localState } }), analyzeOnline: async () => { calls++; throw new Error('unavailable'); },
      readLocalGame: () => null, readActiveLocalId: () => null, onChange: () => {},
    });
    await waiting.enter({ mode: 'online', gameId: 'room' });
    assert.equal(waiting.snapshot.state, 'error'); assert.equal(calls, 0);
  }
});

test('local source analyzes the exact saved state without calling the server', async () => {
  const entry = localEntry();
  let localCalls = 0;
  const states: string[] = [];
  const controller = new IndependentAnalysisController({
    api: {
      getGame: async () => { throw new Error('server must stay offline'); },
      analyzeGame: async () => { throw new Error('server must stay offline'); },
    },
    readLocalGame: id => id === entry.id ? entry : null,
    readActiveLocalId: () => null,
    analyzeLocal: state => { localCalls++; assert.equal(state, entry.localState);
      return analyzePosition(state, { maxDepth: 1, timeLimitMs: 1000, now: () => 0 }); },
    onChange: snapshot => { states.push(snapshot.state); },
  });

  await controller.enter({ mode: 'local', gameId: entry.id });

  assert.equal(localCalls, 1);
  assert.deepEqual(states, ['loading', 'success']);
  assert.equal(controller.snapshot.gameId, entry.id);
  assert.equal(controller.snapshot.view?.board.pieces.length, 10);
});

test('local source falls back to active game and reports empty for no valid record', async () => {
  const entry = localEntry('active-local');
  const controller = new IndependentAnalysisController({
    api: { getGame: async () => { throw new Error('unexpected'); },
      analyzeGame: async () => { throw new Error('unexpected'); } },
    readLocalGame: id => id === entry.id ? entry : null,
    readActiveLocalId: () => entry.id,
    analyzeLocal: state => analyzePosition(state,
      { maxDepth: 1, timeLimitMs: 1000, now: () => 0 }),
    onChange: () => {},
  });
  await controller.enter({ mode: 'local' });
  assert.equal(controller.snapshot.state, 'success');
  assert.equal(controller.snapshot.gameId, entry.id);

  const empty = new IndependentAnalysisController({
    api: { getGame: async () => { throw new Error('unexpected'); },
      analyzeGame: async () => { throw new Error('unexpected'); } },
    readLocalGame: () => null, readActiveLocalId: () => null,
    analyzeLocal: state => analyzePosition(state), onChange: () => {},
  });
  await empty.enter({ mode: 'local' });
  assert.equal(empty.snapshot.state, 'empty');
  assert.equal(empty.snapshot.view, null);
});

test('active local storage failure becomes a retryable page error', async () => {
  const controller = new IndependentAnalysisController({
    api: { getGame: async () => { throw new Error('unexpected'); },
      analyzeGame: async () => { throw new Error('unexpected'); } },
    readLocalGame: () => null,
    readActiveLocalId: () => { throw new Error('storage damaged'); },
    analyzeLocal: state => analyzePosition(state), onChange: () => {},
  });
  await controller.enter({ mode: 'local' });
  assert.equal(controller.snapshot.state, 'error');
  assert.match(controller.snapshot.errorMessage, /本地棋局/);
});

test('server source reads the authoritative version before requesting analysis', async () => {
  const state = createInitialGameState();
  const analysis = analyzePosition(state,
    { maxDepth: 1, timeLimitMs: 1000, now: () => 0 });
  const calls: unknown[][] = [];
  const controller = new IndependentAnalysisController({
    api: {
      getGame: async id => { calls.push(['getGame', id]); return {
        game_id: id, version: 7, state, mode: 'LOCAL', human_player: null,
        ai_player: null, ai_level: null } as const; },
      analyzeGame: async (id, version) => { calls.push(['analyzeGame', id, version]);
        return { game_id: id, game_version: 7, ...analysis }; },
    },
    readLocalGame: () => null, readActiveLocalId: () => null,
    analyzeLocal: value => analyzePosition(value), onChange: () => {},
  });

  await controller.enter({ mode: 'remote', gameId: 'server-1' });

  assert.deepEqual(calls, [
    ['getGame', 'server-1'],
    ['analyzeGame', 'server-1', 7],
  ]);
  assert.equal(controller.snapshot.state, 'success');
  assert.equal(controller.snapshot.gameVersion, 7);
});

test('saved AI games use authoritative human seats for both analysis perspectives', async () => {
  for (const human of ['A', 'B'] as const) for (const current of ['A', 'B'] as const) {
    const state = createInitialGameState({ firstPlayer: current });
    const analysis = analyzePosition(state, { maxDepth: 1, timeLimitMs: 0, now: () => 0 });
    const controller = new IndependentAnalysisController({
      api: {
        getGame: async id => ({ game_id: id, version: 1, ply_count: 0, state,
          mode: 'AI', human_player: human, ai_player: human === 'A' ? 'B' : 'A', ai_level: 'STANDARD' }),
        analyzeGame: async id => ({ game_id: id, game_version: 1, ...analysis }),
      },
      readLocalGame: () => null, readActiveLocalId: () => null, onChange: () => {},
    });
    await controller.enter({ mode: 'remote', gameId: 'saved-ai' });
    assert.equal(controller.snapshot.state, 'success');
    assert.equal(controller.snapshot.view!.perspectiveLabel, current === human ? '你' : 'AI');
    assert.equal(controller.snapshot.view!.bestScore, analysis.bestScore);
  }
});

test('server conflict discards stale results and retry reloads the new version', async () => {
  const state = createInitialGameState();
  const analysis = analyzePosition(state,
    { maxDepth: 1, timeLimitMs: 1000, now: () => 0 });
  let version = 3;
  let analysisCalls = 0;
  const controller = new IndependentAnalysisController({
    api: {
      getGame: async id => ({ game_id: id, version, state, mode: 'LOCAL' as const,
        human_player: null, ai_player: null, ai_level: null }),
      analyzeGame: async (id, expected) => {
        analysisCalls++;
        if (analysisCalls === 1) throw new ApiError('GAME_STATE_CONFLICT', 409);
        return { game_id: id, game_version: expected!, ...analysis };
      },
    },
    readLocalGame: () => null, readActiveLocalId: () => null,
    analyzeLocal: value => analyzePosition(value), onChange: () => {},
  });
  await controller.enter({ mode: 'remote', gameId: 'server-1' });
  assert.equal(controller.snapshot.state, 'conflict');
  assert.equal(controller.snapshot.view, null);
  version = 4;
  await controller.retry();
  assert.equal(controller.snapshot.state, 'success');
  assert.equal(controller.snapshot.gameVersion, 4);
});

test('duplicate loading and disposed late response cannot overwrite state', async () => {
  const state = createInitialGameState();
  const pending = deferred<any>();
  let getCalls = 0;
  let changes = 0;
  const controller = new IndependentAnalysisController({
    api: {
      getGame: async id => { getCalls++; return { game_id: id, version: 1, state,
        mode: 'LOCAL' as const, human_player: null, ai_player: null, ai_level: null }; },
      analyzeGame: () => pending.promise,
    },
    readLocalGame: () => null, readActiveLocalId: () => null,
    analyzeLocal: value => analyzePosition(value), onChange: () => { changes++; },
  });
  const first = controller.enter({ mode: 'remote', gameId: 'server-1' });
  await new Promise(resolve => setImmediate(resolve));
  await controller.enter({ mode: 'remote', gameId: 'server-1' });
  assert.equal(getCalls, 1);
  const beforeDispose = changes;
  controller.dispose();
  pending.resolve({ game_id: 'server-1', game_version: 1,
    ...analyzePosition(state, { maxDepth: 1, timeLimitMs: 1000, now: () => 0 }) });
  await first;
  assert.equal(changes, beforeDispose);
});
