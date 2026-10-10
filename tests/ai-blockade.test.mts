import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { NODE_IDS, RuleEngine, createInitialGameState } from '../miniprogram/domain/index.ts';
import type { GameState, Move, Player } from '../miniprogram/domain/index.ts';

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
const { IterativeDeepeningAI } = await import('../miniprogram/ai/iterative-deepening.ts');
const { evaluatePosition } = await import('../miniprogram/ai/evaluation.ts');
const { analyzePosition } = await import('../miniprogram/ai/position-analysis.ts');
const { analyzeReviewMove } = await import('../miniprogram/ai/review-analysis.ts');
const { mapGameStateToView } = await import('../miniprogram/pages/game/game-state-mapper.ts');

// Actual cloud game 0a7a3667540d4d8998681fe4448854f9, after ply 35.
export function actualBlockade(attacker: Player = 'B'): GameState {
  const defender: Player = attacker === 'A' ? 'B' : 'A';
  const initial = createInitialGameState();
  const occupancy = { ...initial.board.occupancy };
  for (const node of NODE_IDS) occupancy[node] = null;
  for (const node of ['P01', 'P05', 'P06', 'P14', 'P17', 'P23', 'P25', 'P26', 'P27'] as const) occupancy[node] = attacker;
  occupancy.P28 = defender;
  return { ...initial, board: { occupancy }, current_player: attacker,
    players: { A: { reserve_count: attacker === 'A' ? 0 : 4 },
      B: { reserve_count: attacker === 'B' ? 0 : 4 } } };
}

function finishesAgainstEveryReply(state: GameState, move: Move): boolean {
  const child = RuleEngine.executeTurn(state, move).state;
  if (child.game_status === 'FINISHED') return child.winner === state.current_player;
  const replies = RuleEngine.getAllLegalMoves(child);
  return replies.length > 0 && replies.every(reply => {
    const next = RuleEngine.executeTurn(child, reply).state;
    return next.game_status === 'PLAYING' && RuleEngine.getAllLegalMoves(next).some(finish => {
      const end = RuleEngine.executeTurn(next, finish).state;
      return end.game_status === 'FINISHED' && end.winner === state.current_player;
    });
  });
}

test('shallow search preserves the blockade and finds the actual three-ply win', () => {
  const state = actualBlockade(); const saved = structuredClone(state);
  const result = new IterativeDeepeningAI({ maxDepth: 1, timeLimitMs: 1000, now: () => 0 }).search(state);
  assert.ok(result.bestMove && finishesAgainstEveryReply(state, result.bestMove));
  assert.ok(result.evaluationScore >= 999_997);
  assert.equal(result.searchDepth, 1, 'base depth remains honest about the selective extension');
  assert.deepEqual(state, saved);
});

for (const [level, maxDepth, timeLimitMs] of [['BEGINNER', 2, 500], ['STANDARD', 4, 1000], ['ADVANCED', 6, 2000]] as const) {
  test(`${level} completes a proven blockade using its actual budget`, () => {
    const state = actualBlockade();
    const result = new IterativeDeepeningAI({ maxDepth, timeLimitMs }).search(state);
    assert.ok(result.bestMove && finishesAgainstEveryReply(state, result.bestMove));
  });
}

test('coordinated blocker gets higher static score than moving away the existing seal', () => {
  const state = actualBlockade();
  const prepare = RuleEngine.executeTurn(state, { from: 'P05', to: 'P03' }).state;
  const shuffle = RuleEngine.executeTurn(state, { from: 'P26', to: 'P03' }).state;
  assert.ok(evaluatePosition(prepare, 'B').score > evaluatePosition(shuffle, 'B').score);
  assert.equal(evaluatePosition(prepare, 'A').score, -evaluatePosition(prepare, 'B').score);
});

test('real analysis labels a verified forced blockade and identifies the isolated piece', () => {
  const analysis = analyzePosition(actualBlockade(), { maxDepth: 1, timeLimitMs: 1000, now: () => 0 });
  const proof = analysis.threats.find(threat => (threat.type as string) === 'FORCED_BLOCKADE_AVAILABLE');
  assert.ok(proof);
  assert.deepEqual(proof.relatedMove, analysis.bestMove);
  assert.ok(proof.relatedNodes?.includes('P28'));
  assert.equal(proof.evidence.maxPlies, 3);
  assert.equal(proof.evidence.winnerReason, 'TEMPLE_TRAP');
});

