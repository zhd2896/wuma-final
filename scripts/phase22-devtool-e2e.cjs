/** Real finished game → Review → no-key explanation → WeChat UI → MySQL. */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const automator = require('miniprogram-automator');
const { createDeviceAccount, seedMiniAccount } = require('./device-account-e2e.cjs');

const endpoint = process.env.WUMA_WECHAT_AUTO_ENDPOINT || 'ws://127.0.0.1:9420';
const apiBase = process.env.WUMA_REVIEW_E2E_API || 'http://127.0.0.1:8000';
const python = process.env.WUMA_PYTHON || path.resolve('backend/.venv/Scripts/python.exe');
let accountToken;
const fixture = [
  ['P01', 'P19'], ['P05', 'P01'], ['P16', 'P18'], ['P01', 'P07'],
  ['P18', 'P13'], ['P07', 'P03'], ['P11', 'P17'], ['P10', 'P07'],
  ['P06', 'P11'], ['P15', 'P14'], ['P17', 'P22'], ['P14', 'P04'],
  ['P19', 'P23'], ['P20', 'P17'],
];

function timed(promise, label, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); });
  });
}

async function api(method, route, body) {
  const response = await fetch(`${apiBase}${route}`, { method,
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${accountToken}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(180000),
  });
  const envelope = await response.json();
  if (!response.ok || envelope.code !== 0) {
    throw new Error(`${method} ${route}: ${response.status} ${envelope.code} ${envelope.message}`);
  }
  return envelope.data;
}

function database(gameId) {
  assert.ok(process.env.WUMA_TEST_DATABASE_URL, 'WUMA_TEST_DATABASE_URL required');
  return JSON.parse(execFileSync(python,
    [path.resolve('scripts/phase21_review_db_probe.py'), gameId],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 15000 }));
}

async function until(page, predicate, label, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const data = await timed(page.data(), `${label}: page data`, 10000);
    if (data.state === 'error') throw new Error(`${label}: ${data.errorMessage}`);
    if (predicate(data)) return data;
    await page.waitFor(250);
  }
  throw new Error(`${label} timed out after ${ms} ms`);
}

async function main() {
  console.log(`[1] Connecting DevTools ${endpoint}`);
  const mini = await timed(automator.connect({ wsEndpoint: endpoint }),
    'DevTools connection', 15000);
  console.log('[1] DevTools connected');
  try {
    accountToken = await createDeviceAccount(apiBase);
    await seedMiniAccount(mini, apiBase, accountToken);
    console.log('[2] Creating real finished game via existing move API');
    const game = await timed(api('POST', '/api/v1/game',
      { first_player: 'A', mode: 'LOCAL' }), 'create game', 10000);
    const gameId = game.game_id;
    for (const [from, to] of fixture) {
      await timed(api('POST', `/api/v1/game/${gameId}/move`,
        { from_node: from, to_node: to }), `move ${from}->${to}`, 10000);
    }
    const finished = await api('GET', `/api/v1/game/${gameId}`);
    assert.equal(finished.state.game_status, 'FINISHED');
    assert.equal(finished.version, fixture.length);
    const before = database(gameId);
    console.log(`[2] FINISHED game id=${gameId} turns=${fixture.length}`);

    console.log('[3] Generating existing Phase 21 review');
    const review = await timed(api('POST', `/api/v1/game/${gameId}/review`, {}),
      'review generation', 120000);
    assert.equal(review.moveReviews.length, 7);
    assert.equal(database(gameId).explanation_count, 0);
    console.log(`[3] Review id=${review.id} moves=${review.moveReviews.length}`);

    console.log('[4] Opening WeChat review page to trigger explanation');
    const page = await timed(mini.reLaunch(`/pages/review/review?gameId=${gameId}`),
      'page discovery', 15000);
    const shown = await until(page, data => data.state === 'success' &&
      data.explanationState === 'success' && data.review?.id === review.id,
    'fallback explanation', 30000);
    assert.equal(shown.isGeneratingExplanation, false);
    assert.deepEqual(shown.review, review);
    assert.equal(shown.gameExplanation.fallbackUsed, true);
    assert.equal(shown.gameExplanation.provider, 'fallback');
    assert.equal(shown.rows.length, 7);
    assert.ok(shown.rows.every(row => row.naturalExplanation && row.naturalSuggestion &&
      row.explanationFallbackUsed));
    const summary = await timed(page.$('.review-natural'), 'summary element', 10000);
    const move = await timed(page.$('.review-natural-move'), 'move explanation element', 10000);
    assert.ok(summary && move, 'WeChat explanation elements missing');
    assert.ok((await summary.text()).includes(shown.gameExplanation.overall_summary));
    assert.ok((await move.text()).includes(shown.rows[0].naturalExplanation));
    console.log('[4] WeChat rendered no-key fallback summary and move explanation');

    const explainedPath = `/api/v1/game/${gameId}/review/explain`;
    const saved = await api('GET', explainedPath);
    assert.deepEqual(saved.review, review);
    assert.equal(saved.explanation.gameReviewId, review.id);
    assert.equal(saved.explanation.promptVersion, 'review_explanation_v1');
    assert.ok(saved.explanation.moveExplanations.every(item => item.fallbackUsed));
    const firstDb = database(gameId);
    assert.equal(firstDb.explanation_count, 1);
    assert.deepEqual(firstDb.explanation_prompt_versions, ['review_explanation_v1']);
    assert.deepEqual(firstDb.explanation_fallback_used, [true]);
    console.log('[5] GET and MySQL persistence verified');

    const again = await api('POST', explainedPath, {});
    assert.deepEqual(again, saved);
    const reopened = await timed(mini.reLaunch(`/pages/review/review?gameId=${gameId}`),
      'second page discovery', 15000);
    const second = await until(reopened, data => data.explanationState === 'success' &&
      data.review?.id === review.id, 'second load', 15000);
    assert.equal(second.gameExplanation.overall_summary,
      saved.explanation.gameExplanation.overall_summary);
    const finalDb = database(gameId);
    assert.equal(finalDb.explanation_count, 1);
    assert.deepEqual(finalDb.explanation_created_at, firstDb.explanation_created_at);
    assert.deepEqual(finalDb.current_state, before.current_state);
    assert.equal(finalDb.version, before.version);
    assert.equal(finalDb.game_moves_count, before.game_moves_count);
    assert.equal(finalDb.game_review_count, 1);
    assert.equal(finalDb.move_review_count, 7);
    assert.deepEqual((await api('GET', `/api/v1/game/${gameId}/review`)), review);
    console.log('[6] Second load reused saved explanation; game/review unchanged');
    console.log(JSON.stringify({ gameId, reviewId: review.id, mode: 'LOCAL',
      explanationCount: finalDb.explanation_count,
      promptVersion: saved.explanation.promptVersion,
      provider: saved.explanation.gameExplanation.provider,
      model: saved.explanation.gameExplanation.model,
      fallbackUsed: saved.explanation.gameExplanation.fallbackUsed,
      summary: saved.explanation.gameExplanation.overall_summary,
      moves: review.moveReviews.slice(0, 3).map(item => {
        const text = saved.explanation.moveExplanations.find(part => part.turn === item.turn);
        return { turn: item.turn, category: item.category, actualMove: item.actualMove,
          bestMove: item.bestMove, scoreLoss: item.scoreLoss,
          explanation: text.explanation, suggestion: text.suggestion,
          fallbackUsed: text.fallbackUsed };
      }),
      secondLoadReused: true, gameStateChanged: false, reviewChanged: false }));
  } finally {
    mini.disconnect();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
