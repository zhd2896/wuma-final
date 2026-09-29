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

const clampForA = () => withPieces({ P01: 'A', P02: 'B', P04: 'A', P29: 'B' });

test('initial position has explicit perspective and opposite scores', () => {
  const state = createInitialGameState();
  const a = evaluatePosition(state, 'A');
  const b = evaluatePosition(state, 'B');
  assert.equal(a.scorePerspective, 'A');
  assert.equal(b.scorePerspective, 'B');
  assert.equal(a.terminal, false);
  assert.equal(b.terminal, false);
  assert.ok(a.score === -b.score);
  assert.equal(a.breakdown.material.rawValue, 0);
  assert.equal(a.breakdown.reserve.rawValue, 0);
});

test('the same board scores identically when only current_player changes', () => {
  const state = clampForA();
  const otherTurn = { ...state, current_player: 'B' as const };
  assert.deepEqual(evaluatePosition(state, 'A'), evaluatePosition(otherTurn, 'A'));
  assert.deepEqual(evaluatePosition(state, 'B'), evaluatePosition(otherTurn, 'B'));
});

test('material counts only active board pieces and reserve stays separate', () => {
  const state = withPieces({ P01: 'A', P06: 'A', P11: 'A', P05: 'B', P10: 'B' },
    { reserveA: 4, reserveB: 2 });
  const a = evaluatePosition(state, 'A');
  const b = evaluatePosition(state, 'B');
  assert.equal(a.breakdown.material.rawValue, 1);
  assert.equal(b.breakdown.material.rawValue, -1);
  assert.equal(a.breakdown.reserve.rawValue, 2);
  assert.equal(b.breakdown.reserve.rawValue, -2);
  assert.equal(a.breakdown.material.weightedScore,
    a.breakdown.material.rawValue * a.breakdown.material.weight);
  assert.equal(a.breakdown.reserve.weightedScore,
    a.breakdown.reserve.rawValue * a.breakdown.reserve.weight);
});

test('mobility is the real legal-move count difference for either player', () => {
  const state = withPieces({ P13: 'A', P01: 'B' });
  const movesA = RuleEngine.getAllLegalMovesForPlayer(state, 'A').length;
  const movesB = RuleEngine.getAllLegalMovesForPlayer(state, 'B').length;
  assert.ok(movesA > movesB);
  assert.equal(evaluatePosition(state, 'A').breakdown.mobility.rawValue, movesA - movesB);
  assert.equal(evaluatePosition(state, 'B').breakdown.mobility.rawValue, movesB - movesA);
});

test('a real CLAMP creates a capture opportunity, without evaluating a best move', () => {
  const state = clampForA();
  const turn = RuleEngine.executeTurn(state, { from: 'P04', to: 'P03' });
  assert.equal(turn.captures.was_applied, true);
  assert.deepEqual(turn.captures.captured_nodes, ['P02']);
  assert.ok(evaluatePosition(state, 'A').breakdown.captureOpportunity.rawValue > 0);
});

test('opponent capture routes create negative vulnerability contribution', () => {
  const state = withPieces({ P01: 'B', P02: 'A', P04: 'B', P29: 'A' });
  const turn = RuleEngine.executeTurn({ ...state, current_player: 'B' }, { from: 'P04', to: 'P03' });
  assert.equal(turn.captures.was_applied, true);
  const a = evaluatePosition(state, 'A');
  const b = evaluatePosition(state, 'B');
  assert.ok(a.breakdown.vulnerability.rawValue > 0);
  assert.ok(a.breakdown.vulnerability.weightedScore < 0);
  assert.ok(b.breakdown.captureOpportunity.rawValue > 0);
});

test('opportunity counts distinct capturable nodes while vulnerability counts legal capture actions', () => {
  const state = withPieces({ P01: 'B', P03: 'B', P29: 'B', P07: 'A' });
  const carry = RuleEngine.executeTurn(state, { from: 'P07', to: 'P02' });
  assert.equal(carry.captures.was_applied, true);
  assert.deepEqual(carry.captures.captured_nodes, ['P01', 'P03']);

  const a = evaluatePosition(state, 'A');
  const b = evaluatePosition(state, 'B');
  assert.equal(a.breakdown.captureOpportunity.rawValue, 2);
  assert.equal(b.breakdown.vulnerability.rawValue, 1);
  assert.ok(b.breakdown.vulnerability.weightedScore < 0);
});

test('capture rules and reserves govern whether an opportunity is counted', () => {
  const state = withPieces({ P01: 'A', P02: 'B', P04: 'A', P29: 'B' }, { reserveA: 0 });
  const turn = RuleEngine.executeTurn(state, { from: 'P04', to: 'P03' });
  assert.equal(turn.captures.was_applied, false);
  assert.equal(turn.captures.failure_reason, 'INSUFFICIENT_RESERVE');
  assert.equal(evaluatePosition(state, 'A').breakdown.captureOpportunity.rawValue, 0);
});

