import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NODE_IDS,
  RuleEngine,
  createInitialGameState,
  detectValidCapturePatterns,
  getLegalMoves,
} from '../miniprogram/domain/index.ts';

function withPieces(
  pieces: Record<string, 'A' | 'B'>,
  { currentPlayer = 'A' as 'A' | 'B', reserveA = 4, reserveB = 4 } = {},
) {
  const initial = createInitialGameState({ firstPlayer: currentPlayer });
  const occupancy = { ...initial.board.occupancy };
  for (const id of NODE_IDS) occupancy[id] = null;
  for (const [id, player] of Object.entries(pieces)) {
    occupancy[id as typeof NODE_IDS[number]] = player;
  }
  return {
    ...initial,
    board: { occupancy },
    players: { A: { reserve_count: reserveA }, B: { reserve_count: reserveB } },
  };
}

test('RuleEngine provides one facade over the existing rules', () => {
  const initial = RuleEngine.initializeGame({ firstPlayer: 'B' });
  assert.equal(initial.current_player, 'B');
  assert.equal(RuleEngine.validateMove(initial, { from: 'P05', to: 'P04' }), true);
  assert.deepEqual(RuleEngine.getAllLegalMoves(initial), getLegalMoves(initial));
  assert.deepEqual(RuleEngine.getLegalMoves(initial), getLegalMoves(initial));
  assert.deepEqual(RuleEngine.findCommonLine('P29', 'P03'), {
    lineId: 'V3', nodes: ['P29', 'P27', 'P03'],
  });
  assert.deepEqual(RuleEngine.getPath('P29', 'P03'), RuleEngine.findCommonLine('P29', 'P03'));
  assert.equal(RuleEngine.isPathClear(initial.board, 'P29', 'P03'), true);
  assert.equal(RuleEngine.isContinuousThree(['P29', 'P27', 'P03']), true);
  assert.equal(RuleEngine.isContinuousThree(['P29', 'P26', 'P03']), false);
  assert.equal(RuleEngine.checkWinner(initial), null);
});

test('capture helpers on the facade delegate to the existing pattern and resolution rules', () => {
  const before = withPieces({ P01: 'A', P02: 'B', P04: 'A', P29: 'B' });
  const after = RuleEngine.applyNormalMove(before, { from: 'P04', to: 'P03' });
  const patterns = RuleEngine.detectAllCapturePatterns(after, 'A');
  assert.deepEqual(RuleEngine.detectClampPatterns(after, 'A'), patterns);
  assert.deepEqual(RuleEngine.detectCarryPatterns(after, 'A'), []);
  assert.equal(RuleEngine.checkLineExclusive(after, 'H1', ['P01', 'P02', 'P03']), true);
  assert.deepEqual(RuleEngine.filterNewPatterns(before, after, 'A'), RuleEngine.detectNewCapturePatterns(before, after, 'A'));
  assert.deepEqual(RuleEngine.filterSpecialCaptureRules(after, 'A', patterns), patterns);
  const resolution = RuleEngine.resolveCapture(after, 'A', RuleEngine.filterNewPatterns(before, after, 'A'));
  assert.deepEqual(resolution.result.captured_nodes, ['P02']);
  assert.equal(resolution.state.board.occupancy.P02, 'A');
  assert.equal(RuleEngine.checkCaptureAll(resolution.state, 'A'), null);
});

test('all generated moves match validation and all valid destinations are generated', () => {
  for (const state of [createInitialGameState(), withPieces({ P29: 'A', P13: 'B' })]) {
    const generated = RuleEngine.getAllLegalMoves(state);
    const keys = new Set(generated.map(move => `${move.from}-${move.to}`));
    assert.equal(keys.size, generated.length);
    for (const from of NODE_IDS) for (const to of NODE_IDS) {
      assert.equal(keys.has(`${from}-${to}`), RuleEngine.validateMove(state, { from, to }), `${from}-${to}`);
    }
  }
});

