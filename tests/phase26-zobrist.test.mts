import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { NODE_IDS, RuleEngine, createInitialGameState } from '../miniprogram/domain/index.ts';

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

const { hashGameState, updateZobristHash } = await import('../miniprogram/ai/zobrist.ts');
const { buildPositionSuite } = await import('../scripts/benchmark/positions.mts');
const { createSeededRng } = await import('../scripts/benchmark/seeded-rng.mts');
const { RandomAI } = await import('../miniprogram/ai/random-ai.ts');

function withPieces(pieces: Record<string, 'A' | 'B'>,
                    options: { reserveA?: number; reserveB?: number } = {}) {
  const initial = createInitialGameState();
  const occupancy = { ...initial.board.occupancy };
  for (const node of NODE_IDS) occupancy[node] = null;
  for (const [node, player] of Object.entries(pieces)) {
    occupancy[node as typeof NODE_IDS[number]] = player;
  }
  return { ...initial, board: { occupancy }, players: {
    A: { reserve_count: options.reserveA ?? 4 },
    B: { reserve_count: options.reserveB ?? 4 },
  } };
}

function assertTurnHash(state: ReturnType<typeof createInitialGameState>,
                        move: { from: typeof NODE_IDS[number]; to: typeof NODE_IDS[number] }) {
  const before = structuredClone(state);
  const turn = RuleEngine.executeTurn(state, move);
  assert.equal(updateZobristHash(hashGameState(state), turn), hashGameState(turn.state));
  assert.deepEqual(state, before);
  return turn;
}

test('incremental hash matches full hash for normal, long, capture and terminal turns', () => {
  assertTurnHash(createInitialGameState(), { from: 'P01', to: 'P02' });
  assertTurnHash(createInitialGameState(), { from: 'P01', to: 'P19' });
  const cases = [
    { label: 'CLAMP', state: withPieces({ P01: 'A', P02: 'B', P04: 'A', P29: 'B' }),
      move: { from: 'P04', to: 'P03' } },
    { label: 'CARRY', state: withPieces({ P01: 'B', P03: 'B', P29: 'B', P07: 'A' }),
      move: { from: 'P07', to: 'P02' } },
    { label: 'multi-capture', state: withPieces({ P11: 'A', P12: 'B', P08: 'B',
      P18: 'B', P19: 'A', P05: 'B' }), move: { from: 'P19', to: 'P13' } },
    { label: 'reserve-rejected', state: withPieces({ P01: 'B', P03: 'B',
      P29: 'B', P07: 'A' }, { reserveA: 1 }), move: { from: 'P07', to: 'P02' } },
    { label: 'CAPTURE_ALL', state: withPieces({ P11: 'A', P12: 'B', P08: 'B',
      P18: 'B', P19: 'A' }), move: { from: 'P19', to: 'P13' } },
    { label: 'TEMPLE_TRAP', state: withPieces({ P27: 'B', P26: 'A', P28: 'A',
      P29: 'A', P03: 'A', P21: 'A' }), move: { from: 'P21', to: 'P22' } },
    { label: 'LONE_PIECE_IMMOBILIZED', state: withPieces({ P03: 'B', P02: 'A',
      P04: 'A', P27: 'A', P08: 'A', P09: 'A', P07: 'A', P26: 'A', P28: 'A',
      P21: 'A' }), move: { from: 'P21', to: 'P22' } },
  ] as const;
  for (const item of cases) {
    assert.equal(RuleEngine.validateMove(item.state, item.move), true, item.label);
    assertTurnHash(item.state, item.move);
  }
});

test('incremental hash equals full recomputation for every legal move in the original suite', () => {
  for (const position of buildPositionSuite()) {
    for (const move of RuleEngine.getAllLegalMoves(position.state)) {
      assertTurnHash(position.state, move);
    }
  }
});

test('incremental hash remains exact across seeded multi-turn canonical games', () => {
  for (const seed of [4, 17, 25]) {
    let state = createInitialGameState();
    let hash = hashGameState(state);
    const random = new RandomAI(createSeededRng(seed));
    for (let ply = 0; ply < 60 && state.game_status === 'PLAYING'; ply++) {
      const move = random.chooseMove(state);
      assert.ok(move);
      const turn = RuleEngine.executeTurn(state, move);
      hash = updateZobristHash(hash, turn);
      assert.equal(hash, hashGameState(turn.state), `seed=${seed}, ply=${ply}`);
      state = turn.state;
    }
  }
});
