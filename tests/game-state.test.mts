import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NODE_IDS,
  createInitialGameState,
  getPieceAt,
  getPlayerNodes,
  countPieces,
} from '../miniprogram/domain/index.ts';

const initialA = ['P01', 'P06', 'P11', 'P16', 'P21'];
const initialB = ['P05', 'P10', 'P15', 'P20', 'P25'];

test('initial board has exactly the five A and five B positions', () => {
  const { board } = createInitialGameState();
  assert.deepEqual(getPlayerNodes(board, 'A'), initialA);
  assert.deepEqual(getPlayerNodes(board, 'B'), initialB);
  for (const id of initialA) assert.equal(getPieceAt(board, id as typeof NODE_IDS[number]), 'A');
  for (const id of initialB) assert.equal(getPieceAt(board, id as typeof NODE_IDS[number]), 'B');
});

test('all other legal nodes, including P26-P29, are empty initially', () => {
  const { board } = createInitialGameState();
  const occupied = new Set([...initialA, ...initialB]);
  for (const id of NODE_IDS) {
    if (!occupied.has(id)) assert.equal(getPieceAt(board, id), null, id);
  }
  for (const id of ['P26', 'P27', 'P28', 'P29'] as const) {
    assert.equal(getPieceAt(board, id), null, id);
  }
});

test('BoardState occupancy contains exactly P01-P29 and no other keys', () => {
  const { board } = createInitialGameState();
  assert.deepEqual(Object.keys(board.occupancy), [...NODE_IDS]);
  assert.deepEqual(Object.keys(board), ['occupancy']);
});

test('piece counts are derived from BoardState rather than stored separately', () => {
  const { board, players } = createInitialGameState();
  assert.equal(countPieces(board, 'A'), 5);
  assert.equal(countPieces(board, 'B'), 5);
  assert.equal('board_piece_count' in board, false);
  assert.equal('board_piece_count' in players.A, false);
  const changedBoard = { occupancy: { ...board.occupancy, P01: null } };
  assert.equal(countPieces(changedBoard, 'A'), 4);
  assert.equal(countPieces(board, 'A'), 5);
});

test('each player has one authoritative reserve_count initialized to four', () => {
  const { players } = createInitialGameState();
  assert.deepEqual(players, { A: { reserve_count: 4 }, B: { reserve_count: 4 } });
});

test('firstPlayer configures both first_player and current_player', () => {
  const a = createInitialGameState({ firstPlayer: 'A' });
  const b = createInitialGameState({ firstPlayer: 'B' });
  assert.equal(a.first_player, 'A');
  assert.equal(a.current_player, 'A');
  assert.equal(b.first_player, 'B');
  assert.equal(b.current_player, 'B');
  assert.equal(createInitialGameState().current_player, 'A');
});
