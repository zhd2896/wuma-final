import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); } catch (error) {
    if (specifier.startsWith('.') && context.parentURL) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return next(url.href, context);
    }
    throw error;
  }
} });
const { createInitialGameState, NODE_IDS, RuleEngine } = await import('../miniprogram/domain/index.ts');
const { IterativeDeepeningAI } = await import('../miniprogram/ai/iterative-deepening.ts');
const { proveBlockadeMove } = await import('../miniprogram/ai/blockade.ts');
const { analyzePosition } = await import('../miniprogram/ai/position-analysis.ts');

export function screenshotBlockade(attacker: 'A' | 'B' = 'B') {
  const defender = attacker === 'A' ? 'B' : 'A';
  const state = createInitialGameState();
  for (const node of NODE_IDS) state.board.occupancy[node] = null;
  for (const node of ['P01','P03','P05','P07','P14','P20','P21','P23','P27'] as const) state.board.occupancy[node] = attacker;
  state.board.occupancy.P29 = defender;
  state.current_player = attacker;
  state.players[attacker].reserve_count = 0;
  state.players[defender].reserve_count = 4;
  return state;
}

for (const [level, maxDepth, timeLimitMs] of [['BEGINNER',2,500],['STANDARD',4,1000],['ADVANCED',6,2000]] as const) {
  test(`${level} coordinates other pieces to finish the screenshot blockade within five plies`, () => {
    const state = screenshotBlockade(); const saved = structuredClone(state);
    const search = new IterativeDeepeningAI({ maxDepth, timeLimitMs }).search(state);
    assert.ok(search.bestMove);
    const proof = proveBlockadeMove(state, search.bestMove);
    assert.ok(proof, `selected ${JSON.stringify(search.bestMove)} has no verified blockade`);
    assert.equal(proof.maxPlies, 5);
    for (const line of proof.lines) {
      let replay = state;
      for (const move of line) replay = RuleEngine.executeTurn(replay, move).state;
      assert.equal(replay.game_status, 'FINISHED');
      assert.equal(replay.winner, 'B');
      assert.equal(replay.winner_reason, 'TEMPLE_TRAP');
      assert.ok(line.length <= 5);
      assert.ok(new Set(line.filter((_, index) => index % 2 === 0).map(move => move.from)).size > 1);
    }
    assert.deepEqual(state, saved);
  });
}

test('five-ply proof includes every black reply and has symmetric real terminals', () => {
  for (const attacker of ['A','B'] as const) {
    const state = screenshotBlockade(attacker);
    const move = { from: 'P03' as const, to: 'P26' as const };
    const proof = proveBlockadeMove(state, move);
    assert.ok(proof); assert.equal(proof.maxPlies, 5);
    const child = RuleEngine.executeTurn(state, move).state;
    const replies = RuleEngine.getAllLegalMoves(child);
    for (const reply of replies) assert.ok(proof.lines.some(line => JSON.stringify(line[1]) === JSON.stringify(reply)));
    for (const line of proof.lines) {
      const end = line.reduce((s, m) => RuleEngine.executeTurn(s,m).state, state);
      assert.equal(end.winner, attacker); assert.equal(end.game_status,'FINISHED');
    }
  }
});

test('analysis accurately labels a five-ply plan, without declaring this move terminal', () => {
  const state = screenshotBlockade();
  const result = analyzePosition(state, { maxDepth: 1, timeLimitMs: 1000, now: () => 0 });
  const proof = result.threats.find(t => t.type === 'FORCED_BLOCKADE_AVAILABLE');
  assert.ok(proof); assert.equal(proof.evidence.maxPlies, 5);
  assert.equal(result.terminal, false); assert.equal(result.winner, null);
});

