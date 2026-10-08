import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import {
  NODE_IDS,
  RuleEngine,
  createInitialGameState,
} from '../miniprogram/domain/index.ts';

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

const { MinimaxAI, RuleAmbiguityError } = await import('../miniprogram/ai/minimax.ts');
const { DEFAULT_EVALUATION_CONFIG, evaluatePosition } =
  await import('../miniprogram/ai/evaluation.ts');

function withPieces(
  pieces: Record<string, 'A' | 'B'>,
  { currentPlayer = 'A' as 'A' | 'B', reserveA = 4, reserveB = 4 } = {},
) {
  const initial = createInitialGameState({ firstPlayer: currentPlayer });
  const occupancy = { ...initial.board.occupancy };
  for (const node of NODE_IDS) occupancy[node] = null;
  for (const [node, player] of Object.entries(pieces)) {
    occupancy[node as typeof NODE_IDS[number]] = player;
  }
  return {
    ...initial,
    board: { occupancy },
    players: { A: { reserve_count: reserveA }, B: { reserve_count: reserveB } },
  };
}

const neutralConfig = {
  ...DEFAULT_EVALUATION_CONFIG,
  materialWeight: 0,
  reserveWeight: 0,
  mobilityWeight: 0,
  templeControlWeight: 0,
  captureOpportunityWeight: 0,
  vulnerabilityWeight: 0,
  trapRiskWeight: 0,
  blockadeWeight: 0,
};

test('depth zero evaluates the unchanged root from the requested perspective', () => {
  const state = withPieces({ P01: 'A', P06: 'A', P05: 'B' });
  const ai = new MinimaxAI({ depth: 0 });
  for (const player of ['A', 'B'] as const) {
    const result = ai.search(state, player);
    assert.equal(result.bestMove, null);
    assert.deepEqual(result.candidateMoves, []);
    assert.equal(result.evaluationScore, evaluatePosition(state, player).score);
    assert.equal(result.scorePerspective, player);
    assert.equal(result.searchDepth, 0);
    assert.equal(result.nodesSearched, 1);
    assert.equal(result.algorithm, 'MINIMAX');
  }
});

test('depth one scores every real child and chooses the maximum for player A', () => {
  const state = withPieces({ P01: 'A', P06: 'A', P05: 'B', P10: 'B' });
  const legal = RuleEngine.getAllLegalMoves(state);
  assert.ok(legal.length > 1);
  const expected = legal.map(move => {
    const child = RuleEngine.executeTurn(state, move).state;
    const base = evaluatePosition(child, 'A').score;
    return { move, score: child.game_status === 'FINISHED' ? base - 1 : base };
  });
  const result = new MinimaxAI({ depth: 1 }).search(state);
  assert.deepEqual(result.candidateMoves, expected);
  assert.deepEqual(result.bestMove, expected.find(item =>
    item.score === Math.max(...expected.map(candidate => candidate.score)))?.move);
  assert.equal(result.evaluationScore, Math.max(...expected.map(item => item.score)));
  assert.equal(result.nodesSearched, 1 + legal.length);
  assert.equal(RuleEngine.validateMove(state, result.bestMove!), true);
});

test('depth one treats the opponent-to-root turn as a minimizing node', () => {
  const state = withPieces({ P01: 'A', P06: 'A', P05: 'B', P10: 'B' });
  const expected = RuleEngine.getAllLegalMoves(state).map(move => {
    const child = RuleEngine.executeTurn(state, move).state;
    const base = evaluatePosition(child, 'B').score;
    return { move, score: child.game_status === 'FINISHED' ? base + 1 : base };
  });
  const result = new MinimaxAI({ depth: 1 }).search(state, 'B');
  assert.equal(result.scorePerspective, 'B');
  assert.deepEqual(result.candidateMoves, expected);
  assert.equal(result.evaluationScore, Math.min(...expected.map(item => item.score)));
  assert.deepEqual(result.bestMove, expected.find(item => item.score === result.evaluationScore)?.move);
});

