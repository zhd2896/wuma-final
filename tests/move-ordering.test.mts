import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { NODE_IDS, RuleEngine, TEMPLE_NODES, createInitialGameState } from '../miniprogram/domain/index.ts';

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

const { MoveOrderCategory, orderMoves } = await import('../miniprogram/ai/move-ordering.ts');
const { AlphaBetaAI } = await import('../miniprogram/ai/alpha-beta.ts');
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

function findMove(
  ordered: ReturnType<typeof orderMoves>,
  from: typeof NODE_IDS[number],
  to: typeof NODE_IDS[number],
) {
  const found = ordered.find(item => item.move.from === from && item.move.to === to);
  assert.ok(found, `${from} → ${to} should be a legal ordered move`);
  return found;
}

function moveKey(move: { from: string; to: string }) {
  return `${move.from}:${move.to}`;
}

function exactScores(result: { candidateMoves: readonly { move: { from: string; to: string }; score: number }[] }) {
  return new Map(result.candidateMoves.map(item => [moveKey(item.move), item.score]));
}

const neutralConfig = {
  ...DEFAULT_EVALUATION_CONFIG,
  materialWeight: 0, reserveWeight: 0, mobilityWeight: 0,
  templeControlWeight: 0, captureOpportunityWeight: 0,
  vulnerabilityWeight: 0, trapRiskWeight: 0,
};

