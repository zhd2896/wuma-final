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

const { analyzeReviewMove } = await import('../miniprogram/ai/review-analysis.ts');
const { analyzePosition } = await import('../miniprogram/ai/position-analysis.ts');
const config = { maxDepth: 2, timeLimitMs: 1000, candidateLimit: 3,
  goodMaxLoss: 0, normalMaxLoss: 30, mistakeMaxLoss: 100, now: () => 0 };

function withPieces(pieces: Record<string, 'A' | 'B'>, player: 'A' | 'B') {
  const initial = createInitialGameState({ firstPlayer: player });
  const occupancy = { ...initial.board.occupancy };
  for (const node of NODE_IDS) occupancy[node] = null;
  for (const [node, owner] of Object.entries(pieces)) occupancy[node as typeof NODE_IDS[number]] = owner;
  return { ...initial, board: { occupancy } };
}

test('review scores actual move outside top three with the same full-depth search', () => {
  for (const player of ['A', 'B'] as const) {
    const state = withPieces({ P01: 'A', P06: 'A', P05: 'B', P10: 'B' }, player);
    const full = analyzePosition(state, { ...config, candidateLimit: Number.MAX_SAFE_INTEGER });
    assert.ok(full.candidateMoves.length > 3);
    const actual = full.candidateMoves.at(-1)!.move;
    const after = RuleEngine.executeTurn(state, actual).state;
    const result = analyzeReviewMove(state, after, actual, config);
    assert.equal(result.actualMoveScore, full.candidateMoves.at(-1)!.score);
    assert.equal(result.bestScore, full.bestScore);
    assert.equal(result.scoreLoss, result.bestScore - result.actualMoveScore);
    assert.equal(result.scorePerspective, player);
    assert.equal(result.evaluationAfter.scorePerspective, player);
    assert.equal(result.bestCandidateMoves.length, 3);
  }
});

test('different moves with equal best score are GOOD and best equivalent', () => {
  const state = createInitialGameState({ firstPlayer: 'A' });
  const shallow = { ...config, maxDepth: 1 };
  const full = analyzePosition(state, { ...shallow, candidateLimit: Number.MAX_SAFE_INTEGER });
  const tied = full.candidateMoves.find((item: any) => item.score === full.bestScore &&
    (item.move.from !== full.bestMove.from || item.move.to !== full.bestMove.to));
  assert.ok(tied);
  const result = analyzeReviewMove(state, RuleEngine.executeTurn(state, tied.move).state,
    tied.move, shallow);
  assert.equal(result.scoreLoss, 0);
  assert.equal(result.category, 'GOOD');
  assert.equal(result.bestMoveEquivalent, true);
});

test('review rejects a history snapshot that disagrees with the actual move', () => {
  const state = withPieces({ P01: 'A', P06: 'A', P05: 'B', P10: 'B' }, 'A');
  assert.throws(() => analyzeReviewMove(state, state, { from: 'P01', to: 'P02' }, config),
    (error: any) => error.code === 'REPLAY_INTEGRITY_ERROR');
});

test('review accepts equivalent database JSON with reordered object keys', () => {
  const state = withPieces({ P01: 'A', P06: 'A', P05: 'B', P10: 'B' }, 'A');
  const move = { from: 'P01', to: 'P02' } as const;
  const after = RuleEngine.executeTurn(state, move).state;
  const reordered = { ...after, board: { occupancy: Object.fromEntries(
    Object.entries(after.board.occupancy).reverse()) },
    players: { B: after.players.B, A: after.players.A } };
  const result = analyzeReviewMove(state, reordered, move, config);
  assert.equal(result.actualMove.from, 'P01');
});

test('immediate mate is GOOD and missing it has a finite mate-range loss', () => {
  const state = withPieces({ P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A' }, 'A');
  const win = { from: 'P19', to: 'P13' } as const;
  const winning = analyzeReviewMove(state, RuleEngine.executeTurn(state, win).state, win, config);
  assert.equal(winning.category, 'GOOD');
  assert.equal(winning.scoreLoss, 0);
  const full = analyzePosition(state, { ...config, candidateLimit: Number.MAX_SAFE_INTEGER });
  const miss = full.candidateMoves.find((item: any) => item.score < full.bestScore &&
    RuleEngine.executeTurn(state, item.move).state.game_status === 'PLAYING');
  assert.ok(miss);
  const missed = analyzeReviewMove(state, RuleEngine.executeTurn(state, miss.move).state,
    miss.move, config);
  assert.ok(Number.isFinite(missed.scoreLoss));
  assert.equal(missed.category, 'BLUNDER');
  assert.match(missed.engineExplanation, /直接获胜机会/);
});

test('all non-best categories follow centralized heuristic thresholds', () => {
  const state = withPieces({ P01: 'A', P06: 'A', P05: 'B', P10: 'B' }, 'A');
  const full = analyzePosition(state, { ...config, candidateLimit: Number.MAX_SAFE_INTEGER });
  const weak = full.candidateMoves.findLast((item: any) => item.score < full.bestScore);
  assert.ok(weak);
  const after = RuleEngine.executeTurn(state, weak.move).state;
  const loss = full.bestScore - weak.score;
  assert.ok(loss > 0);
  const normal = analyzeReviewMove(state, after, weak.move,
    { ...config, normalMaxLoss: loss, mistakeMaxLoss: loss + 1 });
  assert.equal(normal.category, 'NORMAL');
  const mistake = analyzeReviewMove(state, after, weak.move,
    { ...config, normalMaxLoss: loss / 2, mistakeMaxLoss: loss });
  assert.equal(mistake.category, 'MISTAKE');
  const blunder = analyzeReviewMove(state, after, weak.move,
    { ...config, normalMaxLoss: 0, mistakeMaxLoss: loss / 2 });
  assert.equal(blunder.category, 'BLUNDER');
});

test('best move in a forced slow loss is GOOD despite the final losing score', () => {
  const state = withPieces({ P03: 'B', P04: 'A', P27: 'A', P08: 'A',
    P09: 'A', P07: 'A', P26: 'A', P06: 'A' }, 'B');
  const deep = { ...config, maxDepth: 4, timeLimitMs: 60000 };
  const analysis = analyzePosition(state, deep);
  assert.ok(analysis.bestScore < -900000);
  const move = analysis.bestMove!;
  const result = analyzeReviewMove(state, RuleEngine.executeTurn(state, move).state, move, deep);
  assert.equal(result.scorePerspective, 'B');
  assert.equal(result.searchDepth, 4);
  assert.equal(result.scoreLoss, 0);
  assert.equal(result.category, 'GOOD');
});