test('temple control excludes P03 while lone-piece mobility risk includes it', () => {
  const p03 = withPieces({ P03: 'B', P21: 'A', P25: 'A' });
  const temple = withPieces({ P27: 'B', P21: 'A', P25: 'A' });
  const ordinary = withPieces({ P13: 'B', P21: 'A', P25: 'A' });
  assert.equal(evaluatePosition(p03, 'B').breakdown.templeControl.rawValue, 0);
  assert.ok(evaluatePosition(p03, 'B').breakdown.trapRisk.rawValue > 0);
  assert.ok(evaluatePosition(ordinary, 'B').breakdown.trapRisk.rawValue > 0);
  assert.equal(evaluatePosition(temple, 'B').breakdown.templeControl.rawValue, 1);
  assert.ok(evaluatePosition(temple, 'B').breakdown.trapRisk.rawValue > 0);
});

test('a lone temple piece with fewer legal moves has higher nonterminal trap risk', () => {
  const open = withPieces({ P27: 'B', P21: 'A', P25: 'A' }, { currentPlayer: 'B' });
  const narrow = withPieces({ P27: 'B', P28: 'A', P29: 'A', P03: 'A' },
    { currentPlayer: 'B' });
  const openMoves = RuleEngine.getAllLegalMovesForPlayer(open, 'B').length;
  const narrowMoves = RuleEngine.getAllLegalMovesForPlayer(narrow, 'B').length;
  assert.ok(openMoves > narrowMoves);
  assert.ok(narrowMoves > 0);
  const openResult = evaluatePosition(open, 'B');
  const narrowResult = evaluatePosition(narrow, 'B');
  assert.equal(openResult.terminal, false);
  assert.equal(narrowResult.terminal, false);
  assert.ok(narrowResult.breakdown.trapRisk.rawValue > openResult.breakdown.trapRisk.rawValue);
  assert.ok(narrowResult.breakdown.trapRisk.weightedScore < openResult.breakdown.trapRisk.weightedScore);
});

test('a lone P03 piece with fewer exits has higher mobility risk', () => {
  const open = withPieces({ P03: 'B', P21: 'A', P25: 'A' }, { currentPlayer: 'B' });
  const narrow = withPieces({
    P03: 'B', P02: 'A', P04: 'A', P27: 'A', P08: 'A',
    P09: 'A', P07: 'A', P28: 'A',
  }, { currentPlayer: 'B' });
  const openMoves = RuleEngine.getAllLegalMovesForPlayer(open, 'B').length;
  const narrowMoves = RuleEngine.getAllLegalMovesForPlayer(narrow, 'B').length;
  assert.ok(openMoves > narrowMoves);
  assert.ok(narrowMoves > 0);
  assert.equal(evaluatePosition(narrow, 'B').breakdown.templeControl.rawValue, -2);
  assert.ok(evaluatePosition(narrow, 'B').breakdown.trapRisk.rawValue
    > evaluatePosition(open, 'B').breakdown.trapRisk.rawValue);
});

