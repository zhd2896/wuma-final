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

const { analyzePosition } = await import('../miniprogram/ai/position-analysis.ts');
const { evaluatePosition } = await import('../miniprogram/ai/evaluation.ts');
const { IterativeDeepeningAI } = await import('../miniprogram/ai/iterative-deepening.ts');

function withPieces(pieces: Record<string, 'A' | 'B'>, currentPlayer: 'A' | 'B' = 'A') {
  const initial = createInitialGameState({ firstPlayer: currentPlayer });
  const occupancy = { ...initial.board.occupancy };
  for (const node of NODE_IDS) occupancy[node] = null;
  for (const [node, player] of Object.entries(pieces)) occupancy[node as typeof NODE_IDS[number]] = player;
  return { ...initial, board: { occupancy } };
}

test('analysis reuses static evaluation and exact completed search for both perspectives', () => {
  for (const player of ['A', 'B'] as const) {
    const state = withPieces({ P01: 'A', P06: 'A', P05: 'B', P10: 'B' }, player);
    const before = structuredClone(state);
    const analysis = analyzePosition(state, { maxDepth: 2, timeLimitMs: 1000, now: () => 0 });
    const search = new IterativeDeepeningAI({ maxDepth: 2, timeLimitMs: 1000,
      now: () => 0 }).search(state, player);
    assert.deepEqual(state, before);
    assert.equal(analysis.analyzedPlayer, player);
    assert.equal(analysis.scorePerspective, player);
    assert.deepEqual(analysis.evaluationBefore, evaluatePosition(state, player));
    assert.deepEqual(analysis.evaluationBreakdown, analysis.evaluationBefore.breakdown);
    assert.equal(Object.values(analysis.evaluationBreakdown).reduce(
      (sum: number, feature: any) => sum + feature.weightedScore, 0),
    analysis.evaluationBefore.score);
    assert.deepEqual(analysis.bestMove, search.bestMove);
    assert.equal(analysis.bestScore, search.evaluationScore);
    assert.equal(analysis.searchDepth, search.searchDepth);
    assert.equal(analysis.nodesSearched, search.nodesSearched);
    assert.deepEqual(analysis.candidateMoves.map((candidate: any) => candidate.rank),
      analysis.candidateMoves.map((_: any, index: number) => index + 1));
    assert.deepEqual(analysis.candidateMoves.map((candidate: any) => candidate.score),
      [...analysis.candidateMoves.map((candidate: any) => candidate.score)].sort((a, b) => b - a));
    assert.equal(analysis.candidateMoves[0].score, analysis.bestScore);
  }
});

test('candidate limit truncates return only, preserving best move and score', () => {
  const state = withPieces({ P01: 'A', P06: 'A', P05: 'B', P10: 'B' });
  const full = analyzePosition(state, { maxDepth: 2, timeLimitMs: 1000, now: () => 0 });
  const limited = analyzePosition(state, { maxDepth: 2, timeLimitMs: 1000,
    candidateLimit: 3, now: () => 0 });
  assert.ok(full.candidateMoves.length > 3);
  assert.deepEqual(limited.candidateMoves, full.candidateMoves.slice(0, 3));
  assert.deepEqual(limited.bestMove, full.bestMove);
  assert.equal(limited.bestScore, full.bestScore);
  assert.equal(limited.nodesSearched, full.nodesSearched);
});

test('default analysis options use a bounded preset', () => {
  const state = withPieces({ P01: 'A', P06: 'A', P05: 'B', P10: 'B' });
  const result = analyzePosition(state);
  assert.equal(result.analyzedPlayer, 'A');
  assert.ok(result.candidateMoves.length <= 3);
  assert.ok(result.searchDepth <= 2);
});

test('zero time budget is a normal timed-out analysis with no invented candidate score', () => {
  const state = withPieces({ P01: 'A', P06: 'A', P05: 'B', P10: 'B' });
  const result = analyzePosition(state, { maxDepth: 3, timeLimitMs: 0, now: () => 0 });
  assert.equal(result.timedOut, true);
  assert.equal(result.searchDepth, 0);
  assert.deepEqual(result.candidateMoves, []);
  assert.equal(result.bestScore, result.evaluationBefore.score);
});