test('ordering preserves every real legal move and puts a GameEngine win first', () => {
  const state = withPieces({ P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A' });
  const snapshot = structuredClone(state);
  const legal = RuleEngine.getAllLegalMoves(state);
  const ordered = orderMoves(state);
  assert.deepEqual(new Set(ordered.map(item => moveKey(item.move))), new Set(legal.map(moveKey)));
  assert.equal(ordered.length, legal.length);
  const winner = findMove(ordered, 'P19', 'P13');
  assert.equal(winner.category, MoveOrderCategory.IMMEDIATE_WIN);
  assert.equal(RuleEngine.executeTurn(state, winner.move).captures.was_applied, true);
  assert.equal(winner.childState.winner, 'A');
  assert.equal(winner.childState.winner_reason, 'CAPTURE_ALL');
  assert.equal(ordered[0].category, MoveOrderCategory.IMMEDIATE_WIN);
  assert.deepEqual(state, snapshot);
});

test('both lone-piece winner reasons are immediate wins for ordering', () => {
  const cases = [
    {
      state: withPieces({
        P27: 'B', P26: 'A', P28: 'A', P29: 'A', P03: 'A', P21: 'A',
      }),
      reason: 'TEMPLE_TRAP',
    },
    {
      state: withPieces({
        P03: 'B', P02: 'A', P04: 'A', P27: 'A', P08: 'A',
        P09: 'A', P07: 'A', P26: 'A', P28: 'A', P21: 'A',
      }),
      reason: 'LONE_PIECE_IMMOBILIZED',
    },
  ];
  for (const { state, reason } of cases) {
    const ordered = orderMoves(state);
    const winning = findMove(ordered, 'P21', 'P22');
    assert.equal(winning.childState.winner_reason, reason);
    assert.equal(winning.childState.winner, 'A');
    assert.equal(winning.category, MoveOrderCategory.IMMEDIATE_WIN);
  }
});

test('real capture outranks a normal move, while insufficient reserve is not capture', () => {
  const pieces = { P01: 'A', P02: 'B', P04: 'A', P29: 'B' } as const;
  const normalState = withPieces(pieces);
  const normalOrder = orderMoves(normalState);
  const capture = findMove(normalOrder, 'P04', 'P03');
  const quiet = findMove(normalOrder, 'P01', 'P06');
  assert.equal(capture.category, MoveOrderCategory.CAPTURE);
  assert.equal(capture.captureCount, 1);
  assert.equal(quiet.category, MoveOrderCategory.NORMAL);
  assert.ok(normalOrder.indexOf(capture) < normalOrder.indexOf(quiet));

  const noReserve = withPieces(pieces, { reserveA: 0 });
  const turn = RuleEngine.executeTurn(noReserve, { from: 'P04', to: 'P03' });
  assert.equal(turn.captures.failure_reason, 'INSUFFICIENT_RESERVE');
  assert.equal(turn.captures.was_applied, false);
  const denied = findMove(orderMoves(noReserve), 'P04', 'P03');
  assert.notEqual(denied.category, MoveOrderCategory.CAPTURE);
  assert.equal(denied.captureCount, 0);
});

test('player B capture is ordered as the moving player’s good action', () => {
  const state = withPieces({ P01: 'B', P02: 'A', P04: 'B', P29: 'A' },
    { currentPlayer: 'B' });
  const ordered = orderMoves(state);
  const capture = findMove(ordered, 'P04', 'P03');
  assert.equal(capture.category, MoveOrderCategory.CAPTURE);
  assert.equal(capture.captureCount, 1);
  assert.equal(RuleEngine.executeTurn(state, capture.move).captures.was_applied, true);
});

test('more unique captured nodes rank first within the capture category', () => {
  const state = withPieces({
    P01: 'A', P04: 'A', P19: 'A',
    P02: 'B', P12: 'B', P14: 'B', P29: 'B',
  });
  const ordered = orderMoves(state);
  const single = findMove(ordered, 'P04', 'P03');
  const multiple = findMove(ordered, 'P19', 'P13');
  assert.equal(single.category, MoveOrderCategory.CAPTURE);
  assert.equal(multiple.category, MoveOrderCategory.CAPTURE);
  assert.equal(single.captureCount, 1);
  assert.ok(multiple.captureCount >= 2);
  assert.ok(ordered.indexOf(multiple) < ordered.indexOf(single));
  const turn = RuleEngine.executeTurn(state, multiple.move);
  assert.equal(multiple.captureCount, new Set(turn.captures.captured_nodes).size);
});

test('a noncapturing move with a real later capture opportunity outranks normal', () => {
  const state = withPieces({ P01: 'A', P02: 'B', P04: 'A', P29: 'B' });
  const ordered = orderMoves(state);
  const threat = findMove(ordered, 'P04', 'P05');
  const normal = findMove(ordered, 'P01', 'P06');
  assert.equal(RuleEngine.executeTurn(state, threat.move).captures.was_applied, false);
  assert.ok(evaluatePosition(threat.childState, 'A').breakdown.captureOpportunity.rawValue > 0);
  assert.equal(threat.category, MoveOrderCategory.CAPTURE_THREAT);
  assert.equal(normal.category, MoveOrderCategory.NORMAL);
  assert.ok(ordered.indexOf(threat) < ordered.indexOf(normal));
});

test('P03 is an ordering entrance but remains outside TEMPLE_NODES', () => {
  const state = withPieces({ P03: 'A', P20: 'A', P25: 'B' });
  assert.equal(TEMPLE_NODES.includes('P03'), false);
  const ordered = orderMoves(state);
  const entrance = findMove(ordered, 'P03', 'P27');
  const entranceToBoard = findMove(ordered, 'P03', 'P01');
  const normal = findMove(ordered, 'P20', 'P19');
  assert.equal(entrance.category, MoveOrderCategory.TEMPLE_KEY);
  assert.equal(entranceToBoard.category, MoveOrderCategory.TEMPLE_KEY);
  assert.equal(normal.category, MoveOrderCategory.NORMAL);
  assert.ok(ordered.indexOf(entrance) < ordered.indexOf(normal));
});

test('category priorities follow win, capture, threat, entrance, normal', () => {
  const winning = findMove(orderMoves(withPieces({
    P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A',
  })), 'P19', 'P13');
  const captureState = withPieces({ P01: 'A', P02: 'B', P04: 'A', P29: 'B' });
  const captureMoves = orderMoves(captureState);
  const capturing = findMove(captureMoves, 'P04', 'P03');
  const threatening = findMove(captureMoves, 'P04', 'P05');
  const normal = findMove(captureMoves, 'P01', 'P06');
  const temple = findMove(orderMoves(withPieces({ P03: 'A', P20: 'A', P25: 'B' })),
    'P03', 'P01');
  assert.deepEqual(
    [winning, capturing, threatening, temple, normal].map(item => item.category),
    Object.values(MoveOrderCategory),
  );
  assert.ok(winning.priority > capturing.priority);
  assert.ok(capturing.priority > threatening.priority);
  assert.ok(threatening.priority > temple.priority);
  assert.ok(temple.priority > normal.priority);
});

test('same category and capture count keep the original stable move order', () => {
  const state = withPieces({ P03: 'A', P20: 'A', P25: 'B' });
  const legal = RuleEngine.getAllLegalMoves(state);
  const first = orderMoves(state);
  for (let run = 0; run < 5; run++) {
    const ordered = orderMoves(state);
    assert.deepEqual(ordered.map(item => moveKey(item.move)), first.map(item => moveKey(item.move)));
    for (const category of Object.values(MoveOrderCategory)) {
      const group = ordered.filter(item => item.category === category);
      assert.deepEqual(group.map(item => item.originalIndex),
        [...group.map(item => item.originalIndex)].sort((a, b) => a - b));
    }
    assert.deepEqual(new Set(ordered.map(item => moveKey(item.move))), new Set(legal.map(moveKey)));
  }
});

test('ordered search preserves exact scores at depths one through three for A and B', () => {
  const cases = [
    { state: withPieces({ P01: 'A', P06: 'A', P05: 'B', P10: 'B' }), depth: 1 },
    { state: withPieces({ P27: 'B', P08: 'A', P26: 'A', P28: 'A' },
      { currentPlayer: 'B' }), depth: 2 },
    { state: withPieces({ P26: 'B', P28: 'A', P29: 'A', P03: 'A' }), depth: 3 },
  ];
  for (const { state, depth } of cases) {
    const snapshot = structuredClone(state);
    for (const rootPlayer of ['A', 'B'] as const) {
      const minimax = new MinimaxAI({ depth }).search(state, rootPlayer);
      const plain = new AlphaBetaAI({ depth }).search(state, rootPlayer);
      const ordered = new AlphaBetaAI({ depth, useMoveOrdering: true }).search(state, rootPlayer);
      assert.equal(ordered.evaluationScore, minimax.evaluationScore);
      assert.equal(ordered.evaluationScore, plain.evaluationScore);
      assert.deepEqual(exactScores(ordered), exactScores(minimax));
      assert.equal(ordered.scorePerspective, rootPlayer);
      assert.equal(ordered.candidateMoves.length, RuleEngine.getAllLegalMoves(state).length);
      assert.equal(RuleEngine.validateMove(state, ordered.bestMove!), true);
      assert.equal(exactScores(ordered).get(moveKey(ordered.bestMove!)), ordered.evaluationScore);
      const bestCount = [...exactScores(minimax).values()].filter(score =>
        score === minimax.evaluationScore).length;
      if (bestCount === 1) assert.deepEqual(ordered.bestMove, minimax.bestMove);
      assert.ok(Number.isFinite(ordered.thinkingTimeMs) && ordered.thinkingTimeMs >= 0);
    }
    assert.deepEqual(state, snapshot);
  }
});

test('ordered search keeps immediate win, defensive reply and fast mate decisions', () => {
  const immediate = withPieces({ P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A' });
  const immediateResult = new AlphaBetaAI({ depth: 1, useMoveOrdering: true }).search(immediate);
  assert.equal(immediateResult.evaluationScore, DEFAULT_EVALUATION_CONFIG.mateScore - 1);
  assert.equal(RuleEngine.executeTurn(immediate, immediateResult.bestMove!).state.winner, 'A');

  const defensive = withPieces({ P27: 'B', P08: 'A', P26: 'A', P28: 'A' },
    { currentPlayer: 'B' });
  const defenseConfig = { ...neutralConfig, templeControlWeight: 10 };
  const defense = new AlphaBetaAI({
    depth: 2, useMoveOrdering: true, evaluationConfig: defenseConfig,
  }).search(defensive);
  assert.deepEqual(defense.bestMove, { from: 'P27', to: 'P03' });
  assert.equal(defense.evaluationScore, -20);

  const fast = withPieces({ P26: 'B', P28: 'A', P29: 'A', P03: 'A' });
  const fastResult = new AlphaBetaAI({
    depth: 3, useMoveOrdering: true, evaluationConfig: neutralConfig,
  }).search(fast);
  assert.deepEqual(fastResult.bestMove, { from: 'P28', to: 'P27' });
  assert.equal(fastResult.evaluationScore, neutralConfig.mateScore - 1);
});

test('depth four slow defeat keeps its mate score and shows actual ordering effect', t => {
  const state = withPieces({
    P03: 'B', P04: 'A', P27: 'A', P08: 'A',
    P09: 'A', P07: 'A', P26: 'A', P06: 'A',
  }, { currentPlayer: 'B' });
  const snapshot = structuredClone(state);
  const minimax = new MinimaxAI({ depth: 4, evaluationConfig: neutralConfig }).search(state);
  const plain = new AlphaBetaAI({ depth: 4, evaluationConfig: neutralConfig }).search(state);
  const ordered = new AlphaBetaAI({
    depth: 4, evaluationConfig: neutralConfig, useMoveOrdering: true,
  }).search(state);
  assert.equal(ordered.evaluationScore, minimax.evaluationScore);
  assert.equal(ordered.evaluationScore, plain.evaluationScore);
  assert.equal(ordered.evaluationScore, -neutralConfig.mateScore + 4);
  assert.deepEqual(exactScores(ordered), exactScores(minimax));
  assert.ok(['P02', 'P28'].includes(ordered.bestMove!.to));
  assert.equal(exactScores(ordered).get(moveKey(ordered.bestMove!)), ordered.evaluationScore);
  assert.ok(ordered.nodesSearched < plain.nodesSearched);
  assert.deepEqual(state, snapshot);
  t.diagnostic(JSON.stringify({
    fixture: 'P03 lone B, seven A blockers', depth: 4,
    score: ordered.evaluationScore, bestMove: ordered.bestMove,
    plainNodes: plain.nodesSearched, plainCutoffs: plain.cutoffs,
    plainTimeMs: plain.thinkingTimeMs,
    orderedNodes: ordered.nodesSearched, orderedCutoffs: ordered.cutoffs,
    orderedTimeMs: ordered.thinkingTimeMs,
  }));
});

test('ordered search retains terminal and ambiguity behavior', () => {
  const terminal = RuleEngine.executeTurn(
    withPieces({ P27: 'B', P26: 'A', P28: 'A', P29: 'A', P03: 'A', P21: 'A' }),
    { from: 'P21', to: 'P22' },
  ).state;
  const result = new AlphaBetaAI({ depth: 3, useMoveOrdering: true }).search(terminal, 'A');
  assert.equal(result.evaluationScore, DEFAULT_EVALUATION_CONFIG.mateScore);
  assert.equal(result.bestMove, null);
  assert.equal(result.nodesSearched, 1);

  const ambiguous = withPieces({
    P03: 'B', P13: 'B', P02: 'A', P04: 'A', P27: 'A', P08: 'A',
    P09: 'A', P07: 'A', P26: 'A', P28: 'A', P12: 'A', P14: 'A',
    P18: 'A', P19: 'A', P17: 'A',
  }, { currentPlayer: 'B' });
  assert.throws(() => new AlphaBetaAI({ depth: 1, useMoveOrdering: true }).search(ambiguous),
    RuleAmbiguityError);
});

test('ordered search reports a real no-move child when it is visited', () => {
  const state = withPieces({
    P03: 'B', P13: 'B', P02: 'A', P04: 'A', P29: 'A', P08: 'A',
    P09: 'A', P07: 'A', P26: 'A', P28: 'A', P12: 'A', P14: 'A',
    P18: 'A', P19: 'A', P17: 'A',
  });
  const snapshot = structuredClone(state);
  const child = RuleEngine.executeTurn(state, { from: 'P29', to: 'P27' }).state;
  assert.equal(child.game_status, 'PLAYING');
  assert.deepEqual(RuleEngine.getAllLegalMoves(child), []);
  assert.throws(() => new AlphaBetaAI({ depth: 2, useMoveOrdering: true }).search(state),
    RuleAmbiguityError);
  assert.deepEqual(state, snapshot);
});
