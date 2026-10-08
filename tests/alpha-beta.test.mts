import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { performance } from 'node:perf_hooks';
import { NODE_IDS, RuleEngine, createInitialGameState } from '../miniprogram/domain/index.ts';

// Resolve WeChat's extensionless TypeScript imports in Node's test runner.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') && context.parentURL &&
          (error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') {
        const tsUrl = new URL(`${specifier}.ts`, context.parentURL);
        if (existsSync(tsUrl)) return nextResolve(tsUrl.href, context);
      }
      throw error;
    }
  },
});

const { AlphaBetaAI } = await import('../miniprogram/ai/alpha-beta.ts');
const { MinimaxAI, RuleAmbiguityError } = await import('../miniprogram/ai/minimax.ts');
const { DEFAULT_EVALUATION_CONFIG, evaluatePosition } =
  await import('../miniprogram/ai/evaluation.ts');

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
  vulnerabilityWeight: 0, trapRiskWeight: 0, blockadeWeight: 0,
};

function assertEquivalent(
  state: ReturnType<typeof withPieces>,
  depth: number,
  rootPlayer: 'A' | 'B' = state.current_player,
  config = DEFAULT_EVALUATION_CONFIG,
) {
  const minimax = new MinimaxAI({ depth, evaluationConfig: config }).search(state, rootPlayer);
  const alphaBeta = new AlphaBetaAI({ depth, evaluationConfig: config }).search(state, rootPlayer);
  assert.equal(alphaBeta.evaluationScore, minimax.evaluationScore);
  assert.deepEqual(alphaBeta.bestMove, minimax.bestMove);
  assert.deepEqual(alphaBeta.candidateMoves, minimax.candidateMoves);
  assert.equal(alphaBeta.scorePerspective, rootPlayer);
  assert.equal(alphaBeta.searchDepth, depth);
  assert.equal(alphaBeta.algorithm, 'ALPHA_BETA');
  assert.ok(alphaBeta.nodesSearched <= minimax.nodesSearched);
  assert.ok(Number.isFinite(alphaBeta.thinkingTimeMs) && alphaBeta.thinkingTimeMs >= 0);
  if (alphaBeta.bestMove) {
    assert.equal(RuleEngine.validateMove(state, alphaBeta.bestMove), true);
    assert.ok(alphaBeta.candidateMoves.some(item =>
      item.move.from === alphaBeta.bestMove?.from && item.move.to === alphaBeta.bestMove?.to &&
      item.score === alphaBeta.evaluationScore));
  }
  return { minimax, alphaBeta };
}

test('depth zero evaluates the root without expanding moves', () => {
  const state = withPieces({ P01: 'A', P06: 'A', P05: 'B' });
  for (const player of ['A', 'B'] as const) {
    const { alphaBeta } = assertEquivalent(state, 0, player);
    assert.equal(alphaBeta.evaluationScore, evaluatePosition(state, player).score);
    assert.equal(alphaBeta.bestMove, null);
    assert.deepEqual(alphaBeta.candidateMoves, []);
    assert.equal(alphaBeta.nodesSearched, 1);
    assert.equal(alphaBeta.cutoffs, 0);
  }
});

test('depths one and two preserve every exact candidate score for both root perspectives', () => {
  const states = [
    withPieces({ P01: 'A', P06: 'A', P05: 'B', P10: 'B' }),
    withPieces({ P27: 'B', P08: 'A', P26: 'A', P28: 'A' }, 'B'),
  ];
  for (const state of states) {
    for (const depth of [1, 2]) {
      for (const rootPlayer of ['A', 'B'] as const) {
        const { alphaBeta, minimax } = assertEquivalent(state, depth, rootPlayer);
        if (depth === 1) {
          assert.ok(alphaBeta.nodesSearched >= 1 + RuleEngine.getAllLegalMoves(state).length);
          assert.equal(alphaBeta.nodesSearched, minimax.nodesSearched);
          assert.equal(alphaBeta.cutoffs, 0);
        }
      }
    }
  }
});

