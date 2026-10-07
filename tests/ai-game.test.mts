import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { NODE_IDS, RuleEngine, createInitialGameState } from '../miniprogram/domain/index.ts';
import type { GameState, NodeId, Player } from '../miniprogram/domain/index.ts';

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
const { mapGameStateToView } = await import('../miniprogram/pages/game/game-state-mapper.ts');
const { analyzePosition } = await import('../miniprogram/ai/position-analysis.ts');

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('Expected asynchronous state was not reached');
}

function fixture(aiPlayer: Player = 'B') {
  let state: GameState = createInitialGameState({ firstPlayer: 'A' });
  let saved: string | null = null;
  let creates = 0;
  let aiCalls = 0;
  let humanCalls = 0;
  let legalCalls = 0;
  let analysisCalls = 0;
  let coachCalls = 0;
  const game = () => ({ game_id: `g${creates}`, version: humanCalls + aiCalls,
    ply_count: humanCalls + aiCalls,
    state, mode: 'AI' as const,
    human_player: aiPlayer === 'A' ? 'B' as const : 'A' as const,
    ai_player: aiPlayer, ai_level: 'STANDARD' as const });
  const storage = { read: () => saved, write: (id: string) => { saved = id; },
    clear: () => { saved = null; } };
  const api = {
    createGame: async (request: any) => {
      creates++;
      state = createInitialGameState({ firstPlayer: request.first_player });
      return game();
    },
    getGame: async () => game(),
    getLegalMoves: async (_id: string, from: NodeId) => {
      legalCalls++;
      return { moves: RuleEngine.getAllLegalMoves(state).filter(move => move.from === from) };
    },
    move: async (_id: string, move: {from_node: NodeId; to_node: NodeId}) => {
      humanCalls++;
      const turn = RuleEngine.executeTurn(state, { from: move.from_node, to: move.to_node });
      state = turn.state;
      return { turn };
    },
    aiMove: async () => {
      aiCalls++;
      const move = RuleEngine.getAllLegalMoves(state)[0];
      const turn = RuleEngine.executeTurn(state, move);
      state = turn.state;
      return { search: { bestMove: move, scorePerspective: aiPlayer, timedOut: true,
        searchDepth: 1, thinkingTimeMs: 5 }, turn };
    },
    analyzeGame: async (id: string) => {
      analysisCalls++;
      return { game_id: id, game_version: humanCalls + aiCalls,
        ...analyzePosition(state, { maxDepth: 1, timeLimitMs: 1000, now: () => 0 }) };
    },
    getCoachHint: async (id: string, level: 1 | 2 | 3, expectedVersion: number) => {
      coachCalls++;
      const analysis = analyzePosition(state, { maxDepth: 1, timeLimitMs: 1000, now: () => 0 });
      return { gameId: id, gameVersion: expectedVersion, analyzedPlayer: state.current_player,
        level, hintText: `第 ${level} 级提示`, focusTopics: ['机动性'],
        candidateFromNodes: level >= 2 ? [analysis.candidateMoves[0].move.from] : [],
        bestMove: level === 3 ? analysis.bestMove : null,
        fallbackUsed: true, provider: 'fallback', model: null,
        promptVersion: 'coach_hint_v1' as const, generatedAt: new Date().toISOString() };
    },
  };
  return { api, storage, get state() { return state; }, set state(value: GameState) { state = value; },
    get saved() { return saved; }, get creates() { return creates; }, get aiCalls() { return aiCalls; },
    get humanCalls() { return humanCalls; }, get legalCalls() { return legalCalls; },
    get analysisCalls() { return analysisCalls; }, get coachCalls() { return coachCalls; } };
}

test('inaccessible stored game from an older device account is replaced', async () => {
  const f = fixture();
  f.storage.write('other-account-game');
  f.api.getGame = async () => { throw new ApiError('AUTH_FORBIDDEN', 403); };
  const controller = new AiGameController(f.api, f.storage, () => {});
  await controller.enter();
  assert.equal(f.creates, 1);
  assert.equal(f.saved, 'g1');
  assert.equal(controller.snapshot.gameId, 'g1');
  assert.equal(controller.snapshot.errorMessage, null);
});

