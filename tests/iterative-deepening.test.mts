import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { NODE_IDS, RuleEngine, createInitialGameState } from '../miniprogram/domain/index.ts';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); } catch (error) {
      if (specifier.startsWith('.') && context.parentURL &&
          (error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') {
        const url = new URL(`${specifier}.ts`, context.parentURL);
        if (existsSync(url)) return nextResolve(url.href, context);
      }
      throw error;
    }
  },
});

const { IterativeDeepeningAI, SearchTimeoutError } =
  await import('../miniprogram/ai/iterative-deepening.ts');
const { AlphaBetaAI } = await import('../miniprogram/ai/alpha-beta.ts');
const { RuleAmbiguityError } = await import('../miniprogram/ai/minimax.ts');
const { DEFAULT_EVALUATION_CONFIG, evaluatePosition } =
  await import('../miniprogram/ai/evaluation.ts');
const { TranspositionTable } = await import('../miniprogram/ai/transposition-table.ts');
const { hashGameState, stateSignature } = await import('../miniprogram/ai/zobrist.ts');

function withPieces(pieces: Record<string, 'A' | 'B'>, currentPlayer: 'A' | 'B' = 'A') {
  const initial = createInitialGameState({ firstPlayer: currentPlayer });
  const occupancy = { ...initial.board.occupancy };
  for (const node of NODE_IDS) occupancy[node] = null;
  for (const [node, player] of Object.entries(pieces)) {
    occupancy[node as typeof NODE_IDS[number]] = player;
  }
  return { ...initial, board: { occupancy } };
}

const neutralConfig = {
  ...DEFAULT_EVALUATION_CONFIG,
  materialWeight: 0, reserveWeight: 0, mobilityWeight: 0,
  templeControlWeight: 0, captureOpportunityWeight: 0,
  vulnerabilityWeight: 0, trapRiskWeight: 0,
};

test('completed depths 1–3 match fixed ordered Alpha-Beta with TT for both perspectives', t => {
  const fixtures = [
    withPieces({ P01: 'A', P06: 'A', P05: 'B', P10: 'B' }),
    withPieces({ P27: 'B', P08: 'A', P26: 'A', P28: 'A' }, 'B'),
  ];
  for (const state of fixtures) for (const rootPlayer of ['A', 'B'] as const) {
    const snapshot = structuredClone(state);
    for (const depth of [1, 2, 3]) {
      const fixed = new AlphaBetaAI({ depth, useMoveOrdering: true,
        useTranspositionTable: true }).search(state, rootPlayer);
      const iterative = new IterativeDeepeningAI({ maxDepth: depth,
        timeLimitMs: 1000, now: () => 0 }).search(state, rootPlayer);
      assert.equal(iterative.searchDepth, depth);
      assert.equal(iterative.timedOut, false);
      assert.equal(iterative.evaluationScore, fixed.evaluationScore);
      assert.deepEqual(iterative.bestMove, fixed.bestMove);
      assert.deepEqual(iterative.candidateMoves, fixed.candidateMoves);
      assert.equal(iterative.scorePerspective, rootPlayer);
      assert.equal(iterative.algorithm, 'ITERATIVE_DEEPENING_ALPHA_BETA');
      if (state === fixtures[0] && rootPlayer === 'A') {
        t.diagnostic(JSON.stringify({
          fixture: 'P01/P06 A versus P05/P10 B', depth,
          fixedScore: fixed.evaluationScore, iterativeScore: iterative.evaluationScore,
          fixedBestMove: fixed.bestMove, iterativeBestMove: iterative.bestMove,
          match: true,
        }));
      }
    }
    assert.deepEqual(state, snapshot);
  }
});