test('finished positions have terminal evaluation and never offer a move', () => {
  const fixtures = [
    [{ P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A' }, 'P19', 'P13', 'CAPTURE_ALL'],
    [{ P27: 'B', P26: 'A', P28: 'A', P29: 'A', P03: 'A', P21: 'A' }, 'P21', 'P22', 'TEMPLE_TRAP'],
    [{ P03: 'B', P02: 'A', P04: 'A', P27: 'A', P08: 'A', P09: 'A', P07: 'A',
      P26: 'A', P28: 'A', P21: 'A' }, 'P21', 'P22', 'LONE_PIECE_IMMOBILIZED'],
  ] as const;
  for (const [pieces, from, to, reason] of fixtures) {
    const state = RuleEngine.executeTurn(withPieces(pieces), { from, to }).state;
    assert.equal(state.winner_reason, reason);
    const result = analyzePosition(state, { maxDepth: 3, timeLimitMs: 1000 });
    assert.equal(result.terminal, true);
    assert.equal(result.bestMove, null);
    assert.deepEqual(result.candidateMoves, []);
    assert.equal(result.bestScore, result.evaluationBefore.score);
    assert.equal(result.searchDepth, 0);
    assert.deepEqual(result.threats, []);
  }
});

test('immediate win threat carries the real winner reason and move', () => {
  const state = withPieces({ P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A' });
  const result = analyzePosition(state, { maxDepth: 1, timeLimitMs: 1000, now: () => 0 });
  assert.ok(result.threats.some((threat: any) =>
    threat.type === 'IMMEDIATE_WIN_AVAILABLE' && threat.player === 'A' &&
    threat.relatedMove.from === 'P19' && threat.relatedMove.to === 'P13' &&
    threat.evidence.winnerReason === 'CAPTURE_ALL'));
});

test('vulnerability and lone-piece risk use Evaluation evidence', () => {
  const vulnerable = withPieces({ P01: 'B', P02: 'A', P04: 'B', P29: 'A' });
  const a = analyzePosition(vulnerable, { maxDepth: 1, timeLimitMs: 1000, now: () => 0 });
  const weakness = a.threats.find((threat: any) => threat.type === 'VULNERABILITY');
  assert.equal(weakness?.evidence.excessOpponentCaptureMoves,
    a.evaluationBreakdown.vulnerability.rawValue);
  const lone = withPieces({ P03: 'B', P21: 'A', P25: 'A' }, 'B');
  const b = analyzePosition(lone, { maxDepth: 1, timeLimitMs: 1000, now: () => 0 });
  const risk = b.threats.find((threat: any) => threat.type === 'LONE_PIECE_MOBILITY_RISK');
  assert.equal(risk?.evidence.relativeLonePieceRisk, b.evaluationBreakdown.trapRisk.rawValue);
});

test('structured threats come from real one-ply engine and evaluation evidence', () => {
  const state = withPieces({ P01: 'A', P02: 'B', P04: 'A', P29: 'B' });
  const result = analyzePosition(state, { maxDepth: 1, timeLimitMs: 1000, now: () => 0 });
  assert.ok(result.threats.some((threat: any) => threat.type === 'CAPTURE_AVAILABLE' &&
    threat.player === 'A' && threat.relatedMove));
  assert.ok(result.threats.some((threat: any) => threat.type === 'CAPTURE_THREAT' &&
    threat.player === 'A' && threat.relatedMove.from === 'P04' &&
    threat.relatedMove.to === 'P05'));
  assert.deepEqual(result.threats,
    analyzePosition(state, { maxDepth: 1, timeLimitMs: 1000, now: () => 0 }).threats);
});

test('nonterminal position with no legal moves preserves RULE_AMBIGUITY', () => {
  const state = withPieces({ P03: 'B', P13: 'B', P02: 'A', P04: 'A', P27: 'A',
    P08: 'A', P09: 'A', P07: 'A', P26: 'A', P28: 'A', P12: 'A', P14: 'A',
    P18: 'A', P19: 'A', P17: 'A' }, 'B');
  assert.throws(() => analyzePosition(state, { maxDepth: 1, timeLimitMs: 1000 }),
    (error: any) => error.code === 'RULE_AMBIGUITY');
});
