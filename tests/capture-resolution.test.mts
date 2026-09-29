import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NODE_IDS,
  createInitialGameState,
  applyBasicMove,
  countPieces,
  detectValidCapturePatterns,
  detectNewCapturePatterns,
  filterCapturePatterns,
  resolveCaptures,
} from '../miniprogram/domain/index.ts';

function withPieces(
  pieces: Record<string, 'A' | 'B'>,
  { reserveA = 4, reserveB = 4, currentPlayer = 'A' as 'A' | 'B' } = {},
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

function newPatterns(state: ReturnType<typeof withPieces>, player: 'A' | 'B' = 'A') {
  return detectValidCapturePatterns(state, player).map(pattern => ({ ...pattern, created_by_move: true }));
}

test('two on-board enemy pieces prohibit CARRY even when enemy reserve exists', () => {
  const afterMove = withPieces({ P01: 'B', P02: 'A', P03: 'B' }, { reserveB: 9 });
  const patterns = newPatterns(afterMove);
  assert.equal(countPieces(afterMove.board, 'B'), 2);
  assert.equal(patterns.length, 1);
  assert.deepEqual(filterCapturePatterns(afterMove, 'A', patterns), []);
  const { state, result } = resolveCaptures(afterMove, 'A', patterns);
  assert.equal(state, afterMove);
  assert.equal(state.board.occupancy.P01, 'B');
  assert.equal(state.board.occupancy.P03, 'B');
  assert.equal(state.players.A.reserve_count, 4);
  assert.equal(result.was_applied, false);
  assert.equal(result.reserve_used, 0);
  assert.equal(result.failure_reason, 'TWO_PIECES_CANNOT_CARRY');
});

test('one on-board enemy piece prohibits CLAMP', () => {
  const afterMove = withPieces({ P01: 'A', P02: 'B', P03: 'A' });
  const patterns = newPatterns(afterMove);
  assert.equal(countPieces(afterMove.board, 'B'), 1);
  assert.deepEqual(filterCapturePatterns(afterMove, 'A', patterns), []);
  const { state, result } = resolveCaptures(afterMove, 'A', patterns);
  assert.equal(state, afterMove);
  assert.equal(state.board.occupancy.P02, 'B');
  assert.equal(state.players.A.reserve_count, 4);
  assert.equal(result.failure_reason, 'LAST_PIECE_CANNOT_CLAMP');
  assert.equal(result.was_applied, false);
});

test('a legal CLAMP replaces one enemy node and uses one reserve', () => {
  const afterMove = withPieces({ P01: 'A', P02: 'B', P03: 'A', P29: 'B' });
  const patterns = newPatterns(afterMove);
  const { state, result } = resolveCaptures(afterMove, 'A', patterns);
  assert.deepEqual(result.patterns.map(pattern => pattern.line_id), ['H1']);
  assert.deepEqual(result.captured_nodes, ['P02']);
  assert.deepEqual(result.replacement_nodes, ['P02']);
  assert.equal(result.required_reserve, 1);
  assert.equal(result.reserve_used, 1);
  assert.equal(result.was_applied, true);
  assert.equal(result.failure_reason, 'NONE');
  assert.equal(state.board.occupancy.P02, 'A');
  assert.equal(state.players.A.reserve_count, 3);
  assert.equal(state.players.B.reserve_count, 4);
  assert.equal(afterMove.board.occupancy.P02, 'B');
});

test('Player B can resolve CLAMP as the explicit attacker', () => {
  const afterMove = withPieces({ P01: 'B', P02: 'A', P03: 'B', P29: 'A' });
  const { state, result } = resolveCaptures(afterMove, 'B', newPatterns(afterMove, 'B'));
  assert.equal(state.board.occupancy.P02, 'B');
  assert.equal(state.players.B.reserve_count, 3);
  assert.equal(result.was_applied, true);
});

test('a legal CARRY replaces both enemy nodes in one resolution', () => {
  const afterMove = withPieces({ P01: 'B', P02: 'A', P03: 'B', P29: 'B' });
  const { state, result } = resolveCaptures(afterMove, 'A', newPatterns(afterMove));
  assert.deepEqual(result.patterns.map(pattern => pattern.capture_type), ['CARRY']);
  assert.deepEqual(result.captured_nodes, ['P01', 'P03']);
  assert.deepEqual(result.replacement_nodes, ['P01', 'P03']);
  assert.equal(result.required_reserve, 2);
  assert.equal(result.reserve_used, 2);
  assert.equal(result.was_applied, true);
  assert.equal(state.board.occupancy.P01, 'A');
  assert.equal(state.board.occupancy.P03, 'A');
  assert.equal(state.players.A.reserve_count, 2);
});

test('insufficient reserve cancels all CARRY replacements', () => {
  const afterMove = withPieces({ P01: 'B', P02: 'A', P03: 'B', P29: 'B' }, { reserveA: 1 });
  const { state, result } = resolveCaptures(afterMove, 'A', newPatterns(afterMove));
  assert.equal(state, afterMove);
  assert.equal(state.board.occupancy.P01, 'B');
  assert.equal(state.board.occupancy.P03, 'B');
  assert.equal(state.players.A.reserve_count, 1);
  assert.equal(result.required_reserve, 2);
  assert.deepEqual(result.captured_nodes, []);
  assert.deepEqual(result.replacement_nodes, []);
  assert.equal(result.reserve_used, 0);
  assert.equal(result.was_applied, false);
  assert.equal(result.failure_reason, 'INSUFFICIENT_RESERVE');
});

test('three unique captures with reserve two cancel entirely while preserving the normal move', () => {
  const before = withPieces({ P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A' }, { reserveA: 2 });
  const afterMove = applyBasicMove(before, { from: 'P19', to: 'P13' });
  const patterns = detectNewCapturePatterns(before, afterMove, 'A');
  assert.deepEqual(patterns.map(pattern => pattern.capture_type), ['CLAMP', 'CARRY']);
  const { state, result } = resolveCaptures(afterMove, 'A', patterns);
  assert.equal(state, afterMove);
  assert.equal(state.board.occupancy.P19, null);
  assert.equal(state.board.occupancy.P13, 'A');
  for (const id of ['P12', 'P08', 'P18'] as const) assert.equal(state.board.occupancy[id], 'B');
  assert.equal(state.players.A.reserve_count, 2);
  assert.equal(result.required_reserve, 3);
  assert.equal(result.reserve_used, 0);
  assert.equal(result.was_applied, false);
  assert.equal(result.failure_reason, 'INSUFFICIENT_RESERVE');
});

test('two CLAMP patterns sharing P12 consume only one reserve', () => {
  const afterMove = withPieces({ P11: 'A', P12: 'B', P13: 'A', P07: 'A', P17: 'A', P29: 'B' });
  const patterns = newPatterns(afterMove);
  assert.deepEqual(patterns.map(pattern => pattern.line_id), ['H3', 'V2']);
  const { state, result } = resolveCaptures(afterMove, 'A', patterns);
  assert.equal(result.patterns.length, 2);
  assert.deepEqual(result.captured_nodes, ['P12']);
  assert.deepEqual(result.replacement_nodes, ['P12']);
  assert.equal(result.required_reserve, 1);
  assert.equal(result.reserve_used, 1);
  assert.equal(state.board.occupancy.P12, 'A');
  assert.equal(state.players.A.reserve_count, 3);
});

test('two CARRY patterns resolve all four unique enemy nodes together', () => {
  const afterMove = withPieces({ P13: 'A', P12: 'B', P14: 'B', P08: 'B', P18: 'B' });
  const patterns = newPatterns(afterMove);
  assert.deepEqual(patterns.map(pattern => pattern.line_id), ['H3', 'V3']);
  const { state, result } = resolveCaptures(afterMove, 'A', patterns);
  assert.equal(result.patterns.length, 2);
  assert.deepEqual(result.captured_nodes, ['P12', 'P14', 'P08', 'P18']);
  assert.equal(result.required_reserve, 4);
  assert.equal(result.reserve_used, 4);
  assert.equal(result.was_applied, true);
  for (const id of result.captured_nodes) assert.equal(state.board.occupancy[id], 'A');
  assert.equal(state.players.A.reserve_count, 0);
});

test('CLAMP and CARRY can share a resolution with globally deduplicated nodes', () => {
  const afterMove = withPieces({ P07: 'A', P12: 'B', P17: 'A', P13: 'A', P14: 'B', P29: 'B' });
  const patterns = newPatterns(afterMove);
  assert.deepEqual(patterns.map(pattern => pattern.capture_type), ['CARRY', 'CLAMP']);
  const { state, result } = resolveCaptures(afterMove, 'A', patterns);
  assert.deepEqual(result.captured_nodes, ['P12', 'P14']);
  assert.equal(result.required_reserve, 2);
  assert.equal(result.reserve_used, 2);
  assert.equal(state.board.occupancy.P12, 'A');
  assert.equal(state.board.occupancy.P14, 'A');
});

test('a forbidden CARRY does not discard a simultaneous legal CLAMP', () => {
  const afterMove = withPieces({ P07: 'A', P12: 'B', P17: 'A', P13: 'A', P14: 'B' });
  const patterns = newPatterns(afterMove);
  assert.equal(countPieces(afterMove.board, 'B'), 2);
  assert.deepEqual(filterCapturePatterns(afterMove, 'A', patterns).map(pattern => pattern.line_id), ['V2']);
  const { state, result } = resolveCaptures(afterMove, 'A', patterns);
  assert.deepEqual(result.patterns.map(pattern => pattern.line_id), ['V2']);
  assert.deepEqual(result.captured_nodes, ['P12']);
  assert.equal(result.was_applied, true);
  assert.equal(result.failure_reason, 'NONE');
  assert.equal(state.board.occupancy.P12, 'A');
  assert.equal(state.board.occupancy.P14, 'B');
  assert.equal(state.players.A.reserve_count, 3);
});

test('no new patterns leaves after-move state unchanged with no failure', () => {
  const afterMove = withPieces({ P01: 'A', P29: 'B' });
  const { state, result } = resolveCaptures(afterMove, 'A', []);
  assert.equal(state, afterMove);
  assert.deepEqual(result.patterns, []);
  assert.deepEqual(result.captured_nodes, []);
  assert.equal(result.required_reserve, 0);
  assert.equal(result.reserve_used, 0);
  assert.equal(result.was_applied, false);
  assert.equal(result.failure_reason, 'NONE');
});

test('replacement can form another pattern but resolution never recurses', () => {
  const afterMove = withPieces({ P01: 'A', P02: 'B', P03: 'A', P07: 'B', P12: 'A', P29: 'B' });
  const { state, result } = resolveCaptures(afterMove, 'A', newPatterns(afterMove));
  assert.deepEqual(result.patterns.map(pattern => pattern.line_id), ['H1']);
  assert.equal(state.board.occupancy.P02, 'A');
  assert.equal(state.board.occupancy.P07, 'B');
  assert.equal(state.players.A.reserve_count, 3);
  assert.ok(detectValidCapturePatterns(state, 'A').some(pattern => pattern.line_id === 'V2'));
});

test('resolver rejects a captured node that is not occupied by the opponent', () => {
  const afterMove = withPieces({ P01: 'A', P02: 'B', P03: 'A', P29: 'B' });
  const invalid = { ...newPatterns(afterMove)[0], captured_nodes: ['P01'] as const };
  const snapshot = structuredClone(afterMove);
  assert.throws(() => resolveCaptures(afterMove, 'A', [invalid]), /opponent/i);
  assert.deepEqual(afterMove, snapshot);
});

test('resolution does not mutate the input state or CapturePattern descriptions', () => {
  const afterMove = withPieces({ P01: 'A', P02: 'B', P03: 'A', P29: 'B' });
  const patterns = newPatterns(afterMove);
  const stateSnapshot = structuredClone(afterMove);
  const patternSnapshot = structuredClone(patterns);
  const { state } = resolveCaptures(afterMove, 'A', patterns);
  assert.deepEqual(afterMove, stateSnapshot);
  assert.deepEqual(patterns, patternSnapshot);
  assert.notEqual(state, afterMove);
  assert.equal(state.winner, afterMove.winner);
  assert.equal(state.winner_reason, afterMove.winner_reason);
  assert.equal(state.game_status, afterMove.game_status);
});
