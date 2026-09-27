import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { RuleEngine } from '../miniprogram/domain/index.ts';

registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); } catch (error) {
    if (specifier.startsWith('.') && context.parentURL &&
        (error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return nextResolve(url.href, context);
    }
    throw error;
  }
} });

const { buildPositionSuite } = await import('../scripts/benchmark/positions.mts');
const { orderMoves } = await import('../miniprogram/ai/move-ordering.ts');
const { evaluatePosition } = await import('../miniprogram/ai/evaluation.ts');

test('batched turns match canonical individual turns for every suite legal move', () => {
  for (const { id, state } of buildPositionSuite()) {
    const snapshot = structuredClone(state);
    const moves = RuleEngine.getAllLegalMoves(state);
    const expected = moves.map(move => RuleEngine.executeTurn(state, move));
    const actual = RuleEngine.executeTurns(state, moves);
    assert.deepEqual(actual, expected, id);
    assert.deepEqual(state, snapshot, `${id} parent state changed`);
    for (const turn of actual) {
      assert.notStrictEqual(turn.state.board.occupancy, state.board.occupancy);
    }
  }
});

test('ordering and evaluation use one batched turn pass per analyzed position', () => {
  const state = buildPositionSuite()[0].state;
  const original = RuleEngine.executeTurns;
  let calls = 0;
  RuleEngine.executeTurns = (...args) => {
    calls++;
    return original(...args);
  };
  try {
    orderMoves(state);
    evaluatePosition(state, state.current_player);
    assert.ok(calls >= 3);
  } finally {
    RuleEngine.executeTurns = original;
  }
});