test('depth two takes the minimum of every opponent reply and counts all nodes', () => {
  const state = withPieces({ P01: 'A', P06: 'A', P05: 'B', P10: 'B' });
  const rootMoves = RuleEngine.getAllLegalMoves(state);
  let expectedNodes = 1 + rootMoves.length;
  const expected = rootMoves.map(move => {
    const child = RuleEngine.executeTurn(state, move).state;
    if (child.game_status === 'FINISHED') {
      return { move, score: evaluatePosition(child, 'A').score - 1 };
    }
    const replies = RuleEngine.getAllLegalMoves(child);
    assert.ok(replies.length > 0);
    expectedNodes += replies.length;
    const scores = replies.map(reply => {
      const grandchild = RuleEngine.executeTurn(child, reply).state;
      const base = evaluatePosition(grandchild, 'A').score;
      return grandchild.game_status === 'FINISHED'
        ? base + (base > 0 ? -2 : 2) : base;
    });
    return { move, score: Math.min(...scores) };
  });
  const result = new MinimaxAI({ depth: 2 }).search(state);
  assert.deepEqual(result.candidateMoves, expected);
  assert.equal(result.nodesSearched, expectedNodes);
  assert.equal(result.evaluationScore, Math.max(...expected.map(item => item.score)));
  assert.deepEqual(result.bestMove, expected.find(item => item.score === result.evaluationScore)?.move);
});

test('A and B both choose legal moves from their own turns without changing input', () => {
  for (const player of ['A', 'B'] as const) {
    const state = createInitialGameState({ firstPlayer: player });
    const snapshot = structuredClone(state);
    const ai = new MinimaxAI({ depth: 1 });
    const result = ai.search(state);
    const legal = RuleEngine.getAllLegalMoves(state);
    assert.ok(result.bestMove);
    assert.ok(legal.some(move => move.from === result.bestMove?.from && move.to === result.bestMove?.to));
    assert.deepEqual(ai.chooseMove(state), result.bestMove);
    assert.equal(result.scorePerspective, player);
    assert.deepEqual(state, snapshot);
    assert.deepEqual(state.board, snapshot.board);
    assert.deepEqual(state.players, snapshot.players);
  }
});

test('equal scores select the first legal move deterministically', () => {
  const state = createInitialGameState();
  const first = RuleEngine.getAllLegalMoves(state)[0];
  const ai = new MinimaxAI({ depth: 1, evaluationConfig: neutralConfig });
  for (let index = 0; index < 10; index++) {
    const result = ai.search(state);
    assert.deepEqual(result.bestMove, first);
    assert.ok(result.candidateMoves.every(item => item.score === 0));
  }
});