test('repeated real AI choices close every escape branch instead of shuffling', () => {
  for (const attacker of ['A','B'] as const) {
    const initial = screenshotBlockade(attacker);
    function finish(state: typeof initial, remaining: number): void {
      if (state.game_status === 'FINISHED') { assert.equal(state.winner, attacker); return; }
      assert.ok(remaining > 0, 'AI did not finish within five real moves');
      if (state.current_player === attacker) {
        const result = new IterativeDeepeningAI({ maxDepth: 1, timeLimitMs: 1000, now: () => 0 }).search(state);
        assert.ok(result.bestMove);
        finish(RuleEngine.executeTurn(state, result.bestMove).state, remaining - 1);
      } else {
        const replies = RuleEngine.getAllLegalMoves(state);
        assert.ok(replies.length);
        for (const reply of replies) finish(RuleEngine.executeTurn(state, reply).state, remaining - 1);
      }
    }
    finish(initial, 5);
  }
});

test('an extra open center gives an escape and cannot be certified as a five-ply win', () => {
  const state = screenshotBlockade();
  state.board.occupancy.P27 = null;
  assert.equal(proveBlockadeMove(state, { from: 'P03', to: 'P26' }), null);
});

test('a defender leaving the temple can still be proved immediately immobile on the main board', () => {
  const state = screenshotBlockade();
  for (const node of NODE_IDS) state.board.occupancy[node] = null;
  for (const node of ['P02','P05','P07','P08','P09','P27','P28','P29'] as const) state.board.occupancy[node] = 'B';
  state.board.occupancy.P26 = 'A'; state.players.A.reserve_count = 0;
  const move = { from: 'P05' as const, to: 'P04' as const };
  const old = proveBlockadeMove(state, move, { maxAttackerTurns: 1 });
  const current = proveBlockadeMove(state, move);
  assert.ok(old); assert.ok(current); assert.equal(current.maxPlies, 3);
  assert.deepEqual(current.lines, old.lines);
  for (const line of current.lines) {
    const end = line.reduce((s, m) => RuleEngine.executeTurn(s,m).state, state);
    assert.equal(end.winner, 'B'); assert.equal(end.winner_reason, 'LONE_PIECE_IMMOBILIZED');
  }
});

test('when black moves first to either wing, subsequent AI choices still close all escape branches', () => {
  const initial = screenshotBlockade(); initial.current_player = 'A';
  const seen = new Set<string>();
  function finish(state: typeof initial, remaining: number): void {
    if (state.game_status === 'FINISHED') { assert.equal(state.winner, 'B'); return; }
    const key = JSON.stringify(state);
    assert.ok(!seen.has(key), 'AI repeats a complete position instead of coordinating');
    assert.ok(remaining > 0, 'AI did not close the blockade after the black move');
    seen.add(key);
    if (state.current_player === 'B') {
      const result = new IterativeDeepeningAI({ maxDepth: 2, timeLimitMs: 1000, now: () => 0 }).search(state);
      assert.ok(result.bestMove);
      finish(RuleEngine.executeTurn(state, result.bestMove).state, remaining - 1);
    } else {
      for (const reply of RuleEngine.getAllLegalMoves(state)) finish(RuleEngine.executeTurn(state, reply).state, remaining - 1);
    }
    seen.delete(key);
  }
  finish(initial, 10);
});

for (const wing of ['P26','P28'] as const) {
  for (const [level, maxDepth, timeLimitMs] of [['BEGINNER',2,500],['STANDARD',4,1000],['ADVANCED',6,2000]] as const) {
    test(`${level} stages a forced seven-ply finish after black enters ${wing}`, () => {
      const initial = screenshotBlockade(); initial.current_player = 'A';
      const state = RuleEngine.executeTurn(initial, { from: 'P29', to: wing }).state;
      const search = new IterativeDeepeningAI({ maxDepth, timeLimitMs }).search(state);
      assert.ok(search.bestMove);
      const proof = proveBlockadeMove(state, search.bestMove);
      assert.ok(proof, `${level} chose ${JSON.stringify(search.bestMove)} without a forced closure`);
      assert.ok(proof.maxPlies <= 7);
      for (const line of proof.lines) {
        const end = line.reduce((s,m) => RuleEngine.executeTurn(s,m).state, state);
        assert.equal(end.game_status,'FINISHED'); assert.equal(end.winner,'B');
      }
    });
  }
}