test('coach reveals levels progressively, never moves, and clears after human move', async () => {
  const f = fixture();
  const controller = new AiGameController(f.api, f.storage, () => {});
  await controller.enter();
  const before = structuredClone(controller.snapshot.gameState);
  await controller.requestCoachHint();
  assert.equal(controller.snapshot.coachHint?.level, 1);
  assert.equal(controller.snapshot.coachHint?.bestMove, null);
  await controller.requestCoachHint();
  assert.equal(controller.snapshot.coachHint?.level, 2);
  assert.equal(controller.snapshot.coachHint?.bestMove, null);
  await controller.requestCoachHint();
  assert.equal(controller.snapshot.coachHint?.level, 3);
  assert.ok(controller.snapshot.coachHint?.bestMove);
  assert.deepEqual(controller.snapshot.gameState, before);
  assert.equal(f.humanCalls, 0);
  assert.equal(f.coachCalls, 3);
  await controller.tapNode('P01');
  await controller.tapNode('P02');
  assert.equal(controller.snapshot.coachHint, null);
  assert.equal(f.humanCalls, 1);
  assert.equal(f.aiCalls, 1);
});

test('pending coach locks board and restart until its result arrives', async () => {
  const f = fixture();
  const pending = deferred<any>();
  (f.api as any).getCoachHint = () => pending.promise;
  const controller = new AiGameController(f.api, f.storage, () => {});
  await controller.enter();
  const request = controller.requestCoachHint();
  await until(() => controller.snapshot.isCoachLoading);
  await controller.tapNode('P01');
  await controller.restart();
  assert.equal(controller.snapshot.selectedNode, null);
  assert.equal(f.creates, 1);
  assert.equal(f.legalCalls, 0);
  pending.resolve({ gameId: controller.snapshot.gameId, gameVersion: 0,
    analyzedPlayer: 'A', level: 1, hintText: '关注机动性',
    focusTopics: ['机动性'], candidateFromNodes: [], bestMove: null,
    fallbackUsed: true, provider: 'fallback', model: null,
    promptVersion: 'coach_hint_v1', generatedAt: new Date().toISOString() });
  await request;
  assert.equal(controller.snapshot.coachHint?.level, 1);
  assert.equal(controller.snapshot.isCoachLoading, false);
});

test('manual analysis uses current state and clears after the next real turn', async () => {
  const f = fixture();
  const controller = new AiGameController(f.api, f.storage, () => {});
  await controller.enter();
  const before = structuredClone(controller.snapshot.gameState);
  await controller.analyze();
  assert.equal(f.analysisCalls, 1);
  assert.deepEqual(controller.snapshot.gameState, before);
  assert.equal(controller.snapshot.analysis?.analyzedPlayer, 'A');
  assert.ok(controller.snapshot.analysis?.candidateMoves.length);
  const move = RuleEngine.getAllLegalMoves(f.state)[0];
  await controller.tapNode(move.from);
  await controller.tapNode(move.to);
  assert.equal(controller.snapshot.analysis, null);
  assert.equal(f.analysisCalls, 1);
});

test('pending analysis blocks board actions and restart and ignores late result after unload', async () => {
  const f = fixture();
  const pending = deferred<any>();
  f.api.analyzeGame = async () => pending.promise;
  const controller = new AiGameController(f.api, f.storage, () => {});
  await controller.enter();
  const request = controller.analyze();
  await until(() => controller.snapshot.isAnalyzing);
  await controller.tapNode('P01');
  await controller.restart('B');
  assert.equal(f.legalCalls, 0);
  assert.equal(f.creates, 1);
  controller.dispose();
  pending.resolve({ game_id: 'g1', game_version: 0,
    ...analyzePosition(f.state, { maxDepth: 1, timeLimitMs: 1000, now: () => 0 }) });
  await request;
  assert.equal(controller.snapshot.analysis, null);
});

test('stale analysis response resynchronizes the game before another analysis', async () => {
  const f = fixture();
  const controller = new AiGameController(f.api, f.storage, () => {});
  await controller.enter();
  const originalGet = f.api.getGame;
  f.api.getGame = async () => ({ ...await originalGet(), version: 1 });
  f.api.analyzeGame = async (_id: string, expectedVersion?: number) => {
    assert.equal(expectedVersion, 0);
    f.state = RuleEngine.executeTurn(f.state, { from: 'P01', to: 'P02' }).state;
    throw new ApiError('GAME_STATE_CONFLICT', 409);
  };
  await controller.analyze();
  assert.equal(controller.snapshot.analysis, null);
  assert.equal(controller.snapshot.gameVersion, 2);
  assert.equal(controller.snapshot.gameState?.current_player, 'A');
  assert.equal(f.aiCalls, 1);
});

test('human first automatically completes two human and AI rounds from server turns', async () => {
  const f = fixture();
  const controller = new AiGameController(f.api, f.storage, () => {});
  await controller.enter();
  assert.equal(controller.snapshot.humanPlayer, 'A');
  assert.equal(controller.snapshot.aiPlayer, 'B');
  for (let round = 0; round < 2; round++) {
    const move = RuleEngine.getAllLegalMoves(f.state)[0];
    await controller.tapNode(move.from);
    assert.ok(controller.snapshot.legalTargets.includes(move.to));
    await controller.tapNode(move.to);
    assert.equal(controller.snapshot.gameState, f.state);
    assert.equal(controller.snapshot.gameState?.current_player, 'A');
  }
  assert.equal(f.humanCalls, 2);
  assert.equal(f.aiCalls, 2);
  assert.equal(controller.snapshot.lastSearch?.timedOut, true);
  assert.equal(controller.snapshot.errorMessage, null);
  assert.ok(controller.snapshot.lastMove);
});