test('clock timeout keeps the last complete result and counts partial work', () => {
  const state = withPieces({ P01: 'A', P06: 'A', P05: 'B', P10: 'B' });
  let calls = 0;
  const full = new IterativeDeepeningAI({ maxDepth: 2, timeLimitMs: 100,
    now: () => { calls++; return 0; } }).search(state);
  const completedCalls = calls;
  calls = 0;
  const timed = new IterativeDeepeningAI({ maxDepth: 3, timeLimitMs: 100,
    now: () => ++calls > completedCalls + 2 ? 100 : 0 }).search(state);
  assert.equal(timed.searchDepth, 2);
  assert.equal(timed.timedOut, true);
  assert.deepEqual(timed.bestMove, full.bestMove);
  assert.equal(timed.evaluationScore, full.evaluationScore);
  assert.deepEqual(timed.candidateMoves, full.candidateMoves);
  assert.ok(timed.nodesSearched > full.nodesSearched);
  assert.ok(timed.ttHits >= full.ttHits);
  assert.ok(timed.thinkingTimeMs >= 100);
});

test('zero budget and root timeout return a legal depth-zero fallback', () => {
  const state = withPieces({ P01: 'A', P06: 'A', P05: 'B', P10: 'B' });
  const snapshot = structuredClone(state);
  let tick = 0;
  for (const options of [
    { maxDepth: 3, timeLimitMs: 0, now: () => 0 },
    { maxDepth: 3, timeLimitMs: 1, now: () => ++tick },
  ]) {
    const result = new IterativeDeepeningAI(options).search(state);
    assert.equal(result.searchDepth, 0);
    assert.equal(result.timedOut, true);
    assert.deepEqual(result.bestMove, RuleEngine.getAllLegalMoves(state)[0]);
    assert.equal(result.evaluationScore, evaluatePosition(state, 'A').score);
    assert.deepEqual(result.candidateMoves, []);
    assert.equal(result.nodesSearched, 0);
  }
  assert.deepEqual(state, snapshot);
});

test('timeout during depth one retains no partial candidate score', () => {
  const state = withPieces({ P01: 'A', P06: 'A', P05: 'B', P10: 'B' });
  let calls = 0;
  const result = new IterativeDeepeningAI({ maxDepth: 3,
    timeLimitMs: 1, now: () => ++calls >= 7 ? 1 : 0 }).search(state);
  assert.equal(result.searchDepth, 0);
  assert.equal(result.timedOut, true);
  assert.deepEqual(result.bestMove, RuleEngine.getAllLegalMoves(state)[0]);
  assert.deepEqual(result.candidateMoves, []);
  assert.ok(result.nodesSearched > 0);
});

test('TT is reused across depths and its counters cover the whole call', () => {
  const state = withPieces({ P01: 'A', P06: 'A', P05: 'B', P10: 'B' });
  const iterative = new IterativeDeepeningAI({ maxDepth: 3,
    timeLimitMs: 100, now: () => 0 }).search(state);
  const sharedTable = new TranspositionTable();
  const separate = [1, 2, 3].map(depth => new AlphaBetaAI({ depth,
    useMoveOrdering: true, useTranspositionTable: true }).search(state, 'A',
      { table: sharedTable }));
  assert.equal(iterative.nodesSearched, separate.reduce((n, item) => n + item.nodesSearched, 0));
  assert.equal(iterative.ttProbes, sharedTable.probes);
  assert.equal(iterative.ttHits, sharedTable.hits);
  assert.equal(iterative.cutoffs, separate.reduce((n, item) => n + item.cutoffs, 0));
  assert.equal(iterative.evaluationScore, separate.at(-1)?.evaluationScore);
  assert.ok(iterative.ttStores > 0);
  assert.ok(iterative.ttSize > 0);
});

test('cutoffs count every completed iteration', () => {
  const state = withPieces({ P01: 'A', P06: 'A', P05: 'B', P10: 'B' });
  const iterative = new IterativeDeepeningAI({ maxDepth: 4,
    timeLimitMs: 100, now: () => 0 }).search(state);
  const sharedTable = new TranspositionTable();
  const separate = [1, 2, 3, 4].map(depth => new AlphaBetaAI({ depth,
    useMoveOrdering: true, useTranspositionTable: true }).search(state, 'A',
      { table: sharedTable }));
  assert.ok(separate.slice(0, -1).some(item => item.cutoffs > 0));
  assert.equal(iterative.cutoffs, separate.reduce((n, item) => n + item.cutoffs, 0));
});

