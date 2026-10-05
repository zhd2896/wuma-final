/** Real WeChat → FastAPI → MySQL → Node worker finished-game review. */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const automator = require('miniprogram-automator');
const { createWechatAccount, seedMiniAccount } = require('./device-account-e2e.cjs');

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
    Promise.resolve(promise).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

async function api(method, route, body) {
  const response = await fetch(`${apiBase}${route}`, { method,
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${accountToken}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  const envelope = await response.json();
  if (!response.ok || envelope.code !== 0) {
    throw new Error(`${method} ${route}: ${response.status} ${envelope.code} ${envelope.message}`);
  }
  return envelope.data;
}

function database(gameId) {
  if (!process.env.WUMA_TEST_DATABASE_URL) {
    throw new Error('WUMA_TEST_DATABASE_URL is required for isolated MySQL verification');
  }
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
    const account = await createWechatAccount(apiBase, mini);
    accountToken = account.token;
    await seedMiniAccount(mini, apiBase, account);
    console.log('[2] Creating finished fixture game through real move API');
    const game = await timed(api('POST', '/api/v1/game',
      { first_player: 'A', mode: 'LOCAL' }), 'fixture game creation', 10000);
    const gameId = game.game_id;
    for (const [from, to] of fixture) {
      await timed(api('POST', `/api/v1/game/${gameId}/move`,
        { from_node: from, to_node: to }), `fixture move ${from}->${to}`, 10000);
    }
    const finished = await api('GET', `/api/v1/game/${gameId}`);
    assert.equal(finished.state.game_status, 'FINISHED');
    assert.equal(finished.state.winner, 'B');
    assert.equal(finished.state.winner_reason, 'LONE_PIECE_IMMOBILIZED');
    assert.equal(finished.version, fixture.length);
    const before = database(gameId);
    assert.equal(before.game_moves_count, fixture.length);
    assert.equal(before.game_review_count, 0);
    console.log(`[2] Finished fixture game created id=${gameId} mode=LOCAL turns=${fixture.length}`);

    const started = Date.now();
    console.log('[3] Opening review page');
    const page = await timed(mini.reLaunch(`/pages/review/review?gameId=${gameId}`),
      'review page discovery', 15000);
    assert.ok(page, 'review page missing');
    console.log('[3] Review page opened; automatic GET and POST started');
    const data = await until(page, value => value.state === 'success' && value.review?.gameId === gameId,
      'review generation', 120000);
    const totalReviewTimeMs = Date.now() - started;
    const review = data.review;
    assert.equal(review.reviewedPlayer, 'A');
    assert.equal(review.moveReviews.length, 7);
    assert.deepEqual(review.moveReviews.map(item => item.turn), [1, 3, 5, 7, 9, 11, 13]);
    assert.equal(data.rows.length, 7);
    assert.equal(data.bestMoveRateText, `${(review.bestMoveRate * 100).toFixed(1)}%`);
    console.log(`[4] Review generated id=${review.id} reviewedMoves=${review.moveReviews.length} ms=${totalReviewTimeMs}`);

    const stats = await timed(page.$('.review-stats'), 'review statistics element', 10000);
    const move = await timed(page.$('.review-move'), 'move review element', 10000);
    const metrics = await timed(page.$$('.review-metric'), 'review metrics elements', 10000);
    assert.ok(stats && move && metrics.length >= 2, 'review statistics or moves not rendered');
    const statsText = await stats.text();
    const moveText = await move.text();
    const metricText = (await Promise.all(metrics.map(item => item.text()))).join(' ');
    for (const label of ['GOOD', 'NORMAL', 'MISTAKE', 'BLUNDER']) {
      assert.ok(statsText.includes(label), `UI missing ${label}`);
    }
    assert.ok(metricText.includes(data.bestMoveRateText), 'UI missing bestMoveRate');
    assert.ok(metricText.includes(data.turningText), 'UI missing turningPoints');
    assert.ok(moveText.includes(data.rows[0].actualText), 'UI missing actual MoveReview');
    console.log('[5] WeChat rendered statistics, turning points and MoveReview');

    const read = await api('GET', `/api/v1/game/${gameId}/review`);
    assert.deepEqual(read, review);
    console.log('[6] GET review verified against UI POST result');
    const duplicate = await api('POST', `/api/v1/game/${gameId}/review`, {});
    assert.deepEqual(duplicate, review);
    const after = database(gameId);
    assert.equal(after.game_review_count, 1);
    assert.equal(after.move_review_count, 7);
    assert.deepEqual(after.move_review_turns, [1, 3, 5, 7, 9, 11, 13]);
    assert.deepEqual(after.review_config_versions, [1]);
    assert.deepEqual(after.move_review_source_ids,
      after.move_review_turns.map(turn => after.game_move_ids[turn - 1]));
    assert.deepEqual(after.current_state, before.current_state);
    assert.equal(after.version, before.version);
    assert.equal(after.game_moves_count, before.game_moves_count);
    const current = await api('GET', `/api/v1/game/${gameId}`);
    assert.deepEqual(current.state, finished.state);
    assert.equal(current.version, finished.version);
    console.log('[7] MySQL review rows and duplicate POST verified');
    console.log('[8] Game state, version and move count unchanged');
    console.log(JSON.stringify({ gameId, mode: 'LOCAL', winner: review.winner,
      winnerReason: review.winnerReason, reviewedPlayer: review.reviewedPlayer,
      reviewedMoves: review.moveReviews.length, good: review.goodMoves,
      normal: review.normalMoves, mistake: review.mistakes, blunder: review.blunders,
      bestMoveRate: review.bestMoveRate, turningPoints: review.turningPoints,
      overallScore: review.overallScore, totalReviewTimeMs,
      timedOutTurns: review.moveReviews.filter(item => item.timedOut)
        .map(item => ({ turn: item.turn, searchDepth: item.searchDepth })),
      moveReviews: review.moveReviews.slice(0, 3).map(item => ({
        turn: item.turn, player: item.player, actualMove: item.actualMove,
        bestMove: item.bestMove, bestScore: item.bestScore,
        actualMoveScore: item.actualMoveScore, scoreLoss: item.scoreLoss,
        category: item.category, bestMoveEquivalent: item.bestMoveEquivalent,
        searchDepth: item.searchDepth, timedOut: item.timedOut,
      })),
      gameReviewsCount: after.game_review_count,
      moveReviewsCount: after.move_review_count,
      gameStateChanged: false, versionChanged: false, gameMovesCountChanged: false,
      duplicateRows: false,
    }));
  } finally {
    mini.disconnect();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