test('finished states use the existing mate score for all three winner reasons', () => {
  const captureAll = RuleEngine.executeTurn(
    withPieces({ P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A' }),
    { from: 'P19', to: 'P13' },
  ).state;
  const templeTrap = RuleEngine.executeTurn(
    withPieces({ P27: 'B', P26: 'A', P28: 'A', P29: 'A', P03: 'A', P21: 'A' }),
    { from: 'P21', to: 'P22' },
  ).state;
  const immobilized = RuleEngine.executeTurn(
    withPieces({
      P03: 'B', P02: 'A', P04: 'A', P27: 'A', P08: 'A',
      P09: 'A', P07: 'A', P26: 'A', P28: 'A', P21: 'A',
    }),
    { from: 'P21', to: 'P22' },
  ).state;
  assert.deepEqual([captureAll.winner_reason, templeTrap.winner_reason, immobilized.winner_reason],
    ['CAPTURE_ALL', 'TEMPLE_TRAP', 'LONE_PIECE_IMMOBILIZED']);
  const ai = new MinimaxAI({ depth: 3 });
  for (const state of [captureAll, templeTrap, immobilized]) {
    const snapshot = structuredClone(state);
    for (const [player, sign] of [['A', 1], ['B', -1]] as const) {
      const result = ai.search(state, player);
      assert.equal(result.evaluationScore, sign * DEFAULT_EVALUATION_CONFIG.mateScore);
      assert.equal(result.scorePerspective, player);
      assert.equal(result.bestMove, null);
      assert.deepEqual(result.candidateMoves, []);
      assert.equal(result.nodesSearched, 1);
    }
    assert.deepEqual(state, snapshot);
  }
});

test('an immediate real win outranks nonwinning moves at depth one', () => {
  const state = withPieces({ P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A' });
  const moves = RuleEngine.getAllLegalMoves(state);
  const winning = moves.filter(move => RuleEngine.executeTurn(state, move).state.winner === 'A');
  const nonwinning = moves.filter(move => RuleEngine.executeTurn(state, move).state.winner !== 'A');
  assert.ok(winning.length > 0);
  assert.ok(nonwinning.length > 0);
  const result = new MinimaxAI({ depth: 1 }).search(state);
  assert.ok(winning.some(move => move.from === result.bestMove?.from && move.to === result.bestMove?.to));
  assert.equal(result.evaluationScore, DEFAULT_EVALUATION_CONFIG.mateScore - 1);
});

test('blockade extension avoids the tempting immediate loss even at depth one', () => {
  const state = withPieces({ P27: 'B', P08: 'A', P26: 'A', P28: 'A' },
    { currentPlayer: 'B' });
  const config = { ...neutralConfig, templeControlWeight: 10 };
  const shallow = new MinimaxAI({ depth: 1, evaluationConfig: config }).search(state);
  const deep = new MinimaxAI({ depth: 2, evaluationConfig: config }).search(state);
  assert.deepEqual(shallow.bestMove, { from: 'P27', to: 'P03' });
  assert.deepEqual(deep.bestMove, { from: 'P27', to: 'P03' });
  assert.deepEqual(deep.candidateMoves, [
    { move: { from: 'P27', to: 'P03' }, score: -20 },
    { move: { from: 'P27', to: 'P29' }, score: -config.mateScore + 2 },
  ]);
  const losingChild = RuleEngine.executeTurn(state, { from: 'P27', to: 'P29' }).state;
  assert.ok(RuleEngine.getAllLegalMoves(losingChild).some(move =>
    RuleEngine.executeTurn(losingChild, move).state.winner === 'A'));
});

test('forced wins in one ply outrank forced wins in three plies', () => {
  const state = withPieces({ P26: 'B', P28: 'A', P29: 'A', P03: 'A' });
  const result = new MinimaxAI({ depth: 3, evaluationConfig: neutralConfig }).search(state);
  const immediate = result.candidateMoves.find(item =>
    item.move.from === 'P28' && item.move.to === 'P27');
  const delayed = result.candidateMoves.find(item =>
    item.move.from === 'P29' && item.move.to === 'P27');
  assert.deepEqual(result.bestMove, immediate?.move);
  assert.equal(immediate?.score, neutralConfig.mateScore - 1);
  assert.equal(delayed?.score, neutralConfig.mateScore - 3);
  assert.equal(RuleEngine.executeTurn(state, immediate!.move).state.winner, 'A');
  assert.equal(RuleEngine.executeTurn(state, delayed!.move).state.game_status, 'PLAYING');
});

test('when every move loses, Minimax chooses the defeat four plies away', () => {
  const state = withPieces({
    P03: 'B', P04: 'A', P27: 'A', P08: 'A',
    P09: 'A', P07: 'A', P26: 'A', P06: 'A',
  }, { currentPlayer: 'B' });
  const snapshot = structuredClone(state);
  const result = new MinimaxAI({ depth: 4, evaluationConfig: neutralConfig }).search(state);
  assert.deepEqual(result.candidateMoves, [
    { move: { from: 'P03', to: 'P01' }, score: -neutralConfig.mateScore + 2 },
    { move: { from: 'P03', to: 'P02' }, score: -neutralConfig.mateScore + 4 },
    { move: { from: 'P03', to: 'P28' }, score: -neutralConfig.mateScore + 4 },
  ]);
  assert.deepEqual(result.bestMove, { from: 'P03', to: 'P02' });
  assert.equal(result.evaluationScore, -neutralConfig.mateScore + 4);
  assert.ok(result.nodesSearched > 1 + result.candidateMoves.length);
  assert.deepEqual(state, snapshot);
});

test('nonterminal states with no legal moves report rule ambiguity without inventing a loss', () => {
  const state = withPieces({
    P03: 'B', P13: 'B', P02: 'A', P04: 'A', P27: 'A', P08: 'A',
    P09: 'A', P07: 'A', P26: 'A', P28: 'A', P12: 'A', P14: 'A',
    P18: 'A', P19: 'A', P17: 'A',
  }, { currentPlayer: 'B' });
  assert.deepEqual(RuleEngine.getAllLegalMoves(state), []);
  const snapshot = structuredClone(state);
  assert.throws(() => new MinimaxAI({ depth: 1 }).search(state),
    (error: unknown) => error instanceof RuleAmbiguityError && error.code === 'RULE_AMBIGUITY');
  assert.deepEqual(state, snapshot);
});

test('invalid search depths are rejected', () => {
  for (const depth of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => new MinimaxAI({ depth }), RangeError);
  }
});