test('RuleEngine queries either player without changing the real turn or finished status', () => {
  const state = createInitialGameState();
  const snapshot = structuredClone(state);
  const forA = RuleEngine.getAllLegalMovesForPlayer(state, 'A');
  const forB = RuleEngine.getAllLegalMovesForPlayer(state, 'B');
  assert.deepEqual(forA, RuleEngine.getAllLegalMoves(state));
  assert.deepEqual(forB, RuleEngine.getAllLegalMoves({ ...state, current_player: 'B' }));
  assert.ok(forA.length > 0);
  assert.ok(forB.length > 0);
  assert.deepEqual(state, snapshot);

  const finished = { ...state, game_status: 'FINISHED' as const, winner: 'A' as const, winner_reason: 'CAPTURE_ALL' as const };
  assert.deepEqual(RuleEngine.getAllLegalMovesForPlayer(finished, 'A'), []);
  assert.deepEqual(RuleEngine.getAllLegalMovesForPlayer(finished, 'B'), []);
});

test('the full turn entry accepts long horizontal, vertical, diagonal, and temple lines', () => {
  for (const move of [
    { from: 'P01', to: 'P04' },
    { from: 'P01', to: 'P16' },
    { from: 'P01', to: 'P25' },
    { from: 'P03', to: 'P26' },
    { from: 'P29', to: 'P03' },
    { from: 'P29', to: 'P26' },
    { from: 'P26', to: 'P28' },
  ] as const) {
    const before = withPieces({ [move.from]: 'A', P05: 'B' });
    const turn = RuleEngine.executeTurn(before, move);
    assert.equal(turn.board_after.occupancy[move.from], null, `${move.from}-${move.to}`);
    assert.equal(turn.board_after.occupancy[move.to], 'A', `${move.from}-${move.to}`);
    assert.equal(turn.state.current_player, 'B', `${move.from}-${move.to}`);
  }
  const blocked = withPieces({ P29: 'A', P27: 'B', P05: 'B' });
  assert.equal(RuleEngine.isPathClear(blocked.board, 'P29', 'P03'), false);
  assert.throws(() => RuleEngine.executeTurn(blocked, { from: 'P29', to: 'P03' }), /illegal/i);
});

test('a normal turn returns complete snapshots, no captures, and the next player', () => {
  const before = createInitialGameState();
  const snapshot = structuredClone(before);
  const move = { from: 'P01', to: 'P02' } as const;
  const turn = RuleEngine.executeTurn(before, move);
  assert.deepEqual(before, snapshot);
  assert.notEqual(turn.before_state, before);
  assert.deepEqual(turn.before_state, before);
  assert.deepEqual(turn.move, move);
  assert.equal(turn.board_before.occupancy.P01, 'A');
  assert.equal(turn.board_before.occupancy.P02, null);
  assert.equal(turn.board_after.occupancy.P01, null);
  assert.equal(turn.board_after.occupancy.P02, 'A');
  assert.equal(turn.board_after, turn.state.board);
  assert.deepEqual(turn.reserve_before, { A: 4, B: 4 });
  assert.deepEqual(turn.reserve_after, { A: 4, B: 4 });
  assert.deepEqual(turn.captures.captured_nodes, []);
  assert.equal(turn.captures.was_applied, false);
  assert.equal(turn.capture, turn.captures);
  assert.equal(turn.state.current_player, 'B');
  assert.equal(turn.winner, null);
  assert.equal(turn.winner_reason, null);
  assert.equal(turn.game_over, false);
});

test('independent turn simulations do not mutate their shared input', () => {
  const initial = createInitialGameState();
  const snapshot = structuredClone(initial);
  const branchOne = RuleEngine.executeTurn(initial, { from: 'P01', to: 'P02' });
  const branchTwo = RuleEngine.executeTurn(initial, { from: 'P01', to: 'P03' });
  assert.deepEqual(initial, snapshot);
  assert.equal(branchOne.state.board.occupancy.P02, 'A');
  assert.equal(branchOne.state.board.occupancy.P03, null);
  assert.equal(branchTwo.state.board.occupancy.P02, null);
  assert.equal(branchTwo.state.board.occupancy.P03, 'A');
  assert.notEqual(branchOne.state.board, branchTwo.state.board);
});

