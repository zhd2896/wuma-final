import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NODE_IDS,
  STANDARD_TOPOLOGY,
  createInitialGameState,
  applyBasicMove,
  checkLineExclusive,
  detectValidCapturePatterns,
  detectNewCapturePatterns,
} from '../miniprogram/domain/index.ts';

function withPieces(pieces: Record<string, 'A' | 'B'>) {
  const initial = createInitialGameState();
  const occupancy = { ...initial.board.occupancy };
  for (const id of NODE_IDS) occupancy[id] = null;
  for (const [id, player] of Object.entries(pieces)) {
    occupancy[id as typeof NODE_IDS[number]] = player;
  }
  return { ...initial, board: { occupancy } };
}

function onLine(state: ReturnType<typeof withPieces>, player: 'A' | 'B', lineId: string) {
  return detectValidCapturePatterns(state, player).filter(pattern => pattern.line_id === lineId);
}

test('CLAMP identifies attacker ends and enemy center for Player A', () => {
  const state = withPieces({ P01: 'A', P02: 'B', P03: 'A' });
  assert.deepEqual(onLine(state, 'A', 'H1'), [{
    capture_type: 'CLAMP', line_id: 'H1', segment_nodes: ['P01', 'P02', 'P03'],
    attacker_nodes: ['P01', 'P03'], captured_nodes: ['P02'], created_by_move: false,
  }]);
  assert.equal(checkLineExclusive(state, 'H1', ['P01', 'P02', 'P03']), true);
});

test('CLAMP also works when Player B is the attacker', () => {
  assert.equal(onLine(withPieces({ P01: 'B', P02: 'A', P03: 'B' }), 'B', 'H1')[0]?.capture_type, 'CLAMP');
});

test('CARRY identifies attacker center and two enemy ends for Player A', () => {
  const state = withPieces({ P01: 'B', P02: 'A', P03: 'B' });
  assert.deepEqual(onLine(state, 'A', 'H1'), [{
    capture_type: 'CARRY', line_id: 'H1', segment_nodes: ['P01', 'P02', 'P03'],
    attacker_nodes: ['P02'], captured_nodes: ['P01', 'P03'], created_by_move: false,
  }]);
});

test('the same A-B-A shape is CARRY for Player B', () => {
  assert.equal(onLine(withPieces({ P01: 'A', P02: 'B', P03: 'A' }), 'B', 'H1')[0]?.capture_type, 'CARRY');
});

test('nonconsecutive triples are never CLAMP or CARRY', () => {
  assert.deepEqual(onLine(withPieces({ P01: 'A', P03: 'B', P05: 'A' }), 'A', 'H1'), []);
  assert.deepEqual(onLine(withPieces({ P01: 'B', P03: 'A', P05: 'B' }), 'A', 'H1'), []);
});

test('a tail at either end invalidates the entire H1 CLAMP line', () => {
  const rightTail = withPieces({ P01: 'A', P02: 'B', P03: 'A', P05: 'B' });
  const leftTail = withPieces({ P01: 'B', P03: 'A', P04: 'B', P05: 'A' });
  assert.equal(checkLineExclusive(rightTail, 'H1', ['P01', 'P02', 'P03']), false);
  assert.equal(checkLineExclusive(leftTail, 'H1', ['P03', 'P04', 'P05']), false);
  assert.deepEqual(onLine(rightTail, 'A', 'H1'), []);
  assert.deepEqual(onLine(leftTail, 'A', 'H1'), []);
});

test('an extra piece invalidates CARRY regardless of owner', () => {
  assert.deepEqual(onLine(withPieces({ P01: 'B', P02: 'A', P03: 'B', P05: 'A' }), 'A', 'H1'), []);
  assert.deepEqual(onLine(withPieces({ P01: 'B', P02: 'A', P03: 'B', P05: 'B' }), 'A', 'H1'), []);
});

test('V3 CLAMP checks every other node through distant P23', () => {
  const clear = withPieces({ P29: 'A', P27: 'B', P03: 'A' });
  const tailed = withPieces({ P29: 'A', P27: 'B', P03: 'A', P23: 'B' });
  assert.deepEqual(onLine(clear, 'A', 'V3')[0]?.segment_nodes, ['P29', 'P27', 'P03']);
  assert.equal(checkLineExclusive(tailed, 'V3', ['P29', 'P27', 'P03']), false);
  assert.deepEqual(onLine(tailed, 'A', 'V3'), []);
});