test('review favors the faster blockade without calling a slower proved win a blunder', () => {
  const state = actualBlockade(); const move: Move = { from: 'P26', to: 'P03' };
  const after = RuleEngine.executeTurn(state, move).state;
  const review = analyzeReviewMove(state, after, move, { maxDepth: 1, timeLimitMs: 1000,
    candidateLimit: 3, goodMaxLoss: 0, normalMaxLoss: 30, mistakeMaxLoss: 100, now: () => 0 });
  assert.equal(review.category, 'NORMAL');
  assert.ok(finishesAgainstEveryReply(state, review.bestMove));
  assert.match(review.engineExplanation, /围堵/);
  assert.equal(review.scoreLoss, 4);
  assert.match(review.engineExplanation, /仍能/);
});

test('terminal guidance states that no legal move after switching is the reason', () => {
  let state = actualBlockade();
  for (const move of [{ from: 'P05', to: 'P03' }, { from: 'P28', to: 'P29' }, { from: 'P03', to: 'P28' }] as Move[]) state = RuleEngine.executeTurn(state, move).state;
  assert.equal(state.winner_reason, 'TEMPLE_TRAP');
  assert.match(mapGameStateToView(state).guidanceText, /换手后/);
  assert.match(mapGameStateToView(state).guidanceText, /无合法走法/);
});

test('both colors close the real line and reach a real terminal without repeating', () => {
  for (const attacker of ['A', 'B'] as const) {
    let state = actualBlockade(attacker); const seen = new Set<string>();
    const first = new IterativeDeepeningAI({ maxDepth: 1, timeLimitMs: 1000, now: () => 0 }).search(state);
    assert.ok(first.bestMove);
    state = RuleEngine.executeTurn(state, first.bestMove).state;
    const replies = RuleEngine.getAllLegalMoves(state);
    assert.ok(replies.length > 0);
    for (const reply of replies) {
      const response = RuleEngine.executeTurn(state, reply).state;
      const finish = new IterativeDeepeningAI({ maxDepth: 1, timeLimitMs: 1000, now: () => 0 }).search(response);
      assert.ok(finish.bestMove);
      const end = RuleEngine.executeTurn(response, finish.bestMove).state;
      assert.equal(end.game_status, 'FINISHED'); assert.equal(end.winner, attacker);
      assert.equal(end.winner_reason, 'TEMPLE_TRAP');
      seen.add(JSON.stringify(end));
    }
    assert.ok(seen.size > 0);
  }
});

test('a reopened seal requires a longer real proof, and the main board is not a temple loss', async () => {
  const { proveBlockadeMove } = await import('../miniprogram/ai/blockade.ts');
  const state = actualBlockade();
  const move: Move = { from: 'P26', to: 'P03' };
  assert.equal(proveBlockadeMove(state, move, { maxAttackerTurns: 1 }), null);
  const recovered = proveBlockadeMove(state, move);
  assert.ok(recovered); assert.equal(recovered.maxPlies, 7);
  for (const line of recovered.lines) assert.equal(line.reduce((s, m) => RuleEngine.executeTurn(s,m).state, state).winner, 'B');
  const occupancy = { ...state.board.occupancy, P28: null, P03: 'A' as const };
  const escaped = { ...state, board: { occupancy } };
  assert.equal(proveBlockadeMove(escaped, { from: 'P05', to: 'P04' }), null);
  assert.equal(escaped.game_status, 'PLAYING');
});

test('zero budget never invents a proof, and an interrupted extension does not publish a partial root', async () => {
  const { AlphaBetaAI } = await import('../miniprogram/ai/alpha-beta.ts');
  const state = actualBlockade();
  const zero = new IterativeDeepeningAI({ maxDepth: 2, timeLimitMs: 0, now: () => 0 }).search(state);
  assert.equal(zero.searchDepth, 0); assert.equal(zero.timedOut, true);
  assert.deepEqual(zero.candidateMoves, []); assert.ok(zero.bestMove);
  let calls = 0;
  assert.throws(() => new AlphaBetaAI({ depth: 1 }).search(state, 'B', {
    checkTimeout() { if (++calls > 5) throw new Error('budget exhausted'); },
  }), /budget exhausted/);
});

