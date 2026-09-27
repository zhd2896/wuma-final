import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

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

test('review page reads or creates review, explains it, and keeps structured fields', async () => {
  const requests: string[] = [];
  const review = { id: 'r1', gameId: 'g1', reviewedPlayer: 'A', winner: 'A',
    winnerReason: 'CAPTURE_ALL', goodMoves: 1, normalMoves: 0, mistakes: 0, blunders: 0,
    bestMoveRate: 1, turningPoints: [], moveReviews: [{ turn: 1, player: 'A',
      actualMove: { from: 'P19', to: 'P13' }, bestMove: { from: 'P19', to: 'P13' },
      scoreLoss: 0, category: 'GOOD', engineExplanation: '实际走法与最佳方案搜索同分。' }] };
  const explanation = { gameReviewId: 'r1', promptVersion: 'review_explanation_v1',
    gameExplanation: { overall_summary: '本局共复盘一手。', strengths: [], main_problems: [],
      practice_suggestions: ['比较实际走法。'], fallbackUsed: true, provider: 'fallback', model: null },
    moveExplanations: [{ turn: 1, headline: '第 1 手复盘', explanation: '这一手同分。',
      suggestion: '比较实际走法。', fallbackUsed: true, provider: 'fallback', model: null }] };
  let definition: Record<string, any> | null = null;
  (globalThis as any).Page = (value: Record<string, any>) => { definition = value; };
  (globalThis as any).wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    request: (options: any) => {
      requests.push(`${options.method} ${new URL(options.url).pathname}`);
      const explain = new URL(options.url).pathname.endsWith('/explain');
      if (options.method === 'GET') options.success({ statusCode: 404,
        data: { code: explain ? 'EXPLANATION_NOT_FOUND' : 'REVIEW_NOT_FOUND',
          message: 'missing', data: null } });
      else options.success({ statusCode: 200,
        data: { code: 0, message: 'success', data: explain
          ? { review, explanation } : review } });
    },
  };
  await import('../miniprogram/pages/review/review.ts');
  assert.ok(definition);
  const page = { ...definition!, data: { ...definition!.data },
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); } };
  await page.load('g1');
  assert.deepEqual(requests, ['GET /api/v1/game/g1/review', 'POST /api/v1/game/g1/review',
    'GET /api/v1/game/g1/review/explain', 'POST /api/v1/game/g1/review/explain']);
  assert.equal(page.data.state, 'success');
  assert.equal(page.data.bestMoveRateText, '100.0%');
  assert.equal(page.data.rows[0].actualText, 'P19 → P13');
  assert.equal(page.data.isGeneratingExplanation, false);
  assert.equal(page.data.explanationState, 'success');
  assert.equal(page.data.rows[0].naturalExplanation, '这一手同分。');
  assert.equal(page.data.gameExplanation.overall_summary, '本局共复盘一手。');
  assert.match(readFileSync('miniprogram/pages/review/review.wxml', 'utf8'), /scoreLoss/);
  assert.match(readFileSync('miniprogram/pages/review/review.wxml', 'utf8'), /naturalExplanation/);
});