test('one TT instance spans iterations but a new search gets another table', () => {
  const state = withPieces({ P01: 'A', P06: 'A', P05: 'B', P10: 'B' });
  const seen = new Set<InstanceType<typeof TranspositionTable>>();
  const originalStore = TranspositionTable.prototype.store;
  TranspositionTable.prototype.store = function(entry) {
    seen.add(this);
    return originalStore.call(this, entry);
  };
  try {
    const ai = new IterativeDeepeningAI({ maxDepth: 2,
      timeLimitMs: 100, now: () => 0 });
    ai.search(state);
    assert.equal(seen.size, 1);
    ai.search(state);
    assert.equal(seen.size, 2);
  } finally {
    TranspositionTable.prototype.store = originalStore;
  }
});

test('deadline crossed during the final leaf evaluation does not complete that depth', () => {
  const state = withPieces({ P27: 'B', P26: 'A', P28: 'A', P03: 'A' }, 'B');
  assert.equal(RuleEngine.getAllLegalMoves(state).length, 1);
  let late = false;
  const config = {
    ...DEFAULT_EVALUATION_CONFIG,
    get materialWeight() { late = true; return DEFAULT_EVALUATION_CONFIG.materialWeight; },
  };
  const result = new IterativeDeepeningAI({ maxDepth: 1, timeLimitMs: 100,
    evaluationConfig: config, now: () => late ? 100 : 0 }).search(state);
  assert.equal(result.timedOut, true);
  assert.equal(result.searchDepth, 0);
  assert.deepEqual(result.bestMove, RuleEngine.getAllLegalMoves(state)[0]);
});

test('timeout inside a child never stores an incomplete TT entry', () => {
  const state = withPieces({ P01: 'A', P06: 'A', P05: 'B', P10: 'B' });
  const child = RuleEngine.executeTurn(state, RuleEngine.getAllLegalMoves(state)[0]).state;
  const table = new TranspositionTable();
  let visited = 0;
  assert.throws(() => new AlphaBetaAI({ depth: 3, useTranspositionTable: true })
    .search(state, 'A', { table, checkTimeout: () => {
      if (++visited === 3) throw new SearchTimeoutError();
    } }), SearchTimeoutError);
  assert.equal(table.probe(hashGameState(child), stateSignature(child), 2,
    -Infinity, Infinity, 1).hit, false);
});

