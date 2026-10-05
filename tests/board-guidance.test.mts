import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { NODE_IDS, createInitialGameState } from '../miniprogram/domain/index.ts';

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

const { describeNode, describeMove, highlightBoardMove, highlightBoardNodes } =
  await import('../miniprogram/utils/board-guidance.ts');
const { mapGameStateToView } = await import('../miniprogram/pages/game/game-state-mapper.ts');

test('point reference covers the canonical 29 points with consistent orientation and temple boundary', () => {
  const board = mapGameStateToView(createInitialGameState()).board;
  assert.deepEqual(new Set(board.nodes.map(node => node.id)), new Set(NODE_IDS));
  assert.equal(board.nodes.length, 29);
  assert.equal(describeNode('P01'), 'P01（第1行第1列）');
  assert.equal(describeNode('P25'), 'P25（第5行第5列）');
  assert.equal(describeNode('P03'), 'P03（庙宇入口）');
  assert.equal(describeNode('P13'), 'P13（中央）');
  assert.match(describeNode('P29'), /宝顶/);
  assert.match(describeMove({ from: 'P07', to: 'P13' }), /起点 P07.*终点 P13（中央）/);
});

test('guidance arrows end at the actual point without moving pieces or mutating the position', () => {
  const state = createInitialGameState();
  const original = structuredClone(state);
  const board = mapGameStateToView(state).board;
  const unchanged = structuredClone(board);
  for (const move of [{ from: 'P01', to: 'P03' }, { from: 'P05', to: 'P09' },
    { from: 'P03', to: 'P29' }] as const) {
    const marked = highlightBoardMove(board, move);
    assert.deepEqual(marked.pieces, board.pieces);
    const arrow = marked.recommendLine!;
    const to = board.nodes.find(node => node.id === move.to)!;
    const radians = arrow.angle * Math.PI / 180;
    assert.ok(Math.abs(arrow.x + Math.cos(radians) * arrow.width - to.x) < 1e-9);
    assert.ok(Math.abs(arrow.y + Math.sin(radians) * arrow.width - to.y) < 1e-9);
    const cleared = highlightBoardMove(marked, null);
    assert.equal(cleared.recommendedTo, undefined);
    assert.equal(cleared.recommendLine, undefined);
    assert.deepEqual(cleared, board);
  }
  const focused = highlightBoardNodes(board, ['P01', 'P13']);
  assert.deepEqual(focused.nodes.filter(node => node.focused).map(node => node.id), ['P01', 'P13']);
  assert.deepEqual(board, unchanged);
  assert.deepEqual(state, original);
});
