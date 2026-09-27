import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NODE_IDS,
  TEMPLE_NODES,
  createInitialGameState,
  countPieces,
  getLegalMoves,
  checkCaptureAll,
  isTempleTrapped,
  checkTempleTrap,
  checkLonePieceImmobilized,
  executeTurn,
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

const trappedAtP27 = {
  P27: 'B', P26: 'A', P28: 'A', P29: 'A', P03: 'A',
} as const;

test('initial GameState has one consistent unfinished status', () => {
  const state = createInitialGameState();
  assert.equal(state.game_status, 'PLAYING');
  assert.equal(state.winner, null);
  assert.equal(state.winner_reason, null);
});

test('only P26-P29 are temple nodes and P03 is outside', () => {
  assert.deepEqual(TEMPLE_NODES, ['P26', 'P27', 'P28', 'P29']);
  assert.equal(TEMPLE_NODES.includes('P03'), false);
});

test('CAPTURE_ALL uses board occupancy and ignores opponent reserve', () => {
  const state = withPieces({ P01: 'A' }, { reserveB: 9 });
  assert.equal(countPieces(state.board, 'B'), 0);
  assert.deepEqual(checkCaptureAll(state, 'A'), { winner: 'A', reason: 'CAPTURE_ALL' });
  assert.equal(checkCaptureAll(withPieces({ P01: 'A', P29: 'B' }), 'A'), null);
});