test('AI first starts automatically and prevents duplicate AI requests', async () => {
  const f = fixture();
  const pending = deferred<any>();
  const realAi = f.api.aiMove;
  f.api.aiMove = async () => { const result = await pending.promise; return result; };
  const controller = new AiGameController(f.api, f.storage, () => {});
  const entering = controller.enter('B');
  await until(() => controller.snapshot.isAiThinking);
  assert.equal(controller.snapshot.isAiThinking, true);
  const before = f.legalCalls;
  await controller.tapNode('P05');
  await controller.enter('B');
  await controller.restart('A');
  assert.equal(f.legalCalls, before);
  assert.equal(f.creates, 1);
  f.api.aiMove = realAi;
  pending.resolve(await realAi());
  await entering;
  assert.equal(controller.snapshot.gameState?.current_player, 'A');
  assert.equal(controller.snapshot.isAiThinking, false);
  assert.equal(f.aiCalls, 1);
});

test('AI identity is restored from server and AI turn resumes once after reopen', async () => {
  const f = fixture('A');
  const first = new AiGameController(f.api, f.storage, () => {}, { aiPlayer: 'A' });
  await first.enter('B');
  assert.equal(first.snapshot.humanPlayer, 'B');
  first.dispose();
  f.state = { ...f.state, current_player: 'A' };
  const reopened = new AiGameController(f.api, f.storage, () => {});
  await reopened.enter();
  assert.equal(f.creates, 1);
  assert.equal(f.aiCalls, 1);
  assert.equal(reopened.snapshot.aiPlayer, 'A');
  assert.equal(reopened.snapshot.gameState?.current_player, 'B');
});

test('restoring an already completed AI turn does not submit another AI move', async () => {
  const f = fixture();
  const first = new AiGameController(f.api, f.storage, () => {});
  await first.enter();
  first.dispose();
  f.state = RuleEngine.executeTurn(f.state, { from: 'P01', to: 'P02' }).state;
  await f.api.aiMove();
  const callsBefore = f.aiCalls;
  const reopened = new AiGameController(f.api, f.storage, () => {});
  await reopened.enter();
  assert.equal(reopened.snapshot.gameState?.current_player, 'A');
  assert.equal(f.aiCalls, callsBefore);
});

test('AI network timeout GETs before retry and never invents a move', async () => {
  const f = fixture();
  const controller = new AiGameController(f.api, f.storage, () => {});
  await controller.enter();
  let gets = 0;
  f.api.getGame = async () => { gets++; return { game_id: 'g1', version: 0, ply_count: 0, state: f.state,
    mode: 'AI' as const, human_player: 'A' as const, ai_player: 'B' as const,
    ai_level: 'STANDARD' as const }; };
  f.api.aiMove = async () => { throw new ApiError('NETWORK_ERROR', 0); };
  const move = RuleEngine.getAllLegalMoves(f.state)[0];
  await controller.tapNode(move.from);
  await controller.tapNode(move.to);
  assert.equal(gets, 1);
  assert.equal(controller.snapshot.gameState, f.state);
  assert.equal(controller.snapshot.isAiThinking, false);
  assert.equal(controller.snapshot.gameState?.current_player, 'B');
  assert.match(controller.snapshot.errorMessage ?? '', /网络/);
  const before = f.legalCalls;
  await controller.tapNode('P05');
  assert.equal(f.legalCalls, before);
});

test('failed GET after lost Human response locks stale board until successful resync', async () => {
  const f = fixture();
  const controller = new AiGameController(f.api, f.storage, () => {});
  await controller.enter();
  f.api.move = async () => { throw new ApiError('NETWORK_ERROR', 0); };
  f.api.getGame = async () => { throw new ApiError('NETWORK_ERROR', 0); };
  await controller.tapNode('P01');
  await controller.tapNode('P02');
  assert.equal(controller.snapshot.needsResync, true);
  const legalBefore = f.legalCalls;
  await controller.tapNode('P06');
  assert.equal(f.legalCalls, legalBefore);
  f.api.getGame = async () => ({ game_id: 'g1', version: 0, ply_count: 0, state: f.state, mode: 'AI' as const,
    human_player: 'A' as const, ai_player: 'B' as const, ai_level: 'STANDARD' as const });
  await controller.enter();
  assert.equal(controller.snapshot.needsResync, false);
  assert.equal(controller.snapshot.gameState, f.state);
});