test('every declared line with three or more nodes is scanned', () => {
  for (const line of STANDARD_TOPOLOGY.lines) {
    if (line.nodes.length < 3) continue;
    const [left, middle, right] = line.nodes;
    const state = withPieces({ [left]: 'A', [middle]: 'B', [right]: 'A' });
    assert.ok(onLine(state, 'A', line.id).some(pattern =>
      pattern.capture_type === 'CLAMP'
      && pattern.segment_nodes.join(',') === [left, middle, right].join(',')
    ), line.id);
  }
});

test('middle and final consecutive windows are scanned too', () => {
  const finalH1 = withPieces({ P03: 'A', P04: 'B', P05: 'A' });
  const middleV3 = withPieces({ P08: 'A', P13: 'B', P18: 'A' });
  assert.deepEqual(onLine(finalH1, 'A', 'H1')[0]?.segment_nodes, ['P03', 'P04', 'P05']);
  assert.deepEqual(onLine(middleV3, 'A', 'V3')[0]?.segment_nodes, ['P08', 'P13', 'P18']);
});

test('a move into the window creates a new CLAMP', () => {
  const before = withPieces({ P01: 'A', P02: 'B', P04: 'A' });
  const after = applyBasicMove(before, { from: 'P04', to: 'P03' });
  assert.deepEqual(detectNewCapturePatterns(before, after, 'A').filter(p => p.line_id === 'H1'), [{
    capture_type: 'CLAMP', line_id: 'H1', segment_nodes: ['P01', 'P02', 'P03'],
    attacker_nodes: ['P01', 'P03'], captured_nodes: ['P02'], created_by_move: true,
  }]);
});

test('a preexisting CLAMP is not triggered again by an unrelated move', () => {
  const before = withPieces({ P01: 'A', P02: 'B', P03: 'A', P25: 'A' });
  const after = applyBasicMove(before, { from: 'P25', to: 'P24' });
  assert.equal(onLine(before, 'A', 'H1').length, 1);
  assert.equal(onLine(after, 'A', 'H1').length, 1);
  assert.deepEqual(detectNewCapturePatterns(before, after, 'A').filter(p => p.line_id === 'H1'), []);
});

test('moving a tail away creates a pattern without moving a segment piece', () => {
  const before = withPieces({ P01: 'A', P02: 'B', P03: 'A', P05: 'A' });
  const move = { from: 'P05', to: 'P10' } as const;
  const after = applyBasicMove(before, move);
  const newPattern = detectNewCapturePatterns(before, after, 'A').find(p => p.line_id === 'H1');
  assert.equal(onLine(before, 'A', 'H1').length, 0);
  assert.equal(newPattern?.capture_type, 'CLAMP');
  assert.equal(newPattern?.created_by_move, true);
  assert.deepEqual(newPattern?.segment_nodes, ['P01', 'P02', 'P03']);
  assert.equal(newPattern?.segment_nodes.includes(move.from), false);
  assert.equal(newPattern?.segment_nodes.includes(move.to), false);
});

test('one move can create CLAMP on H3 and V3 in stable line order', () => {
  const before = withPieces({ P11: 'A', P12: 'B', P03: 'A', P08: 'B', P19: 'A' });
  const after = applyBasicMove(before, { from: 'P19', to: 'P13' });
  const patterns = detectNewCapturePatterns(before, after, 'A');
  assert.deepEqual(patterns.map(p => [p.capture_type, p.line_id, p.segment_nodes]), [
    ['CLAMP', 'H3', ['P11', 'P12', 'P13']],
    ['CLAMP', 'V3', ['P03', 'P08', 'P13']],
  ]);
  assert.ok(patterns.every(p => p.created_by_move));
});

test('two different lines capturing the same node remain separate patterns', () => {
  const state = withPieces({ P11: 'A', P12: 'B', P13: 'A', P07: 'A', P17: 'A' });
  const patterns = detectValidCapturePatterns(state, 'A').filter(p =>
    p.line_id === 'H3' || p.line_id === 'V2'
  );
  assert.deepEqual(patterns.map(p => [p.line_id, p.captured_nodes]), [
    ['H3', ['P12']], ['V2', ['P12']],
  ]);
});

test('detection never changes either board, reserve or current player', () => {
  const before = withPieces({ P01: 'A', P02: 'B', P04: 'A' });
  const after = applyBasicMove(before, { from: 'P04', to: 'P03' });
  const beforeSnapshot = structuredClone(before);
  const afterSnapshot = structuredClone(after);
  detectValidCapturePatterns(before, 'A');
  detectValidCapturePatterns(after, 'B');
  detectNewCapturePatterns(before, after, 'A');
  assert.deepEqual(before, beforeSnapshot);
  assert.deepEqual(after, afterSnapshot);
  assert.equal(after.players.A.reserve_count, 4);
  assert.equal(after.players.B.reserve_count, 4);
  assert.equal(after.current_player, 'A');
});