test('a complete CLAMP turn replaces one enemy piece and spends one reserve', () => {
  const before = withPieces({ P01: 'A', P02: 'B', P04: 'A', P29: 'B' });
  const turn = RuleEngine.executeTurn(before, { from: 'P04', to: 'P03' });
  assert.deepEqual(turn.captures.patterns.map(pattern => [pattern.capture_type, pattern.line_id]), [['CLAMP', 'H1']]);
  assert.deepEqual(turn.captures.captured_nodes, ['P02']);
  assert.deepEqual(turn.captures.replacement_nodes, ['P02']);
  assert.equal(turn.captures.reserve_used, 1);
  assert.equal(turn.board_after.occupancy.P02, 'A');
  assert.equal(turn.board_after.occupancy.P04, null);
  assert.equal(turn.reserve_after.A, 3);
  assert.equal(turn.state.current_player, 'B');
  assert.equal(turn.game_over, false);
});

test('a complete CARRY turn replaces both ends and spends two reserves', () => {
  const before = withPieces({ P01: 'B', P03: 'B', P29: 'B', P07: 'A' });
  const turn = RuleEngine.executeTurn(before, { from: 'P07', to: 'P02' });
  assert.deepEqual(turn.captures.patterns.map(pattern => [pattern.capture_type, pattern.line_id]), [['CARRY', 'H1']]);
  assert.deepEqual(turn.captures.captured_nodes, ['P01', 'P03']);
  assert.equal(turn.captures.required_reserve, 2);
  assert.equal(turn.captures.reserve_used, 2);
  assert.equal(turn.board_after.occupancy.P01, 'A');
  assert.equal(turn.board_after.occupancy.P03, 'A');
  assert.equal(turn.reserve_after.A, 2);
  assert.equal(turn.state.current_player, 'B');
});

test('moving a tail away creates a new CLAMP without moving a segment piece', () => {
  const before = withPieces({ P01: 'A', P02: 'B', P03: 'A', P05: 'A', P29: 'B' });
  assert.equal(detectValidCapturePatterns(before, 'A').some(pattern => pattern.line_id === 'H1'), false);
  const turn = RuleEngine.executeTurn(before, { from: 'P05', to: 'P10' });
  assert.deepEqual(turn.captures.patterns.map(pattern => pattern.line_id), ['H1']);
  assert.deepEqual(turn.captures.patterns[0].segment_nodes, ['P01', 'P02', 'P03']);
  assert.equal(turn.captures.patterns[0].created_by_move, true);
  assert.equal(turn.board_after.occupancy.P02, 'A');
  assert.equal(turn.board_after.occupancy.P10, 'A');
  assert.equal(turn.reserve_after.A, 3);
});

