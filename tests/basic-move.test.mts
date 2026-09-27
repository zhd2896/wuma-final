import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NODE_IDS,
  STANDARD_GRAPH,
  createInitialGameState,
  findClearBoardLinePath,
  isLegalBasicMove,
  getLegalDestinations,
  getLegalMoves,
  applyBasicMove,
} from '../miniprogram/domain/index.ts';

function withPieces(pieces: Record<string, 'A' | 'B'>, currentPlayer: 'A' | 'B' = 'A') {
  const initial = createInitialGameState({ firstPlayer: currentPlayer });
  const occupancy = { ...initial.board.occupancy };
  for (const id of NODE_IDS) occupancy[id] = null;
  for (const [id, player] of Object.entries(pieces)) {
    occupancy[id as typeof NODE_IDS[number]] = player;
  }
  return { ...initial, board: { occupancy } };
}

test('a current-player piece can move to an adjacent empty node on a BoardLine', () => {
  assert.equal(isLegalBasicMove(createInitialGameState(), { from: 'P01', to: 'P02' }), true);
});

test('a piece may cross several empty line nodes in either direction', () => {
  assert.equal(isLegalBasicMove(withPieces({ P01: 'A' }), { from: 'P01', to: 'P04' }), true);
  assert.equal(isLegalBasicMove(withPieces({ P04: 'A' }), { from: 'P04', to: 'P01' }), true);
  assert.equal(STANDARD_GRAPH.areAdjacent('P01', 'P04'), false);
});

test('V3 permits P29 to P03 through empty P27', () => {
  const state = withPieces({ P29: 'A' });
  assert.deepEqual(findClearBoardLinePath(state.board, 'P29', 'P03'), {
    lineId: 'V3', nodes: ['P29', 'P27', 'P03'],
  });
  assert.equal(isLegalBasicMove(state, { from: 'P29', to: 'P03' }), true);
});

test('an empty or opponent-owned origin is illegal', () => {
  const state = withPieces({ P01: 'B' });
  assert.equal(isLegalBasicMove(state, { from: 'P02', to: 'P03' }), false);
  assert.equal(isLegalBasicMove(state, { from: 'P01', to: 'P02' }), false);
});

test('an occupied destination cannot be overwritten by a basic move', () => {
  assert.equal(isLegalBasicMove(withPieces({ P01: 'A', P02: 'A' }), { from: 'P01', to: 'P02' }), false);
  assert.equal(isLegalBasicMove(withPieces({ P01: 'A', P02: 'B' }), { from: 'P01', to: 'P02' }), false);
});

test('graph connectivity and turns do not make an off-line move legal', () => {
  const state = withPieces({ P01: 'A' });
  assert.equal(STANDARD_GRAPH.areAdjacent('P01', 'P02'), true);
  assert.equal(STANDARD_GRAPH.areAdjacent('P02', 'P03'), true);
  assert.equal(STANDARD_GRAPH.areAdjacent('P03', 'P08'), true);
  assert.equal(isLegalBasicMove(state, { from: 'P01', to: 'P08' }), false);
  assert.equal(isLegalBasicMove(state, { from: 'P01', to: 'P10' }), false);
});

test('both friendly and enemy pieces block longer moves on the same line', () => {
  assert.equal(isLegalBasicMove(withPieces({ P01: 'A', P03: 'A' }), { from: 'P01', to: 'P04' }), false);
  assert.equal(isLegalBasicMove(withPieces({ P01: 'A', P03: 'B' }), { from: 'P01', to: 'P04' }), false);
  assert.equal(isLegalBasicMove(withPieces({ P01: 'A', P03: 'B' }), { from: 'P01', to: 'P02' }), true);
});

test('blocking P27 rejects P29 to P03 despite the empty P26 temple turn', () => {
  const state = withPieces({ P29: 'A', P27: 'B', P28: 'B' });
  assert.equal(STANDARD_GRAPH.areAdjacent('P29', 'P26'), true);
  assert.equal(STANDARD_GRAPH.areAdjacent('P26', 'P03'), true);
  assert.equal(findClearBoardLinePath(state.board, 'P29', 'P03'), null);
  assert.equal(isLegalBasicMove(state, { from: 'P29', to: 'P03' }), false);
});

test('blocking P27 rejects P29 to P03 despite the empty P28 temple turn', () => {
  const state = withPieces({ P29: 'A', P27: 'A', P26: 'B' });
  assert.equal(STANDARD_GRAPH.areAdjacent('P29', 'P28'), true);
  assert.equal(STANDARD_GRAPH.areAdjacent('P28', 'P03'), true);
  assert.equal(isLegalBasicMove(state, { from: 'P29', to: 'P03' }), false);
});

test('when two declared lines share endpoints, a clear one suffices', () => {
  const state = withPieces({ P01: 'A', P02: 'B' });
  const topology = {
    nodes: ['P01', 'P02', 'P03', 'P04'].map(id => ({ id })),
    lines: [
      { id: 'blocked', nodes: ['P01', 'P02', 'P04'] },
      { id: 'clear', nodes: ['P01', 'P03', 'P04'] },
    ],
  } as const;
  assert.deepEqual(findClearBoardLinePath(state.board, 'P01', 'P04', topology), {
    lineId: 'clear', nodes: ['P01', 'P03', 'P04'],
  });
});

test('generated destinations include long moves but stop at blockers', () => {
  const state = withPieces({ P01: 'A', P03: 'B', P11: 'A' });
  assert.deepEqual(getLegalDestinations(state, 'P01'), ['P02', 'P06', 'P07', 'P13', 'P19', 'P25']);
  assert.deepEqual(getLegalDestinations(state, 'P03'), []);
  assert.deepEqual(getLegalDestinations(state, 'P02'), []);
  assert.equal(getLegalDestinations(state, 'P01').includes('P08'), false);
});

test('generated moves are legal for the current player and do not change the turn', () => {
  const state = withPieces({ P01: 'A', P03: 'B' });
  const moves = getLegalMoves(state);
  assert.ok(moves.length > 0);
  assert.ok(moves.every(move => move.from === 'P01' && isLegalBasicMove(state, move)));
  assert.equal(state.current_player, 'A');
});

test('applying a basic move copies board occupancy without changing reserves or turn', () => {
  const state = withPieces({ P01: 'A', P05: 'B' });
  const next = applyBasicMove(state, { from: 'P01', to: 'P03' });
  assert.equal(next.board.occupancy.P01, null);
  assert.equal(next.board.occupancy.P03, 'A');
  assert.equal(next.board.occupancy.P05, 'B');
  assert.equal(state.board.occupancy.P01, 'A');
  assert.equal(state.board.occupancy.P03, null);
  assert.notEqual(next.board, state.board);
  assert.deepEqual(next.players, state.players);
  assert.equal(next.first_player, state.first_player);
  assert.equal(next.current_player, state.current_player);
});

test('applying an illegal basic move rejects it without mutating the input', () => {
  const state = withPieces({ P01: 'A', P02: 'B' });
  assert.throws(() => applyBasicMove(state, { from: 'P01', to: 'P03' }), /illegal basic move/i);
  assert.equal(state.board.occupancy.P01, 'A');
  assert.equal(state.board.occupancy.P02, 'B');
  assert.equal(state.board.occupancy.P03, null);
});