test('finished winner reasons preserve signed scores and never iterate', () => {
  const cases = [
    RuleEngine.executeTurn(withPieces({ P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A' }),
      { from: 'P19', to: 'P13' }).state,
    RuleEngine.executeTurn(withPieces({ P27: 'B', P26: 'A', P28: 'A', P29: 'A', P03: 'A', P21: 'A' }),
      { from: 'P21', to: 'P22' }).state,
    RuleEngine.executeTurn(withPieces({ P03: 'B', P02: 'A', P04: 'A', P27: 'A', P08: 'A',
      P09: 'A', P07: 'A', P26: 'A', P28: 'A', P21: 'A' }),
      { from: 'P21', to: 'P22' }).state,
  ];
  assert.deepEqual(cases.map(state => state.winner_reason),
    ['CAPTURE_ALL', 'TEMPLE_TRAP', 'LONE_PIECE_IMMOBILIZED']);
  for (const state of cases) for (const player of ['A', 'B'] as const) {
    const result = new IterativeDeepeningAI({ maxDepth: 3,
      timeLimitMs: 0, now: () => 0 }).search(state, player);
    assert.equal(result.bestMove, null);
    assert.equal(result.searchDepth, 0);
    assert.equal(result.timedOut, false);
    assert.equal(result.evaluationScore,
      (player === state.winner ? 1 : -1) * DEFAULT_EVALUATION_CONFIG.mateScore);
  }
});

test('RULE_AMBIGUITY propagates through the iterative loop', () => {
  const state = withPieces({
    P03: 'B', P13: 'B', P02: 'A', P04: 'A', P27: 'A', P08: 'A',
    P09: 'A', P07: 'A', P26: 'A', P28: 'A', P12: 'A', P14: 'A',
    P18: 'A', P19: 'A', P17: 'A',
  }, 'B');
  assert.deepEqual(RuleEngine.getAllLegalMoves(state), []);
  assert.throws(() => new IterativeDeepeningAI({ maxDepth: 2,
    timeLimitMs: 100, now: () => 0 }).search(state), RuleAmbiguityError);
  assert.throws(() => new IterativeDeepeningAI({ maxDepth: 2,
    timeLimitMs: 0, now: () => 0 }).search(state), RuleAmbiguityError);
});

test('a deeper RULE_AMBIGUITY is not mistaken for timeout after depth one completes', () => {
  const state = withPieces({
    P03: 'B', P13: 'B', P02: 'A', P04: 'A', P29: 'A', P08: 'A',
    P09: 'A', P07: 'A', P26: 'A', P28: 'A', P12: 'A', P14: 'A',
    P18: 'A', P19: 'A', P17: 'A',
  });
  const first = new AlphaBetaAI({ depth: 1, useMoveOrdering: true,
    useTranspositionTable: true }).search(state);
  assert.equal(first.searchDepth, 1);
  assert.throws(() => new IterativeDeepeningAI({ maxDepth: 2,
    timeLimitMs: 100, now: () => 0 }).search(state), RuleAmbiguityError);
});

test('immediate win, defensive reply, faster win and slower loss match fixed search', () => {
  const cases = [
    { state: withPieces({ P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A' }), depth: 1,
      config: DEFAULT_EVALUATION_CONFIG },
    { state: withPieces({ P27: 'B', P08: 'A', P26: 'A', P28: 'A' }, 'B'), depth: 2,
      config: { ...neutralConfig, templeControlWeight: 10 } },
    { state: withPieces({ P26: 'B', P28: 'A', P29: 'A', P03: 'A' }), depth: 3,
      config: neutralConfig },
    { state: withPieces({ P03: 'B', P04: 'A', P27: 'A', P08: 'A',
      P09: 'A', P07: 'A', P26: 'A', P06: 'A' }, 'B'), depth: 4,
      config: neutralConfig },
  ];
  for (const { state, depth, config } of cases) {
    const fixed = new AlphaBetaAI({ depth, evaluationConfig: config,
      useMoveOrdering: true, useTranspositionTable: true }).search(state);
    const iterative = new IterativeDeepeningAI({ maxDepth: depth, evaluationConfig: config,
      timeLimitMs: 100, now: () => 0 }).search(state);
    assert.equal(iterative.evaluationScore, fixed.evaluationScore);
    assert.deepEqual(iterative.bestMove, fixed.bestMove);
    assert.deepEqual(iterative.candidateMoves, fixed.candidateMoves);
  }
});

test('invalid depth and budget are rejected', () => {
  for (const maxDepth of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => new IterativeDeepeningAI({ maxDepth, timeLimitMs: 1 }), RangeError);
  }
  for (const timeLimitMs of [NaN, Infinity, -Infinity]) {
    assert.throws(() => new IterativeDeepeningAI({ maxDepth: 1, timeLimitMs }), RangeError);
  }
});

test('real-clock medium-position benchmark records full and short budgets', t => {
  const state = withPieces({ P01: 'A', P06: 'A', P05: 'B', P10: 'B' });
  const snapshot = structuredClone(state);
  for (const timeLimitMs of [10000, 100]) {
    const result = new IterativeDeepeningAI({ maxDepth: 4, timeLimitMs }).search(state);
    assert.ok(result.searchDepth >= 0 && result.searchDepth <= 4);
    assert.equal(RuleEngine.validateMove(state, result.bestMove!), true);
    assert.deepEqual(state, snapshot);
    t.diagnostic(JSON.stringify({
      fixture: 'P01/P06 A versus P05/P10 B', maxDepth: 4, timeLimitMs,
      completedDepth: result.searchDepth, nodes: result.nodesSearched,
      ttHits: result.ttHits, thinkingTimeMs: Number(result.thinkingTimeMs.toFixed(2)),
      timedOut: result.timedOut, bestMove: result.bestMove,
      score: result.evaluationScore,
    }));
  }
});
