import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { createInitialGameState } from '../miniprogram/domain/index.ts';
import type { GameState } from '../miniprogram/domain/index.ts';

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
const { mapPositionAnalysis } = await import(
  '../miniprogram/pages/analysis/analysis-view-model.ts');

test('maps a real position into board, score rows, occupied key pieces and candidates', () => {
  const state = createInitialGameState();
  const analysis = analyzePosition(state,
    { maxDepth: 1, timeLimitMs: 1000, now: () => 0 });
  const view = mapPositionAnalysis(state, analysis);

  assert.equal(view.board.pieces.length, 10);
  assert.equal(view.perspective, state.current_player);
  assert.equal(view.score, analysis.evaluationBefore.score);
  assert.equal(view.bestScore, analysis.bestScore);
  assert.deepEqual(view.breakdown.map((row: any) => row.key), [
    'material', 'reserve', 'mobility', 'templeControl',
    'captureOpportunity', 'vulnerability', 'trapRisk',
  ]);
  assert.deepEqual(view.candidates.map((row: any) => row.score),
    analysis.candidateMoves.map((row: any) => row.score));
  assert.deepEqual(view.candidates.map((row: any) => row.notation),
    analysis.candidateMoves.map((row: any) => `${row.move.from} → ${row.move.to}`));
  assert.ok(view.keyPieces.length > 0);
  assert.ok(view.keyPieces.every((row: any) =>
    state.board.occupancy[row.nodeId] !== null));
  assert.equal(view.board.recommendedFrom, analysis.bestMove?.from);
  assert.equal(view.board.recommendedTo, analysis.bestMove?.to);
});

test('terminal analysis has no invented recommendation or candidates', () => {
  const initial = createInitialGameState();
  const terminal: GameState = { ...initial, game_status: 'FINISHED', winner: 'A',
    winner_reason: 'CAPTURE_ALL' };
  const analysis = analyzePosition(terminal,
    { maxDepth: 1, timeLimitMs: 1000, now: () => 0 });
  const view = mapPositionAnalysis(terminal, analysis);

  assert.equal(view.terminal, true);
  assert.equal(view.bestMove, null);
  assert.deepEqual(view.candidates, []);
  assert.equal(view.board.recommendedFrom, undefined);
  assert.equal(view.board.recommendedTo, undefined);
});