test('extended exact root scores agree with reference Minimax and TT for both perspectives', async () => {
  const { AlphaBetaAI } = await import('../miniprogram/ai/alpha-beta.ts');
  const { MinimaxAI } = await import('../miniprogram/ai/minimax.ts');
  const state = actualBlockade();
  for (const perspective of ['A', 'B'] as const) {
    const expected = new MinimaxAI({ depth: 1 }).search(state, perspective);
    const actual = new AlphaBetaAI({ depth: 1, useTranspositionTable: true }).search(state, perspective);
    assert.equal(actual.evaluationScore, expected.evaluationScore);
    assert.deepEqual(actual.bestMove, expected.bestMove);
    assert.deepEqual(actual.candidateMoves, expected.candidateMoves);
    assert.equal(actual.candidateMoves.length, RuleEngine.getAllLegalMoves(state).length);
  }
});

test('a verified winning root move survives timeout without publishing incomplete candidate scores', async () => {
  const { AlphaBetaAI } = await import('../miniprogram/ai/alpha-beta.ts');
  const original = AlphaBetaAI.prototype.search;
  let clock = 0;
  AlphaBetaAI.prototype.search = function (state, perspective, control = {}) {
    return original.call(this, state, perspective, { ...control,
      onRootCandidate(move, score, isMate) {
        control.onRootCandidate?.(move, score, isMate);
        if (isMate && score > 900_000) clock = 1000;
      },
    });
  };
  try {
    const state = actualBlockade();
    const result = new IterativeDeepeningAI({ maxDepth: 2, timeLimitMs: 500, now: () => clock }).search(state);
    assert.equal(result.timedOut, true);
    assert.equal(result.searchDepth, 0);
    assert.deepEqual(result.candidateMoves, []);
    assert.ok(result.bestMove);
    assert.ok(finishesAgainstEveryReply(state, result.bestMove));
    assert.ok(result.evaluationScore > 900_000);
  } finally { AlphaBetaAI.prototype.search = original; }
});

test('review retains completed scores when a deeper winning proof is interrupted', async () => {
  const { AlphaBetaAI } = await import('../miniprogram/ai/alpha-beta.ts');
  const original = AlphaBetaAI.prototype.search;
  let clock = 0;
  AlphaBetaAI.prototype.search = function (state, perspective, control = {}) {
    return original.call(this, state, perspective, { ...control,
      onRootCandidate(move, score, isMate) {
        control.onRootCandidate?.(move, score, isMate);
        if (isMate && score > 900_000) clock = 1000;
      },
    });
  };
  try {
    const state = actualBlockade();
    for (const node of Object.keys(state.board.occupancy)) state.board.occupancy[node as keyof typeof state.board.occupancy] = null;
    Object.assign(state.board.occupancy, { P05: 'B', P26: 'B', P28: 'B', P29: 'A' });
    Object.assign(state.players.A, { reserve_count: 0 });
    Object.assign(state.players.B, { reserve_count: 4 });
    const move: Move = { from: 'P05', to: 'P03' };
    const after = RuleEngine.executeTurn(state, move).state;
    // Disable selective extension here so the proof first appears in a deeper
    // ordinary layer even when the tactical horizon is enlarged in the future.
    const review = analyzeReviewMove(state, after, move, { maxDepth: 6, timeLimitMs: 500,
      useBlockadeExtension: false,
      candidateLimit: 29, goodMaxLoss: 0, normalMaxLoss: 30, mistakeMaxLoss: 100, now: () => clock });
    assert.equal(review.timedOut, true);
    assert.equal(review.searchDepth, 4);
    assert.equal(review.bestCandidateMoves.length, RuleEngine.getAllLegalMoves(state).length);
    const actual = review.bestCandidateMoves.find(candidate => candidate.move.from === move.from && candidate.move.to === move.to);
    assert.ok(actual);
    assert.equal(review.scoreLoss, review.bestScore - actual.score);
  } finally { AlphaBetaAI.prototype.search = original; }
});