test('CAPTURE_ALL terminal scores work for A and B and bypass ordinary features', () => {
  const pieces = { P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A' } as const;
  const aWin = RuleEngine.executeTurn(withPieces(pieces), { from: 'P19', to: 'P13' }).state;
  const bPieces = Object.fromEntries(Object.entries(pieces).map(([node, player]) =>
    [node, player === 'A' ? 'B' : 'A'])) as Record<string, 'A' | 'B'>;
  const bWin = RuleEngine.executeTurn(withPieces(bPieces, { currentPlayer: 'B' }),
    { from: 'P19', to: 'P13' }).state;
  assert.equal(aWin.winner_reason, 'CAPTURE_ALL');
  assert.equal(bWin.winner_reason, 'CAPTURE_ALL');

  for (const [state, winner] of [[aWin, 'A'], [bWin, 'B']] as const) {
    const winning = evaluatePosition(state, winner);
    const losing = evaluatePosition(state, winner === 'A' ? 'B' : 'A');
    assert.equal(winning.terminal, true);
    assert.equal(winning.score, DEFAULT_EVALUATION_CONFIG.mateScore);
    assert.equal(losing.score, -DEFAULT_EVALUATION_CONFIG.mateScore);
    assert.equal(winning.breakdown.terminal.weightedScore, winning.score);
    assert.equal(winning.breakdown.material.weightedScore, 0);
    assert.equal(winning.breakdown.captureOpportunity.weightedScore, 0);
  }
});

test('TEMPLE_TRAP terminal scores override ordinary temple risk for either winner', () => {
  const trappedB = { P27: 'B', P26: 'A', P28: 'A', P29: 'A', P03: 'A', P21: 'A' } as const;
  const aWin = RuleEngine.executeTurn(withPieces(trappedB), { from: 'P21', to: 'P22' }).state;
  const trappedA = Object.fromEntries(Object.entries(trappedB).map(([node, player]) =>
    [node, player === 'A' ? 'B' : 'A'])) as Record<string, 'A' | 'B'>;
  const bWin = RuleEngine.executeTurn(withPieces(trappedA, { currentPlayer: 'B' }),
    { from: 'P21', to: 'P22' }).state;
  assert.equal(aWin.winner_reason, 'TEMPLE_TRAP');
  assert.equal(bWin.winner_reason, 'TEMPLE_TRAP');

  for (const [state, winner] of [[aWin, 'A'], [bWin, 'B']] as const) {
    assert.equal(evaluatePosition(state, winner).score, DEFAULT_EVALUATION_CONFIG.mateScore);
    const loser = winner === 'A' ? 'B' : 'A';
    const losing = evaluatePosition(state, loser);
    assert.equal(losing.score, -DEFAULT_EVALUATION_CONFIG.mateScore);
    assert.equal(losing.breakdown.trapRisk.weightedScore, 0);
  }
});

test('P03 and ordinary-node immobilization use terminal mate scores, not mobility risk', () => {
  for (const pieces of [
    {
      P03: 'B', P02: 'A', P04: 'A', P27: 'A', P08: 'A',
      P09: 'A', P07: 'A', P26: 'A', P28: 'A', P21: 'A',
    },
    {
      P13: 'B', P12: 'A', P14: 'A', P08: 'A', P18: 'A',
      P07: 'A', P19: 'A', P09: 'A', P17: 'A', P21: 'A',
    },
  ] as const) {
    const before = withPieces(pieces);
    const snapshot = structuredClone(before);
    const terminal = RuleEngine.executeTurn(before, { from: 'P21', to: 'P22' }).state;
    const terminalSnapshot = structuredClone(terminal);
    assert.equal(terminal.winner_reason, 'LONE_PIECE_IMMOBILIZED');
    const a = evaluatePosition(terminal, 'A');
    const b = evaluatePosition(terminal, 'B');
    assert.equal(a.terminal, true);
    assert.equal(a.score, DEFAULT_EVALUATION_CONFIG.mateScore);
    assert.equal(b.score, -DEFAULT_EVALUATION_CONFIG.mateScore);
    assert.equal(a.breakdown.trapRisk.weightedScore, 0);
    assert.equal(b.breakdown.trapRisk.weightedScore, 0);
    assert.deepEqual(before, snapshot);
    assert.deepEqual(terminal, terminalSnapshot);

    const mirrored = Object.fromEntries(Object.entries(pieces).map(([node, player]) =>
      [node, player === 'A' ? 'B' : 'A'])) as Record<string, 'A' | 'B'>;
    const bWin = RuleEngine.executeTurn(withPieces(mirrored, { currentPlayer: 'B' }),
      { from: 'P21', to: 'P22' }).state;
    assert.equal(bWin.winner_reason, 'LONE_PIECE_IMMOBILIZED');
    assert.equal(evaluatePosition(bWin, 'B').score, DEFAULT_EVALUATION_CONFIG.mateScore);
    assert.equal(evaluatePosition(bWin, 'A').score, -DEFAULT_EVALUATION_CONFIG.mateScore);
  }
});

test('every nonterminal breakdown sums to the score and perspectives are strictly opposite', () => {
  for (const state of [createInitialGameState(), clampForA(),
    withPieces({ P27: 'B', P21: 'A' }), withPieces({ P03: 'B', P21: 'A' }),
    withPieces({ P13: 'A', P01: 'B' })]) {
    const a = evaluatePosition(state, 'A');
    const b = evaluatePosition(state, 'B');
    for (const result of [a, b]) {
      assert.equal(result.score,
        Object.values(result.breakdown).reduce((sum, feature) => sum + feature.weightedScore, 0));
      for (const feature of Object.values(result.breakdown)) {
        assert.ok(feature.weightedScore === feature.rawValue * feature.weight);
      }
      assert.equal(result.breakdown.terminal.weightedScore, 0);
    }
    assert.ok(a.score === -b.score);
  }
});

test('custom config can isolate material and changes the terminal constant', () => {
  const config = {
    ...DEFAULT_EVALUATION_CONFIG,
    materialWeight: 37,
    reserveWeight: 0,
    mobilityWeight: 0,
    templeControlWeight: 0,
    captureOpportunityWeight: 0,
    vulnerabilityWeight: 0,
    trapRiskWeight: 0,
    mateScore: 1234567,
  };
  const state = withPieces({ P01: 'A', P06: 'A', P11: 'A', P05: 'B', P10: 'B' });
  const result = evaluatePosition(state, 'A', config);
  assert.equal(result.score, 37);
  assert.equal(result.breakdown.material.weightedScore, 37);

  const terminal = RuleEngine.executeTurn(
    withPieces({ P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A' }),
    { from: 'P19', to: 'P13' },
  ).state;
  assert.equal(evaluatePosition(terminal, 'A', config).score, config.mateScore);
});

test('evaluation is deterministic and leaves board, reserves, turn and winner untouched', () => {
  const state = clampForA();
  const snapshot = structuredClone(state);
  const first = evaluatePosition(state, 'A');
  for (let index = 0; index < 20; index++) {
    assert.deepEqual(evaluatePosition(state, 'A'), first);
  }
  assert.deepEqual(state, snapshot);
  assert.deepEqual(state.board, snapshot.board);
  assert.deepEqual(state.players, snapshot.players);
  assert.equal(state.current_player, snapshot.current_player);
  assert.equal(state.winner, snapshot.winner);
  assert.equal(state.game_status, snapshot.game_status);
});
