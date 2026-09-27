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

const { RandomAI } = await import('../miniprogram/ai/random-ai.ts');

test('RandomAI returns a move from the real RuleEngine legal moves for player A', () => {
  const state = createInitialGameState();
  const legalMoves = RuleEngine.getAllLegalMoves(state);
  assert.ok(legalMoves.length > 0);

  const move = new RandomAI(() => 0).chooseMove(state);
  assert.deepEqual(move, legalMoves[0]);
  assert.equal(RuleEngine.validateMove(state, move!), true);
});

test('RandomAI can choose a legal move for player B', () => {
  const state = createInitialGameState({ firstPlayer: 'B' });
  const legalMoves = RuleEngine.getAllLegalMoves(state);
  assert.ok(legalMoves.length > 0);

  const move = new RandomAI(() => 0.999999).chooseMove(state);
  assert.deepEqual(move, legalMoves[legalMoves.length - 1]);
  assert.equal(RuleEngine.validateMove(state, move!), true);
});

test('repeated choices remain among real legal moves', () => {
  const state = createInitialGameState();
  const legalMoves = RuleEngine.getAllLegalMoves(state);
  let index = 0;
  const samples = [0, 0.125, 0.5, 0.75, 0.999999];
  const ai = new RandomAI(() => samples[index++ % samples.length]);

  for (let attempt = 0; attempt < 100; attempt++) {
    const move = ai.chooseMove(state);
    assert.ok(legalMoves.some(legal => legal.from === move?.from && legal.to === move?.to));
    assert.equal(RuleEngine.validateMove(state, move!), true);
  }
});

test('choosing does not mutate GameState, BoardState, or either reserve', () => {
  const state = createInitialGameState();
  const snapshot = structuredClone(state);
  const board = state.board;
  const occupancy = state.board.occupancy;
  const players = state.players;

  new RandomAI(() => 0.5).chooseMove(state);

  assert.deepEqual(state, snapshot);
  assert.equal(state.board, board);
  assert.equal(state.board.occupancy, occupancy);
  assert.equal(state.players, players);
  assert.deepEqual(state.board, snapshot.board);
  assert.deepEqual(state.players, snapshot.players);
});

test('choosing does not execute a turn; the GameEngine executes the returned move', () => {
  const state = createInitialGameState();
  const move = new RandomAI(() => 0).chooseMove(state);
  assert.ok(move);
  assert.equal(state.current_player, 'A');

  const turn = RuleEngine.executeTurn(state, move);
  assert.equal(turn.state.current_player, 'B');
  assert.equal(state.current_player, 'A');
});

test('finished games produce no move and do not consume randomness', () => {
  const initial = createInitialGameState();
  const occupancy = { ...initial.board.occupancy };
  for (const node of NODE_IDS) occupancy[node] = null;
  occupancy.P11 = 'A';
  occupancy.P12 = 'B';
  occupancy.P08 = 'B';
  occupancy.P18 = 'B';
  occupancy.P19 = 'A';
  const before = { ...initial, board: { occupancy } };
  const finished = RuleEngine.executeTurn(before, { from: 'P19', to: 'P13' });
  assert.equal(finished.state.game_status, 'FINISHED');
  assert.deepEqual(RuleEngine.getAllLegalMoves(finished.state), []);

  const ai = new RandomAI(() => { throw new Error('random source must not be called'); });
  assert.equal(ai.chooseMove(finished.state), null);
});

test('a playing state with no legal moves returns null', () => {
  const initial = createInitialGameState();
  const occupancy = { ...initial.board.occupancy };
  for (const node of NODE_IDS) occupancy[node] = null;
  occupancy.P01 = 'A';
  occupancy.P02 = 'B';
  occupancy.P06 = 'B';
  occupancy.P07 = 'B';
  const state = { ...initial, board: { occupancy } };
  assert.equal(state.game_status, 'PLAYING');
  assert.deepEqual(RuleEngine.getAllLegalMoves(state), []);

  const ai = new RandomAI(() => { throw new Error('random source must not be called'); });
  assert.equal(ai.chooseMove(state), null);
});

test('invalid random values cannot produce a nonlegal move', () => {
  const state = createInitialGameState();
  for (const value of [-0.01, 1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => new RandomAI(() => value).chooseMove(state), RangeError);
  }
});
