import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { NODE_IDS, RuleEngine, createInitialGameState } from '../miniprogram/domain/index.ts';
import type { GameState, Player } from '../miniprogram/domain/index.ts';

registerHooks({ resolve(s, c, next) {
  try { return next(s, c); } catch (error) {
    if (s.startsWith('.') && c.parentURL && (error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') {
      const url = new URL(`${s}.ts`, c.parentURL);
      if (existsSync(url)) return next(url.href, c);
    }
    throw error;
  }
} });

const { evaluatePosition, DEFAULT_EVALUATION_CONFIG } = await import('../miniprogram/ai/evaluation.ts');
const { MinimaxAI } = await import('../miniprogram/ai/minimax.ts');
const { AlphaBetaAI } = await import('../miniprogram/ai/alpha-beta.ts');
const { IterativeDeepeningAI } = await import('../miniprogram/ai/iterative-deepening.ts');
const { createDeviceHistoryStore } = await import('../miniprogram/services/device-history.ts');
const { validSavedState, requireReviewContext, requireReplay } = await import('../miniprogram/services/replay-contract.ts');
const { requireOnlineRoom } = await import('../miniprogram/services/online-api.ts');
const { analyzeReviewMove } = await import('../miniprogram/ai/review-analysis.ts');

function position(pieces: Record<string, Player>, reserveA = 1): GameState {
  const state = createInitialGameState();
  const occupancy = { ...state.board.occupancy };
  for (const node of NODE_IDS) occupancy[node] = pieces[node] ?? null;
  return { ...state, board: { occupancy }, players: { A: { reserve_count: reserveA }, B: { reserve_count: 4 } } };
}

const temple = { P26: 'B', P29: 'B', P27: 'A', P28: 'A', P08: 'A',
  P05: 'A', P10: 'A', P15: 'A', P20: 'A', P25: 'A' } as const;

test('closing the last exit of two temple pieces finishes only after switching turns', () => {
  const before = position(temple);
  const snapshot = structuredClone(before);
  assert.ok(RuleEngine.getAllLegalMovesForPlayer(before, 'B').length > 0);
  const turn = RuleEngine.executeTurn(before, { from: 'P08', to: 'P03' });
  assert.equal(turn.state.current_player, 'B');
  assert.equal(RuleEngine.getAllLegalMoves(turn.state).length, 0);
  assert.equal(turn.state.game_status, 'FINISHED');
  assert.equal(turn.winner, 'A');
  assert.equal(turn.winner_reason, 'ALL_PIECES_IMMOBILIZED');
  assert.equal(turn.game_over, true);
  assert.equal(turn.captures.was_applied, false);
  assert.deepEqual(before, snapshot);
  assert.throws(() => RuleEngine.executeTurn(turn.state, { from: 'P26', to: 'P03' }), /finished/i);
});

test('all immobilized pieces on the main board lose even with spare pieces', () => {
  const before = position({ P01: 'B', P06: 'B', P02: 'A', P07: 'A', P12: 'A',
    P05: 'A', P10: 'A', P15: 'A', P20: 'A', P25: 'A' });
  const turn = RuleEngine.executeTurn(before, { from: 'P12', to: 'P11' });
  assert.equal(turn.winner, 'A');
  assert.equal(turn.winner_reason, 'ALL_PIECES_IMMOBILIZED');
  assert.equal(turn.state.players.B.reserve_count, 4);
});

test('the rule is symmetric when black pieces are blocked', () => {
  const before = position(temple);
  const occupancy = { ...before.board.occupancy };
  for (const node of NODE_IDS) occupancy[node] = occupancy[node] === 'A' ? 'B' : occupancy[node] === 'B' ? 'A' : null;
  const turn = RuleEngine.executeTurn({ ...before, board: { occupancy }, current_player: 'B' }, { from: 'P08', to: 'P03' });
  assert.equal(turn.state.current_player, 'A');
  assert.equal(turn.winner, 'B');
  assert.equal(turn.winner_reason, 'ALL_PIECES_IMMOBILIZED');
});

test('three immobilized pieces also lose', () => {
  const before = position({ P26: 'B', P27: 'B', P29: 'B', P28: 'A', P08: 'A',
    P05: 'A', P10: 'A', P15: 'A', P20: 'A', P25: 'A' }, 2);
  const turn = RuleEngine.executeTurn(before, { from: 'P08', to: 'P03' });
  assert.equal(turn.winner_reason, 'ALL_PIECES_IMMOBILIZED');
  assert.equal(turn.winner, 'A');
});

test('blocked temple pieces do not lose while another piece can move', () => {
  const before = position({ ...temple, P10: 'B' }, 2);
  const turn = RuleEngine.executeTurn(before, { from: 'P08', to: 'P03' });
  assert.ok(RuleEngine.getAllLegalMoves(turn.state).some(m => m.from === 'P10'));
  assert.equal(turn.game_over, false);
  assert.equal(turn.winner, null);
});

test('capture resolution precedes adjudication of remaining blocked pieces', () => {
  const before = position({ P26: 'B', P29: 'B', P12: 'B', P27: 'A', P28: 'A', P03: 'A',
    P11: 'A', P08: 'A', P05: 'A', P25: 'A' }, 2);
  const turn = RuleEngine.executeTurn(before, { from: 'P08', to: 'P13' });
  assert.deepEqual(turn.captures.captured_nodes, ['P12']);
  assert.equal(turn.state.board.occupancy.P12, 'A');
  assert.equal(turn.reserve_after.A, 1);
  assert.equal(turn.state.current_player, 'B');
  assert.equal(turn.winner_reason, 'ALL_PIECES_IMMOBILIZED');
});

test('cancelled capture leaves a mobile opponent and cannot cause a false loss', () => {
  const before = position({ P26: 'B', P29: 'B', P12: 'B', P27: 'A', P28: 'A', P03: 'A',
    P11: 'A', P08: 'A', P05: 'A', P25: 'A' }, 0);
  const turn = RuleEngine.executeTurn(before, { from: 'P08', to: 'P13' });
  assert.equal(turn.captures.failure_reason, 'INSUFFICIENT_RESERVE');
  assert.equal(turn.state.board.occupancy.P12, 'B');
  assert.ok(RuleEngine.getAllLegalMoves(turn.state).some(m => m.from === 'P12'));
  assert.equal(turn.game_over, false);
});

test('searches treat a completed multi-piece blockade as a terminal loss, without ambiguity', () => {
  const state = RuleEngine.executeTurn(position(temple), { from: 'P08', to: 'P03' }).state;
  for (const ai of [new MinimaxAI({ depth: 2 }), new AlphaBetaAI({ depth: 2 }),
    new IterativeDeepeningAI({ maxDepth: 2, timeLimitMs: 0 })]) {
    const result = ai.search(state);
    assert.equal(result.bestMove, null);
    assert.equal(result.evaluationScore, -DEFAULT_EVALUATION_CONFIG.mateScore);
  }
  assert.equal(evaluatePosition(state, 'A').score, DEFAULT_EVALUATION_CONFIG.mateScore);
});

test('search can choose a move that finishes a multi-piece blockade', () => {
  const before = position(temple);
  const result = new AlphaBetaAI({ depth: 1 }).search(before);
  assert.ok(result.bestMove);
  const turn = RuleEngine.executeTurn(before, result.bestMove!);
  assert.equal(turn.winner, 'A');
  assert.equal(turn.winner_reason, 'ALL_PIECES_IMMOBILIZED');
});

test('new terminal reason survives local history storage and reopening', () => {
  const turn = RuleEngine.executeTurn(position(temple), { from: 'P08', to: 'P03' });
  const saved = new Map<string, unknown>();
  const storage = { get: (key: string) => saved.get(key),
    set: (key: string, value: unknown) => { saved.set(key, structuredClone(value)); },
    remove: (key: string) => { saved.delete(key); } };
  createDeviceHistoryStore(storage).record({ id: 'multi-blocked', mode: 'local', state: turn.state,
    turns: 1, lastMove: turn.move });
  const restored = createDeviceHistoryStore(storage).get('multi-blocked');
  assert.equal(restored?.status, 'FINISHED');
  assert.equal(restored?.winnerReason, 'ALL_PIECES_IMMOBILIZED');
  assert.deepEqual(restored?.localState, turn.state);
});

test('saved review snapshots and replay accept the terminal without recalculating old rules', () => {
  const turn = RuleEngine.executeTurn(position(temple), { from: 'P08', to: 'P03' });
  const game = { game_id: 'multi-blocked', version: 1, ply_count: 1, mode: 'LOCAL' as const,
    ai_player: null, human_player: null, ai_level: null, state: turn.state };
  const replay = { game_id: game.game_id, version: 1, ply_count: 1, initial_state: turn.before_state,
    steps: [{ kind: 'MOVE' as const, ply: 1, version: 1, game_move_id: 1, player: 'A' as const,
      move: turn.move, capture: turn.capture, state: turn.state }] };
  assert.equal(validSavedState(turn.state), true);
  assert.equal(requireReviewContext(game, game.game_id), game);
  assert.equal(requireReplay(replay, game.game_id), replay);
});

test('either remote seat accepts a room finished by a multi-piece blockade', () => {
  const turn = RuleEngine.executeTurn(position(temple), { from: 'P08', to: 'P03' });
  for (const seat of ['A', 'B'] as const) {
    const room = { game_id: 'multi-blocked', seat, room_status: 'FINISHED' as const,
      version: 1, ply_count: 1, pending_undo: null, state: turn.state, token: null,
      invite_code: '12345678', public: false, expires_at: '2099-01-01T00:00:00Z' };
    assert.equal(requireOnlineRoom(room, { game_id: room.game_id, seat }), room);
  }
});

const reviewConfig = { maxDepth: 1, timeLimitMs: 1000, candidateLimit: 3,
  goodMaxLoss: 0, normalMaxLoss: 30, mistakeMaxLoss: 100, now: () => 0 };

test('historical multi-piece blockade saved as PLAYING can be reviewed without rewriting its snapshot', () => {
  const turn = RuleEngine.executeTurn(position(temple), { from: 'P08', to: 'P03' });
  const legacy: GameState = { ...turn.state, game_status: 'PLAYING', winner: null, winner_reason: null };
  const before = structuredClone(legacy);
  const result = analyzeReviewMove(turn.before_state, legacy, turn.move, reviewConfig);
  assert.deepEqual(result.actualMove, turn.move);
  assert.equal(result.scoreLoss, 0);
  assert.equal(result.evaluationAfter.terminal, false);
  assert.match(result.engineExplanation, /现行规则/);
  assert.deepEqual(legacy, before);
});

test('legacy adjudication compatibility still rejects changed board, reserves, turn, or winner', () => {
  const turn = RuleEngine.executeTurn(position(temple), { from: 'P08', to: 'P03' });
  const legacy: GameState = { ...turn.state, game_status: 'PLAYING', winner: null, winner_reason: null };
  for (const changed of [
    { ...legacy, board: { occupancy: { ...legacy.board.occupancy, P26: null } } },
    { ...legacy, players: { ...legacy.players, A: { reserve_count: 99 } } },
    { ...legacy, current_player: 'A' as const },
    { ...legacy, winner: 'A' as const },
  ]) {
    assert.throws(() => analyzeReviewMove(turn.before_state, changed, turn.move, reviewConfig),
      (error: any) => error.code === 'REPLAY_INTEGRITY_ERROR');
  }
  const lone = position({ P27: 'B', P26: 'A', P28: 'A', P29: 'A', P03: 'A', P21: 'A' });
  const loneTurn = RuleEngine.executeTurn(lone, { from: 'P21', to: 'P22' });
  assert.throws(() => analyzeReviewMove(lone, { ...loneTurn.state, game_status: 'PLAYING',
    winner: null, winner_reason: null }, loneTurn.move, reviewConfig),
    (error: any) => error.code === 'REPLAY_INTEGRITY_ERROR');
});
