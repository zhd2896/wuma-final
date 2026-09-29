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

const { ApiError } = await import('../miniprogram/services/api-client.ts');
const { IndependentCoachController } = await import(
  '../miniprogram/pages/coach/coach-controller.ts');

function aiGame(id = 'ai-1', version = 4, state = createInitialGameState()) {
  return { game_id: id, version, state, mode: 'AI' as const,
    human_player: 'A' as const, ai_player: 'B' as const, ai_level: 'STANDARD' as const };
}

function hint(gameId: string, version: number, level: 1 | 2 | 3) {
  return { gameId, gameVersion: version, analyzedPlayer: 'A' as const, level,
    hintText: `真实第 ${level} 级提示`,
    focusTopics: level === 1 ? ['机动性'] : [],
    candidateFromNodes: level >= 2 ? ['P01' as const] : [],
    bestMove: level === 3 ? { from: 'P01' as const, to: 'P02' as const } : null,
    fallbackUsed: true, provider: 'engine', model: null,
    promptVersion: 'coach_hint_v1' as const, generatedAt: new Date(0).toISOString() };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

test('loads the active authoritative AI game and explicit id takes priority', async () => {
  const calls: unknown[][] = [];
  const writes: string[] = [];
  const controller = new IndependentCoachController({
    api: {
      getGame: async id => { calls.push(['getGame', id]); return aiGame(id); },
      getCoachHint: async () => { throw new Error('unexpected'); },
    },
    readActiveAiId: () => 'active-ai', writeActiveAiId: id => { writes.push(id); },
    onChange: () => {},
  });

  await controller.enter();
  assert.deepEqual(calls, [['getGame', 'active-ai']]);
  assert.equal(controller.snapshot.state, 'ready');
  assert.equal(controller.snapshot.gameVersion, 4);
  assert.equal(controller.snapshot.gameState?.current_player, 'A');

  await controller.enter({ gameId: 'explicit-ai' });
  assert.deepEqual(calls[1], ['getGame', 'explicit-ai']);
  assert.equal(controller.snapshot.gameId, 'explicit-ai');
  assert.deepEqual(writes, ['active-ai', 'explicit-ai']);
});

test('reports empty, rejects non-AI games, and marks finished or AI-turn games unavailable', async () => {
  const empty = new IndependentCoachController({
    api: { getGame: async () => { throw new Error('unexpected'); },
      getCoachHint: async () => { throw new Error('unexpected'); } },
    readActiveAiId: () => null, writeActiveAiId: () => {}, onChange: () => {},
  });
  await empty.enter();
  assert.equal(empty.snapshot.state, 'empty');

  const nonAi = new IndependentCoachController({
    api: { getGame: async id => ({ ...aiGame(id), mode: 'LOCAL' as const,
      human_player: null, ai_player: null, ai_level: null }),
    getCoachHint: async () => { throw new Error('unexpected'); } },
    readActiveAiId: () => 'local-1', writeActiveAiId: () => {}, onChange: () => {},
  });
  await nonAi.enter();
  assert.equal(nonAi.snapshot.state, 'error');
  assert.match(nonAi.snapshot.errorMessage, /不支持 AI 教练/);

  const aiTurnState = { ...createInitialGameState(), current_player: 'B' as const };
  const aiTurn = new IndependentCoachController({
    api: { getGame: async id => aiGame(id, 2, aiTurnState),
      getCoachHint: async () => { throw new Error('unexpected'); } },
    readActiveAiId: () => 'ai-turn', writeActiveAiId: () => {}, onChange: () => {},
  });
  await aiTurn.enter();
  assert.equal(aiTurn.snapshot.state, 'unavailable');
  assert.match(aiTurn.snapshot.notice, /轮到 AI/);

  const finishedState = { ...createInitialGameState(), game_status: 'FINISHED' as const,
    winner: 'A' as const, winner_reason: 'CAPTURE_ALL' as const };
  const finished = new IndependentCoachController({
    api: { getGame: async id => aiGame(id, 3, finishedState),
      getCoachHint: async () => { throw new Error('unexpected'); } },
    readActiveAiId: () => 'finished', writeActiveAiId: () => {}, onChange: () => {},
  });
  await finished.enter();
  assert.equal(finished.snapshot.state, 'unavailable');
  assert.match(finished.snapshot.notice, /已结束/);
});

test('rejects a mismatched game id, invalid players, or non-integer authoritative version', async () => {
  for (const game of [aiGame('other-id', 4), aiGame('ai-1', 1.5),
    { ...aiGame('ai-1', 4), ai_player: 'A' as const }]) {
    const controller = new IndependentCoachController({
      api: { getGame: async () => game,
        getCoachHint: async () => { throw new Error('unexpected'); } },
      readActiveAiId: () => 'ai-1', writeActiveAiId: () => {}, onChange: () => {},
    });
    await controller.enter();
    assert.equal(controller.snapshot.state, 'error');
    assert.equal(controller.snapshot.gameState, null);
  }
});

test('requests three real levels in order for the authoritative version without duplicates', async () => {
  const calls: unknown[][] = [];
  const controller = new IndependentCoachController({
    api: { getGame: async id => aiGame(id, 7),
      getCoachHint: async (id, level, version) => {
        calls.push(['getCoachHint', id, level, version]);
        return hint(id, version, level);
      } },
    readActiveAiId: () => 'ai-1', writeActiveAiId: () => {}, onChange: () => {},
  });
  await controller.enter();
  await controller.requestLevel(2);
  assert.deepEqual(calls, []);
  await controller.requestLevel(1);
  await controller.requestLevel(1);
  await controller.requestLevel(2);
  await controller.requestLevel(3);
  assert.deepEqual(calls, [
    ['getCoachHint', 'ai-1', 1, 7],
    ['getCoachHint', 'ai-1', 2, 7],
    ['getCoachHint', 'ai-1', 3, 7],
  ]);
  assert.deepEqual(controller.snapshot.hints.map(item => item.level), [1, 2, 3]);
  assert.deepEqual(controller.snapshot.hints[2].bestMove, { from: 'P01', to: 'P02' });
});

test('rejects mismatched hint identity without unlocking the next level', async () => {
  const mismatches = [
    { gameId: 'other-id' },
    { gameVersion: 6 },
    { analyzedPlayer: 'B' as const },
    { level: 2 as const },
  ];
  for (const mismatch of mismatches) {
    const controller = new IndependentCoachController({
      api: { getGame: async id => aiGame(id, 5),
        getCoachHint: async (id, level, version) => ({ ...hint(id, version, level),
          ...mismatch }) },
      readActiveAiId: () => 'ai-1', writeActiveAiId: () => {}, onChange: () => {},
    });
    await controller.enter();
    await controller.requestLevel(1);
    assert.deepEqual(controller.snapshot.hints, []);
    assert.match(controller.snapshot.errorMessage, /当前棋局不一致/);
    await controller.requestLevel(2);
    assert.deepEqual(controller.snapshot.hints, []);
  }
});

test('conflict reloads the authoritative game, clears hints, and requires level one again', async () => {
  let version = 1;
  let requests = 0;
  const controller = new IndependentCoachController({
    api: { getGame: async id => aiGame(id, version),
      getCoachHint: async (id, level, expected) => {
        requests++;
        if (requests === 2) { version = 2; throw new ApiError('GAME_STATE_CONFLICT', 409); }
        return hint(id, expected, level);
      } },
    readActiveAiId: () => 'ai-1', writeActiveAiId: () => {}, onChange: () => {},
  });
  await controller.enter();
  await controller.requestLevel(1);
  assert.deepEqual(controller.snapshot.hints.map(item => item.level), [1]);
  await controller.requestLevel(2);
  assert.equal(controller.snapshot.state, 'conflict');
  assert.equal(controller.snapshot.gameVersion, 2);
  assert.deepEqual(controller.snapshot.hints, []);
  assert.match(controller.snapshot.notice, /一级提示重新开始/);
  await controller.retry();
  await controller.requestLevel(1);
  assert.deepEqual(controller.snapshot.hints.map(item => item.level), [1]);
});

test('duplicate loading and disposal prevent late hints from publishing', async () => {
  const pending = deferred<ReturnType<typeof hint>>();
  let calls = 0;
  let changes = 0;
  const controller = new IndependentCoachController({
    api: { getGame: async id => aiGame(id, 1),
      getCoachHint: async () => { calls++; return pending.promise; } },
    readActiveAiId: () => 'ai-1', writeActiveAiId: () => {},
    onChange: () => { changes++; },
  });
  await controller.enter();
  const first = controller.requestLevel(1);
  await Promise.resolve();
  await controller.requestLevel(1);
  assert.equal(calls, 1);
  const beforeDispose = changes;
  controller.dispose();
  pending.resolve(hint('ai-1', 1, 1));
  await first;
  assert.equal(changes, beforeDispose);
});

test('visibility refresh cancels an in-flight hint and loads the newest version', async () => {
  const pending = deferred<ReturnType<typeof hint>>();
  let version = 1;
  let getCalls = 0;
  const controller = new IndependentCoachController({
    api: { getGame: async id => { getCalls++; return aiGame(id, version); },
      getCoachHint: async () => pending.promise },
    readActiveAiId: () => 'ai-1', writeActiveAiId: () => {}, onChange: () => {},
  });
  await controller.enter();
  const oldHint = controller.requestLevel(1);
  await Promise.resolve();
  version = 2;
  await controller.refresh();
  assert.equal(getCalls, 2);
  assert.equal(controller.snapshot.state, 'ready');
  assert.equal(controller.snapshot.gameVersion, 2);
  assert.deepEqual(controller.snapshot.hints, []);

  pending.resolve(hint('ai-1', 1, 1));
  await oldHint;
  assert.equal(controller.snapshot.gameVersion, 2);
  assert.deepEqual(controller.snapshot.hints, []);
});