test('one move resolves every new pattern, deduplicates nodes, and spends reserve once', () => {
  const before = withPieces({ P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A', P05: 'B' });
  const turn = RuleEngine.executeTurn(before, { from: 'P19', to: 'P13' });
  assert.deepEqual(turn.captures.patterns.map(pattern => [pattern.capture_type, pattern.line_id]), [
    ['CLAMP', 'H3'], ['CARRY', 'V3'],
  ]);
  assert.deepEqual(turn.captures.captured_nodes, ['P12', 'P08', 'P18']);
  assert.equal(new Set(turn.captures.captured_nodes).size, 3);
  assert.equal(turn.captures.required_reserve, 3);
  assert.equal(turn.captures.reserve_used, 3);
  for (const node of turn.captures.captured_nodes) assert.equal(turn.board_after.occupancy[node], 'A');
  assert.equal(turn.reserve_after.A, 1);
  assert.equal(turn.state.current_player, 'B');
  assert.equal(turn.game_over, false);
});

test('two new CLAMP patterns sharing one enemy spend only one reserve', () => {
  const before = withPieces({ P01: 'A', P06: 'A', P08: 'A', P09: 'A', P02: 'B', P07: 'B' });
  const turn = RuleEngine.executeTurn(before, { from: 'P09', to: 'P13' });
  assert.deepEqual(turn.captures.patterns.map(pattern => [pattern.capture_type, pattern.line_id]), [
    ['CLAMP', 'H2'], ['CLAMP', 'D1'],
  ]);
  assert.deepEqual(turn.captures.captured_nodes, ['P07']);
  assert.equal(turn.captures.required_reserve, 1);
  assert.equal(turn.captures.reserve_used, 1);
  assert.equal(turn.board_after.occupancy.P07, 'A');
  assert.equal(turn.reserve_after.A, 3);
  assert.equal(turn.state.current_player, 'B');
});

test('one move can resolve two CARRY patterns in different directions', () => {
  const before = withPieces({ P19: 'A', P12: 'B', P14: 'B', P08: 'B', P18: 'B', P05: 'B' });
  const turn = RuleEngine.executeTurn(before, { from: 'P19', to: 'P13' });
  assert.deepEqual(turn.captures.patterns.map(pattern => [pattern.capture_type, pattern.line_id]), [
    ['CARRY', 'H3'], ['CARRY', 'V3'],
  ]);
  assert.deepEqual(turn.captures.captured_nodes, ['P12', 'P14', 'P08', 'P18']);
  assert.equal(turn.captures.required_reserve, 4);
  assert.equal(turn.captures.reserve_used, 4);
  assert.equal(turn.reserve_after.A, 0);
  assert.equal(turn.board_after.occupancy.P05, 'B');
  assert.equal(turn.game_over, false);
});

test('a capture replacement that creates another pattern does not capture recursively', () => {
  const before = withPieces({ P01: 'A', P04: 'A', P12: 'A', P02: 'B', P07: 'B', P29: 'B' });
  const turn = RuleEngine.executeTurn(before, { from: 'P04', to: 'P03' });
  assert.deepEqual(turn.captures.patterns.map(pattern => pattern.line_id), ['H1']);
  assert.deepEqual(turn.captures.captured_nodes, ['P02']);
  assert.equal(turn.board_after.occupancy.P07, 'B');
  assert.equal(turn.reserve_after.A, 3);
  assert.ok(detectValidCapturePatterns(turn.state, 'A').some(pattern => pattern.line_id === 'V2'));
});

test('an already existing capture pattern is not resolved by an unrelated move', () => {
  const before = withPieces({ P01: 'A', P03: 'A', P25: 'A', P02: 'B', P29: 'B' });
  assert.ok(detectValidCapturePatterns(before, 'A').some(pattern => pattern.line_id === 'H1'));
  const turn = RuleEngine.executeTurn(before, { from: 'P25', to: 'P24' });
  assert.deepEqual(turn.captures.patterns, []);
  assert.equal(turn.board_after.occupancy.P02, 'B');
  assert.equal(turn.reserve_after.A, 4);
});

test('insufficient reserve cancels every capture but keeps the normal move', () => {
  const before = withPieces({ P01: 'B', P03: 'B', P29: 'B', P07: 'A' }, { reserveA: 1 });
  const turn = RuleEngine.executeTurn(before, { from: 'P07', to: 'P02' });
  assert.equal(turn.captures.failure_reason, 'INSUFFICIENT_RESERVE');
  assert.equal(turn.captures.was_applied, false);
  assert.equal(turn.captures.required_reserve, 2);
  assert.equal(turn.captures.reserve_used, 0);
  assert.equal(turn.board_after.occupancy.P07, null);
  assert.equal(turn.board_after.occupancy.P02, 'A');
  assert.equal(turn.board_after.occupancy.P01, 'B');
  assert.equal(turn.board_after.occupancy.P03, 'B');
  assert.equal(turn.reserve_after.A, 1);
  assert.equal(turn.state.current_player, 'B');
});

test('multi-pattern insufficient reserve is atomic for the entire capture stage', () => {
  const before = withPieces(
    { P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A' },
    { reserveA: 2 },
  );
  const turn = RuleEngine.executeTurn(before, { from: 'P19', to: 'P13' });
  assert.equal(turn.captures.patterns.length, 2);
  assert.equal(turn.captures.required_reserve, 3);
  assert.equal(turn.captures.failure_reason, 'INSUFFICIENT_RESERVE');
  assert.deepEqual(turn.captures.captured_nodes, []);
  for (const node of ['P12', 'P08', 'P18'] as const) assert.equal(turn.board_after.occupancy[node], 'B');
  assert.equal(turn.board_after.occupancy.P19, null);
  assert.equal(turn.board_after.occupancy.P13, 'A');
  assert.equal(turn.reserve_after.A, 2);
  assert.equal(turn.state.current_player, 'B');
  assert.equal(turn.game_over, false);
});

test('two enemy pieces cannot be carried in a full turn', () => {
  const before = withPieces({ P01: 'B', P03: 'B', P07: 'A' });
  const turn = RuleEngine.executeTurn(before, { from: 'P07', to: 'P02' });
  assert.equal(turn.captures.failure_reason, 'TWO_PIECES_CANNOT_CARRY');
  assert.equal(turn.captures.was_applied, false);
  assert.equal(turn.board_after.occupancy.P01, 'B');
  assert.equal(turn.board_after.occupancy.P03, 'B');
  assert.equal(turn.reserve_after.A, 4);
});

test('one enemy piece cannot be clamped in a full turn', () => {
  const before = withPieces({ P01: 'A', P02: 'B', P04: 'A' });
  const turn = RuleEngine.executeTurn(before, { from: 'P04', to: 'P03' });
  assert.equal(turn.captures.failure_reason, 'LAST_PIECE_CANNOT_CLAMP');
  assert.equal(turn.captures.was_applied, false);
  assert.equal(turn.board_after.occupancy.P02, 'B');
  assert.equal(turn.reserve_after.A, 4);
  assert.equal(turn.game_over, false);
});

test('capture all wins before switching players and agrees with TurnResult', () => {
  const before = withPieces({ P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A' });
  const turn = RuleEngine.executeTurn(before, { from: 'P19', to: 'P13' });
  assert.equal(turn.captures.was_applied, true);
  assert.equal(turn.winner, 'A');
  assert.equal(turn.winner_reason, 'CAPTURE_ALL');
  assert.equal(turn.game_over, true);
  assert.equal(turn.state.game_status, 'FINISHED');
  assert.equal(turn.state.current_player, 'A');
  assert.equal(turn.state.winner, turn.winner);
  assert.equal(turn.state.winner_reason, turn.winner_reason);
  assert.deepEqual(RuleEngine.checkWinner(turn.state), { winner: 'A', reason: 'CAPTURE_ALL' });
});

test('temple trap is checked only after switching to the trapped player', () => {
  const before = withPieces({ P27: 'B', P26: 'A', P28: 'A', P29: 'A', P03: 'A', P21: 'A' });
  const turn = RuleEngine.executeTurn(before, { from: 'P21', to: 'P22' });
  assert.deepEqual(getLegalMoves(turn.state), []);
  assert.equal(turn.state.current_player, 'B');
  assert.equal(turn.winner, 'A');
  assert.equal(turn.winner_reason, 'TEMPLE_TRAP');
  assert.equal(turn.game_over, true);
  assert.equal(turn.state.game_status, 'FINISHED');
});

test('a lone temple piece with a legal move keeps the game active', () => {
  const before = withPieces({ P27: 'B', P21: 'A' });
  const turn = RuleEngine.executeTurn(before, { from: 'P21', to: 'P22' });
  assert.equal(turn.state.current_player, 'B');
  assert.ok(RuleEngine.getAllLegalMoves(turn.state).some(move => move.from === 'P27' && move.to === 'P26'));
  assert.equal(turn.game_over, false);
  assert.equal(turn.winner, null);
});

test('a blocked lone piece on P03 loses only after the turn switches to it', () => {
  const before = withPieces({
    P03: 'B', P02: 'A', P04: 'A', P27: 'A', P08: 'A',
    P09: 'A', P07: 'A', P26: 'A', P28: 'A', P21: 'A',
  });
  assert.equal(RuleEngine.checkLonePieceImmobilized(before), null);
  const turn = RuleEngine.executeTurn(before, { from: 'P21', to: 'P22' });
  assert.deepEqual(getLegalMoves(turn.state), []);
  assert.equal(turn.state.current_player, 'B');
  assert.equal(turn.game_over, true);
  assert.equal(turn.winner, 'A');
  assert.equal(turn.winner_reason, 'LONE_PIECE_IMMOBILIZED');
  assert.deepEqual(RuleEngine.checkWinner(turn.state), {
    winner: 'A', reason: 'LONE_PIECE_IMMOBILIZED',
  });
});

test('an immobilized lone piece on an ordinary node also loses after the turn', () => {
  const before = withPieces({
    P13: 'B', P12: 'A', P14: 'A', P08: 'A', P18: 'A',
    P07: 'A', P19: 'A', P09: 'A', P17: 'A', P21: 'A',
  });
  const turn = RuleEngine.executeTurn(before, { from: 'P21', to: 'P22' });
  assert.deepEqual(getLegalMoves(turn.state), []);
  assert.equal(turn.state.current_player, 'B');
  assert.equal(turn.state.game_status, 'FINISHED');
  assert.equal(turn.winner, 'A');
  assert.equal(turn.winner_reason, 'LONE_PIECE_IMMOBILIZED');
});

test('blocking a lone piece last exit with the current move ends the game after switching', () => {
  const before = withPieces({ P01: 'B', P06: 'A', P07: 'A', P03: 'A' });
  assert.ok(RuleEngine.getAllLegalMovesForPlayer(before, 'B').some(move =>
    move.from === 'P01' && move.to === 'P02'));
  const turn = RuleEngine.executeTurn(before, { from: 'P03', to: 'P02' });
  assert.deepEqual(turn.captures.captured_nodes, []);
  assert.deepEqual(RuleEngine.getAllLegalMoves(turn.state), []);
  assert.equal(turn.state.current_player, 'B');
  assert.equal(turn.winner, 'A');
  assert.equal(turn.winner_reason, 'LONE_PIECE_IMMOBILIZED');
});

test('capture that leaves one blocked survivor checks immobilization after capture', () => {
  const before = withPieces({
    P01: 'B', P12: 'B', P11: 'A', P19: 'A', P02: 'A', P06: 'A', P07: 'A',
  });
  const turn = RuleEngine.executeTurn(before, { from: 'P19', to: 'P13' });
  assert.deepEqual(turn.captures.captured_nodes, ['P12']);
  assert.equal(turn.state.board.occupancy.P01, 'B');
  assert.equal(turn.state.board.occupancy.P12, 'A');
  assert.equal(turn.state.current_player, 'B');
  assert.equal(turn.winner, 'A');
  assert.equal(turn.winner_reason, 'LONE_PIECE_IMMOBILIZED');
});

test('two immobilized pieces do not lose after the turn switches to them', () => {
  const before = withPieces({
    P03: 'B', P13: 'B', P02: 'A', P04: 'A', P27: 'A', P08: 'A',
    P09: 'A', P07: 'A', P26: 'A', P28: 'A', P12: 'A', P14: 'A',
    P18: 'A', P19: 'A', P17: 'A', P21: 'A', P16: 'A',
  });
  const turn = RuleEngine.executeTurn(before, { from: 'P16', to: 'P11' });
  assert.deepEqual(turn.captures.captured_nodes, []);
  assert.deepEqual(RuleEngine.getAllLegalMoves(turn.state), []);
  assert.equal(turn.state.current_player, 'B');
  assert.equal(turn.winner_reason, null);
  assert.equal(turn.game_over, false);
  assert.equal(turn.winner, null);
});

test('invalid and finished turns reject moves without mutating the input state', () => {
  const before = createInitialGameState();
  const snapshot = structuredClone(before);
  for (const move of [
    { from: 'P02', to: 'P03' }, // empty source
    { from: 'P05', to: 'P04' }, // opponent source
    { from: 'P01', to: 'P06' }, // occupied target
    { from: 'P01', to: 'P08' }, // not one declared line
    { from: 'P01', to: 'P11' }, // blocked by P06
    { from: 'P01', to: 'P26' }, // would turn through P03
  ] as const) {
    assert.throws(() => RuleEngine.executeTurn(before, move), /illegal/i);
    assert.deepEqual(before, snapshot);
  }
  const finished = RuleEngine.executeTurn(
    withPieces({ P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A' }),
    { from: 'P19', to: 'P13' },
  ).state;
  const finishedSnapshot = structuredClone(finished);
  assert.throws(() => RuleEngine.executeTurn(finished, { from: 'P11', to: 'P12' }), /finished/i);
  assert.deepEqual(finished, finishedSnapshot);
  assert.equal(RuleEngine.validateMove(finished, { from: 'P11', to: 'P12' }), false);
  assert.deepEqual(RuleEngine.getAllLegalMoves(finished), []);
});