test('successful capture of all enemy pieces finishes before switching player', () => {
  const before = withPieces({ P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A' });
  const { state, capture } = executeTurn(before, { from: 'P19', to: 'P13' });
  assert.equal(capture.was_applied, true);
  assert.equal(capture.reserve_used, 3);
  assert.equal(countPieces(state.board, 'B'), 0);
  assert.equal(state.game_status, 'FINISHED');
  assert.equal(state.winner, 'A');
  assert.equal(state.winner_reason, 'CAPTURE_ALL');
  assert.equal(state.current_player, 'A');
});

test('capture that leaves an enemy on board does not declare CAPTURE_ALL', () => {
  const before = withPieces({ P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A', P05: 'B' });
  const { state, capture } = executeTurn(before, { from: 'P19', to: 'P13' });
  assert.equal(capture.was_applied, true);
  assert.equal(countPieces(state.board, 'B'), 1);
  assert.equal(state.game_status, 'PLAYING');
  assert.equal(state.winner, null);
  assert.equal(state.current_player, 'B');
});

test('insufficient reserve cannot create a false CAPTURE_ALL', () => {
  const before = withPieces({ P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A' }, { reserveA: 2 });
  const { state, capture } = executeTurn(before, { from: 'P19', to: 'P13' });
  assert.equal(capture.failure_reason, 'INSUFFICIENT_RESERVE');
  assert.equal(capture.was_applied, false);
  assert.equal(countPieces(state.board, 'B'), 3);
  assert.equal(state.board.occupancy.P13, 'A');
  assert.equal(state.board.occupancy.P19, null);
  assert.equal(state.game_status, 'PLAYING');
  assert.equal(state.winner, null);
  assert.equal(state.current_player, 'B');
});

test('one B piece trapped at P27 is detected with real legal moves', () => {
  const state = withPieces(trappedAtP27, { currentPlayer: 'B', reserveB: 8 });
  assert.equal(countPieces(state.board, 'B'), 1);
  assert.deepEqual(getLegalMoves(state), []);
  assert.equal(isTempleTrapped(state, 'B'), true);
  assert.deepEqual(checkTempleTrap(state), { winner: 'A', reason: 'TEMPLE_TRAP' });
  assert.deepEqual(checkLonePieceImmobilized(state), { winner: 'A', reason: 'TEMPLE_TRAP' });
});

test('a lone temple piece with an available move is not trapped', () => {
  const state = withPieces({ P27: 'B', P21: 'A' }, { currentPlayer: 'B' });
  assert.ok(getLegalMoves(state).some(move => move.from === 'P27' && move.to === 'P26'));
  assert.equal(isTempleTrapped(state, 'B'), false);
  assert.equal(checkTempleTrap(state), null);
  assert.equal(checkLonePieceImmobilized(state), null);
});

test('a mobile lone piece outside the temple keeps playing', () => {
  const state = withPieces({ P03: 'B', P21: 'A' }, { currentPlayer: 'B' });
  assert.ok(getLegalMoves(state).length > 0);
  assert.equal(checkLonePieceImmobilized(state), null);
});

test('P03 is outside the temple but its immobilized lone piece still loses', () => {
  const state = withPieces({
    P03: 'B', P02: 'A', P04: 'A', P27: 'A', P08: 'A',
    P09: 'A', P07: 'A', P26: 'A', P28: 'A',
  }, { currentPlayer: 'B' });
  assert.deepEqual(getLegalMoves(state), []);
  assert.equal(isTempleTrapped(state, 'B'), false);
  assert.equal(checkTempleTrap(state), null);
  assert.deepEqual(checkLonePieceImmobilized(state), {
    winner: 'A', reason: 'LONE_PIECE_IMMOBILIZED',
  });
  const mirrored = withPieces({
    P03: 'A', P02: 'B', P04: 'B', P27: 'B', P08: 'B',
    P09: 'B', P07: 'B', P26: 'B', P28: 'B',
  }, { currentPlayer: 'A' });
  assert.deepEqual(checkLonePieceImmobilized(mirrored), {
    winner: 'B', reason: 'LONE_PIECE_IMMOBILIZED',
  });
});

test('a blocked lone piece on an ordinary node loses for the non-temple reason', () => {
  const state = withPieces({
    P13: 'B', P12: 'A', P14: 'A', P08: 'A', P18: 'A',
    P07: 'A', P19: 'A', P09: 'A', P17: 'A',
  }, { currentPlayer: 'B' });
  assert.deepEqual(getLegalMoves(state), []);
  assert.equal(isTempleTrapped(state, 'B'), false);
  assert.equal(checkTempleTrap(state), null);
  assert.deepEqual(checkLonePieceImmobilized(state), {
    winner: 'A', reason: 'LONE_PIECE_IMMOBILIZED',
  });
});

test('a blocked P27 does not count as trap when B has another board piece', () => {
  const state = withPieces({ ...trappedAtP27, P10: 'B' }, { currentPlayer: 'B' });
  assert.equal(countPieces(state.board, 'B'), 2);
  assert.equal(isTempleTrapped(state, 'B'), false);
  assert.equal(checkTempleTrap(state), null);
  assert.equal(checkLonePieceImmobilized(state), null);
});

test('a blocked lone B cannot be declared lost during A turn', () => {
  for (const pieces of [trappedAtP27, {
    P03: 'B', P02: 'A', P04: 'A', P27: 'A', P08: 'A',
    P09: 'A', P07: 'A', P26: 'A', P28: 'A',
  }] as const) {
    const state = withPieces(pieces, { currentPlayer: 'A' });
    assert.equal(isTempleTrapped(state, 'B'), false);
    assert.equal(checkTempleTrap(state), null);
    assert.equal(checkLonePieceImmobilized(state), null);
  }
});

test('two immobilized pieces do not trigger the lone-piece rule', () => {
  const state = withPieces({
    P03: 'B', P13: 'B', P02: 'A', P04: 'A', P27: 'A', P08: 'A',
    P09: 'A', P07: 'A', P26: 'A', P28: 'A', P12: 'A', P14: 'A',
    P18: 'A', P19: 'A', P17: 'A',
  }, { currentPlayer: 'B' });
  assert.equal(countPieces(state.board, 'B'), 2);
  assert.deepEqual(getLegalMoves(state), []);
  assert.equal(checkLonePieceImmobilized(state), null);
});

test('executeTurn checks temple trap after switching to the trapped player', () => {
  const before = withPieces({ ...trappedAtP27, P21: 'A' }, { currentPlayer: 'A' });
  const { state, capture } = executeTurn(before, { from: 'P21', to: 'P22' });
  assert.equal(capture.was_applied, false);
  assert.equal(state.board.occupancy.P21, null);
  assert.equal(state.board.occupancy.P22, 'A');
  assert.equal(state.current_player, 'B');
  assert.equal(state.game_status, 'FINISHED');
  assert.equal(state.winner, 'A');
  assert.equal(state.winner_reason, 'TEMPLE_TRAP');
});

test('a normal non-winning turn switches player and remains playable', () => {
  const before = createInitialGameState();
  const { state } = executeTurn(before, { from: 'P01', to: 'P02' });
  assert.equal(state.current_player, 'B');
  assert.equal(state.game_status, 'PLAYING');
  assert.equal(state.winner, null);
  assert.equal(state.winner_reason, null);
});

test('finished game rejects another executeTurn without changing the result', () => {
  const before = withPieces({ P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A' });
  const finished = executeTurn(before, { from: 'P19', to: 'P13' }).state;
  const snapshot = structuredClone(finished);
  assert.throws(() => executeTurn(finished, { from: 'P11', to: 'P12' }), /finished/i);
  assert.deepEqual(finished, snapshot);
});

test('last-piece CLAMP and last-two CARRY filters remain active in full turns', () => {
  const clampBefore = withPieces({ P01: 'A', P02: 'B', P04: 'A' });
  const clampTurn = executeTurn(clampBefore, { from: 'P04', to: 'P03' });
  assert.equal(clampTurn.capture.failure_reason, 'LAST_PIECE_CANNOT_CLAMP');
  assert.equal(clampTurn.state.board.occupancy.P02, 'B');
  assert.equal(clampTurn.state.winner, null);

  const carryBefore = withPieces({ P01: 'B', P03: 'B', P07: 'A' });
  const carryTurn = executeTurn(carryBefore, { from: 'P07', to: 'P02' });
  assert.equal(carryTurn.capture.failure_reason, 'TWO_PIECES_CANNOT_CARRY');
  assert.equal(carryTurn.state.board.occupancy.P01, 'B');
  assert.equal(carryTurn.state.board.occupancy.P03, 'B');
  assert.equal(carryTurn.state.winner, null);
});
