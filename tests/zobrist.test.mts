import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { NODE_IDS, createInitialGameState } from '../miniprogram/domain/index.ts';

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

const { hashGameState, stateSignature } = await import('../miniprogram/ai/zobrist.ts');

test('fixed-seed hash is repeatable across clones and JSON round trips', () => {
  const state = createInitialGameState();
  const snapshot = structuredClone(state);
  const hash = hashGameState(state);
  assert.match(hash, /^[0-9a-f]{16}$/);
  assert.equal(hashGameState(state), hash);
  assert.equal(hashGameState(structuredClone(state)), hash);
  assert.equal(hashGameState(JSON.parse(JSON.stringify(state))), hash);
  assert.equal(stateSignature(JSON.parse(JSON.stringify(state))), stateSignature(state));
  assert.deepEqual(state, snapshot);
});

test('all 29 node occupancies and both player identities affect the hash', () => {
  const initial = createInitialGameState();
  const empty = Object.fromEntries(NODE_IDS.map(node => [node, null]));
  const base = { ...initial, board: { occupancy: empty } };
  const baseHash = hashGameState(base);
  const keys = new Set<string>();
  for (const node of NODE_IDS) {
    for (const player of ['A', 'B'] as const) {
      const state = { ...base, board: { occupancy: { ...empty, [node]: player } } };
      const hash = hashGameState(state);
      assert.notEqual(hash, baseHash);
      assert.equal(keys.has(hash), false, `${node}=${player} should have its own key`);
      keys.add(hash);
    }
  }
  assert.equal(keys.size, 58);
});

test('turn, each reserve, game status, winner and reason independently affect identity', () => {
  const state = createInitialGameState();
  const hash = hashGameState(state);
  const variants = [
    { ...state, current_player: 'B' },
    { ...state, players: { ...state.players, A: { reserve_count: 3 } } },
    { ...state, players: { ...state.players, B: { reserve_count: 3 } } },
    { ...state, game_status: 'FINISHED' },
    { ...state, winner: 'A' },
    { ...state, winner_reason: 'CAPTURE_ALL' },
  ];
  for (const variant of variants) {
    assert.notEqual(hashGameState(variant), hash);
    assert.notEqual(stateSignature(variant), stateSignature(state));
  }
  assert.notEqual(hashGameState({ ...state, winner: 'A' }),
    hashGameState({ ...state, winner: 'B' }));
  assert.notEqual(hashGameState({ ...state, winner_reason: 'TEMPLE_TRAP' }),
    hashGameState({ ...state, winner_reason: 'LONE_PIECE_IMMOBILIZED' }));
});

test('first_player does not split positions with identical future rules and evaluation', () => {
  const state = createInitialGameState();
  const other = { ...state, first_player: 'B' as const };
  assert.equal(hashGameState(state), hashGameState(other));
  assert.equal(stateSignature(state), stateSignature(other));
});