test('depth three matches Minimax and really prunes without changing natural move order', () => {
  const state = withPieces({ P26: 'B', P28: 'A', P29: 'A', P03: 'A' });
  const { minimax, alphaBeta } = assertEquivalent(state, 3, 'A', neutralConfig);
  assert.deepEqual(alphaBeta.candidateMoves.map(item => item.move), RuleEngine.getAllLegalMoves(state));
  assert.ok(alphaBeta.cutoffs > 0);
  assert.ok(alphaBeta.nodesSearched < minimax.nodesSearched);

  const otherState = withPieces({ P27: 'B', P08: 'A', P26: 'A', P28: 'A' }, 'B');
  const other = assertEquivalent(otherState, 3, 'B', neutralConfig);
  assert.deepEqual(other.alphaBeta.candidateMoves.map(item => item.move),
    RuleEngine.getAllLegalMoves(otherState));
  assert.ok(other.alphaBeta.nodesSearched <= other.minimax.nodesSearched);
});

test('immediate capture win remains preferred', () => {
  const state = withPieces({ P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A' });
  const { alphaBeta } = assertEquivalent(state, 1);
  assert.equal(alphaBeta.evaluationScore, DEFAULT_EVALUATION_CONFIG.mateScore - 1);
  assert.equal(RuleEngine.executeTurn(state, alphaBeta.bestMove!).state.winner, 'A');
});

test('depth two avoids the move that lets the opponent win next turn', () => {
  const state = withPieces({ P27: 'B', P08: 'A', P26: 'A', P28: 'A' }, 'B');
  const config = { ...neutralConfig, templeControlWeight: 10 };
  const { alphaBeta } = assertEquivalent(state, 2, 'B', config);
  assert.deepEqual(alphaBeta.bestMove, { from: 'P27', to: 'P03' });
  assert.deepEqual(alphaBeta.candidateMoves, [
    { move: { from: 'P27', to: 'P03' }, score: -20 },
    { move: { from: 'P27', to: 'P29' }, score: -config.mateScore + 2 },
  ]);
});

test('fast wins outrank slower wins with the same mate scoring as Minimax', () => {
  const state = withPieces({ P26: 'B', P28: 'A', P29: 'A', P03: 'A' });
  const { alphaBeta } = assertEquivalent(state, 3, 'A', neutralConfig);
  assert.deepEqual(alphaBeta.bestMove, { from: 'P28', to: 'P27' });
  assert.equal(alphaBeta.candidateMoves.find(item => item.move.from === 'P28' && item.move.to === 'P27')?.score,
    neutralConfig.mateScore - 1);
  assert.equal(alphaBeta.candidateMoves.find(item => item.move.from === 'P29' && item.move.to === 'P27')?.score,
    neutralConfig.mateScore - 3);
});

test('slow defeat matches Minimax and records real nodes, cutoffs and elapsed time', t => {
  const state = withPieces({
    P03: 'B', P04: 'A', P27: 'A', P08: 'A',
    P09: 'A', P07: 'A', P26: 'A', P06: 'A',
  }, 'B');
  const snapshot = structuredClone(state);
  const minimaxStarted = performance.now();
  const minimax = new MinimaxAI({ depth: 4, evaluationConfig: neutralConfig }).search(state);
  const minimaxTimeMs = performance.now() - minimaxStarted;
  const alphaBeta = new AlphaBetaAI({ depth: 4, evaluationConfig: neutralConfig }).search(state);
  assert.equal(alphaBeta.evaluationScore, minimax.evaluationScore);
  assert.deepEqual(alphaBeta.bestMove, minimax.bestMove);
  assert.deepEqual(alphaBeta.candidateMoves, minimax.candidateMoves);
  assert.deepEqual(alphaBeta.bestMove, { from: 'P03', to: 'P02' });
  assert.equal(alphaBeta.evaluationScore, -neutralConfig.mateScore + 4);
  assert.ok(alphaBeta.nodesSearched <= minimax.nodesSearched);
  assert.ok(alphaBeta.cutoffs > 0);
  assert.deepEqual(state, snapshot);
  t.diagnostic(JSON.stringify({
    fixture: 'P03 lone B, seven A blockers', depth: 4,
    minimaxNodes: minimax.nodesSearched, alphaBetaNodes: alphaBeta.nodesSearched,
    cutoffs: alphaBeta.cutoffs,
    minimaxTimeMs: Number(minimaxTimeMs.toFixed(2)),
    alphaBetaTimeMs: alphaBeta.thinkingTimeMs,
  }));
});

test('all three real winner reasons stop immediately at the same mate score', () => {
  const states = [
    RuleEngine.executeTurn(
      withPieces({ P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A' }),
      { from: 'P19', to: 'P13' },
    ).state,
    RuleEngine.executeTurn(
      withPieces({ P27: 'B', P26: 'A', P28: 'A', P29: 'A', P03: 'A', P21: 'A' }),
      { from: 'P21', to: 'P22' },
    ).state,
    RuleEngine.executeTurn(
      withPieces({
        P03: 'B', P02: 'A', P04: 'A', P27: 'A', P08: 'A',
        P09: 'A', P07: 'A', P26: 'A', P28: 'A', P21: 'A',
      }),
      { from: 'P21', to: 'P22' },
    ).state,
  ];
  assert.deepEqual(states.map(state => state.winner_reason),
    ['CAPTURE_ALL', 'TEMPLE_TRAP', 'LONE_PIECE_IMMOBILIZED']);
  for (const state of states) {
    for (const rootPlayer of ['A', 'B'] as const) {
      const { alphaBeta } = assertEquivalent(state, 3, rootPlayer);
      assert.equal(alphaBeta.evaluationScore,
        (rootPlayer === state.winner ? 1 : -1) * DEFAULT_EVALUATION_CONFIG.mateScore);
      assert.equal(alphaBeta.bestMove, null);
      assert.equal(alphaBeta.nodesSearched, 1);
      assert.equal(alphaBeta.cutoffs, 0);
    }
  }
});

test('equal scores choose the first legal move on every run', () => {
  const state = createInitialGameState();
  const first = RuleEngine.getAllLegalMoves(state)[0];
  const ai = new AlphaBetaAI({ depth: 1, evaluationConfig: neutralConfig });
  for (let index = 0; index < 5; index++) {
    const result = ai.search(state);
    assert.deepEqual(result.bestMove, first);
    assert.ok(result.candidateMoves.every(item => item.score === 0));
    assert.deepEqual(ai.chooseMove(state), first);
  }
});

test('both players can search without modifying the supplied GameState', () => {
  for (const player of ['A', 'B'] as const) {
    const state = createInitialGameState({ firstPlayer: player });
    const snapshot = structuredClone(state);
    const { alphaBeta } = assertEquivalent(state, 1, player);
    assert.equal(RuleEngine.validateMove(state, alphaBeta.bestMove!), true);
    assert.deepEqual(state, snapshot);
  }
});

test('nonterminal no-move ambiguity and invalid depth match Minimax', () => {
  const state = withPieces({
    P03: 'B', P13: 'B', P02: 'A', P04: 'A', P27: 'A', P08: 'A',
    P09: 'A', P07: 'A', P26: 'A', P28: 'A', P12: 'A', P14: 'A',
    P18: 'A', P19: 'A', P17: 'A',
  }, 'B');
  assert.deepEqual(RuleEngine.getAllLegalMoves(state), []);
  const snapshot = structuredClone(state);
  assert.throws(() => new MinimaxAI({ depth: 1 }).search(state), RuleAmbiguityError);
  assert.throws(() => new AlphaBetaAI({ depth: 1 }).search(state),
    (error: unknown) => error instanceof RuleAmbiguityError && error.code === 'RULE_AMBIGUITY');
  assert.deepEqual(state, snapshot);
  for (const depth of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => new AlphaBetaAI({ depth }), RangeError);
  }
});

test('both searches score a real multi-piece no-move child as a terminal win', () => {
  const state = withPieces({
    P03: 'B', P13: 'B', P02: 'A', P04: 'A', P29: 'A', P08: 'A',
    P09: 'A', P07: 'A', P26: 'A', P28: 'A', P12: 'A', P14: 'A',
    P18: 'A', P19: 'A', P17: 'A',
  });
  const move = { from: 'P29', to: 'P27' } as const;
  assert.equal(RuleEngine.validateMove(state, move), true);
  const child = RuleEngine.executeTurn(state, move).state;
  assert.equal(child.game_status, 'FINISHED');
  assert.equal(child.winner_reason, 'ALL_PIECES_IMMOBILIZED');
  assert.equal(child.current_player, 'B');
  assert.deepEqual(RuleEngine.getAllLegalMoves(child), []);
  const snapshot = structuredClone(state);
  for (const ai of [new MinimaxAI({ depth: 2 }), new AlphaBetaAI({ depth: 2 })]) {
    const result = ai.search(state);
    assert.equal(result.evaluationScore, DEFAULT_EVALUATION_CONFIG.mateScore - 1);
    assert.equal(RuleEngine.executeTurn(state, result.bestMove!).winner_reason, 'ALL_PIECES_IMMOBILIZED');
  }
  assert.deepEqual(state, snapshot);
});