test('human move response loss also GETs server before another move', async () => {
  const f = fixture();
  const controller = new AiGameController(f.api, f.storage, () => {});
  await controller.enter();
  let gets = 0;
  f.api.getGame = async () => { gets++; return { game_id: 'g1', version: 0, ply_count: 0, state: f.state,
    mode: 'AI' as const, human_player: 'A' as const, ai_player: 'B' as const,
    ai_level: 'STANDARD' as const }; };
  f.api.move = async (_id: string, move: {from_node: NodeId; to_node: NodeId}) => {
    const turn = RuleEngine.executeTurn(f.state, { from: move.from_node, to: move.to_node });
    f.state = turn.state;
    throw new ApiError('NETWORK_ERROR', 0);
  };
  const move = RuleEngine.getAllLegalMoves(f.state)[0];
  await controller.tapNode(move.from);
  await controller.tapNode(move.to);
  assert.ok(gets >= 1);
  assert.equal(controller.snapshot.gameState, f.state);
  assert.equal(controller.snapshot.gameState?.current_player, 'A');
});

test('disposed AI page ignores late search result', async () => {
  const f = fixture();
  const pending = deferred<any>();
  f.api.aiMove = async () => pending.promise;
  let updates = 0;
  const controller = new AiGameController(f.api, f.storage, () => { updates++; });
  const loading = controller.enter('B');
  await until(() => controller.snapshot.isAiThinking);
  const before = updates;
  controller.dispose();
  pending.reject(new ApiError('NETWORK_ERROR', 0));
  await loading;
  assert.equal(updates, before);
});

for (const [pieces, from, to, reason] of [
  [{ P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A' }, 'P19', 'P13', 'CAPTURE_ALL'],
  [{ P27: 'B', P26: 'A', P28: 'A', P29: 'A', P03: 'A', P21: 'A' },
    'P21', 'P22', 'TEMPLE_TRAP'],
  [{ P03: 'B', P02: 'A', P04: 'A', P27: 'A', P08: 'A', P09: 'A',
    P07: 'A', P26: 'A', P28: 'A', P21: 'A' },
    'P21', 'P22', 'LONE_PIECE_IMMOBILIZED'],
] as const) {
  test(`human ${reason} terminal displays server winner and never starts AI`, async () => {
    const f = fixture();
    const controller = new AiGameController(f.api, f.storage, () => {});
    await controller.enter();
    const occupancy = { ...f.state.board.occupancy };
    for (const node of NODE_IDS) occupancy[node] = null;
    Object.assign(occupancy, pieces);
    f.state = { ...f.state, board: { occupancy } };
    await controller.enter();
    await controller.tapNode(from);
    await controller.tapNode(to);
    assert.equal(controller.snapshot.gameState?.winner_reason, reason);
    assert.equal(f.aiCalls, 0);
    assert.equal(mapGameStateToView(controller.snapshot.gameState!).gameOver, true);
    if (reason === 'CAPTURE_ALL') {
      assert.equal(controller.snapshot.lastCapture?.was_applied, true);
      assert.ok(controller.snapshot.gameState!.players.A.reserve_count < 4);
    }
    const before = f.legalCalls;
    await controller.tapNode(to);
    assert.equal(f.legalCalls, before);
  });
}

test('AI terminal result updates capture, reserve and blocks further human input', async () => {
  const f = fixture('A');
  const controller = new AiGameController(f.api, f.storage, () => {}, { aiPlayer: 'A' });
  await controller.enter('B');
  const occupancy = { ...f.state.board.occupancy };
  for (const node of NODE_IDS) occupancy[node] = null;
  Object.assign(occupancy, { P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A' });
  f.state = { ...f.state, board: { occupancy }, current_player: 'A' };
  f.api.aiMove = async () => {
    const turn = RuleEngine.executeTurn(f.state, { from: 'P19', to: 'P13' });
    f.state = turn.state;
    return { search: { bestMove: turn.move, scorePerspective: 'A' as const,
      timedOut: false, searchDepth: 1, thinkingTimeMs: 5 }, turn };
  };
  await controller.enter();
  assert.equal(controller.snapshot.gameState?.winner, 'A');
  assert.equal(controller.snapshot.gameState?.winner_reason, 'CAPTURE_ALL');
  assert.equal(controller.snapshot.lastCapture?.was_applied, true);
  assert.ok(controller.snapshot.gameState!.players.A.reserve_count < 4);
  assert.equal(mapGameStateToView(controller.snapshot.gameState!).winnerMessage,
    '红方棋子已全部被吃');
  const before = f.legalCalls;
  await controller.tapNode('P12');
  assert.equal(f.legalCalls, before);
});
