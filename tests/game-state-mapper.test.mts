import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { createInitialGameState } from '../miniprogram/domain/index.ts';

registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (specifier.startsWith('.') && context.parentURL &&
        (error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return nextResolve(url.href, context);
    }
    throw error;
  }
} });

const { mapGameStateToView } = await import('../miniprogram/pages/game/game-state-mapper.ts');

test('maps canonical initial state to existing ChessBoard geometry and status without mutation', () => {
  const state = createInitialGameState();
  const before = structuredClone(state);
  const view = mapGameStateToView(state, { selectedNode: 'P01', legalTargets: ['P02'], lastMove: null });
  assert.equal(view.board.pieces.length, 10);
  assert.deepEqual(view.board.pieces.filter(piece => piece.side === 'black').map(piece => piece.nodeId),
    ['P01', 'P06', 'P11', 'P16', 'P21']);
  assert.equal(view.board.selectedId, 'P01');
  assert.equal(view.board.nodes.find(node => node.id === 'P02')?.legalTarget, true);
  assert.equal(view.currentPlayer, 'A');
  assert.deepEqual(view.reserve, { A: 4, B: 4 });
  assert.equal(view.gameOver, false);
  assert.deepEqual(state, before);
});

test('maps captured replacement pieces and server reserve/current player directly', () => {
  const initial = createInitialGameState();
  const occupancy = { ...initial.board.occupancy, P01: null, P02: 'A' as const, P05: null };
  const state = { ...initial, board: { occupancy }, current_player: 'B' as const,
    players: { A: { reserve_count: 2 }, B: { reserve_count: 4 } } };
  const view = mapGameStateToView(state, { selectedNode: null, legalTargets: [],
    lastMove: { from: 'P01', to: 'P02' } });
  assert.equal(view.board.pieces.find(piece => piece.nodeId === 'P02')?.state, 'lastMove');
  assert.equal(view.board.recommendedFrom, 'P01');
  assert.equal(view.board.recommendedTo, 'P02');
  assert.equal(view.board.pieces.some(piece => piece.nodeId === 'P05'), false);
  assert.equal(view.currentPlayer, 'B');
  assert.equal(view.reserve.A, 2);
});

test('marks captured and replacement nodes from server capture result', () => {
  const initial = createInitialGameState();
  const capture = { patterns: [], captured_nodes: ['P05'], replacement_nodes: ['P05'],
    required_reserve: 1, reserve_used: 1, was_applied: true, failure_reason: 'NONE' } as const;
  const view = mapGameStateToView(initial, { selectedNode: null, legalTargets: [],
    lastMove: null, lastCapture: capture });
  assert.equal(view.board.nodes.find(node => node.id === 'P05')?.captured, true);
  assert.equal(view.board.nodes.find(node => node.id === 'P05')?.replacement, true);
  assert.equal(view.board.nodes.find(node => node.id === 'P06')?.captured, false);
});

for (const [reason, message] of [
  ['CAPTURE_ALL', '对方棋子已全部被吃'],
  ['TEMPLE_TRAP', '对方孤棋被困于庙宇'],
  ['LONE_PIECE_IMMOBILIZED', '对方孤棋无路可走'],
  ['RESIGN', '对方已认输'],
] as const) {
  test(`maps ${reason} winner text without inferring board rules`, () => {
    const initial = createInitialGameState();
    const state = { ...initial, game_status: 'FINISHED' as const,
      winner: 'A' as const, winner_reason: reason };
    const view = mapGameStateToView(state);
    assert.equal(view.gameOver, true);
    assert.equal(view.winner, 'A');
    assert.equal(view.winnerMessage, message);
  });
}
