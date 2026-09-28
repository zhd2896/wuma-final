/** Finished game → review → training page → two real answers → MySQL records. */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const automator = require('miniprogram-automator');
const { createDeviceAccount, seedMiniAccount } = require('./device-account-e2e.cjs');

const endpoint = process.env.WUMA_WECHAT_AUTO_ENDPOINT || 'ws://127.0.0.1:9420';
const apiBase = process.env.WUMA_TRAINING_E2E_API || 'http://127.0.0.1:8000';
const python = process.env.WUMA_PYTHON || path.resolve('backend/.venv/Scripts/python.exe');
let accountToken;
const fixture = [
  ['P01', 'P19'], ['P05', 'P01'], ['P16', 'P18'], ['P01', 'P07'],
  ['P18', 'P13'], ['P07', 'P03'], ['P11', 'P17'], ['P10', 'P07'],
  ['P06', 'P11'], ['P15', 'P14'], ['P17', 'P22'], ['P14', 'P04'],
  ['P19', 'P23'], ['P20', 'P17'],
];

async function api(method, route, body) {
  const response = await fetch(`${apiBase}${route}`, { method,
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${accountToken}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(120000) });
  const envelope = await response.json();
  assert.equal(response.status, 200, `${method} ${route}: ${JSON.stringify(envelope)}`);
  assert.equal(envelope.code, 0);
  return envelope.data;
}

function database(gameId) {
  assert.ok(process.env.WUMA_TEST_DATABASE_URL, 'isolated MySQL URL required');
  return JSON.parse(execFileSync(python,
    [path.resolve('scripts/phase24_training_db_probe.py'), gameId],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 15000 }));
}

async function until(page, predicate, label, ms = 30000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const data = await page.data();
    if (data.errorMessage || data.trainingError) {
      throw new Error(`${label}: ${data.errorMessage || data.trainingError}`);
    }
    if (predicate(data)) return data;
    await page.waitFor(250);
  }
  throw new Error(`${label} timed out`);
}

async function chooseMove(page, move) {
  const board = await page.$('chess-board');
  assert.ok(board, 'historical chess board missing');
  const from = await board.$(`.piece-position[data-id="${move.from}"]`);
  assert.ok(from, `source piece ${move.from} missing`);
  await from.tap();
  const selected = await until(page, value => value.selectedNode === move.from &&
    !value.isLoadingLegalMoves, 'legal moves');
  assert.ok(selected.legalTargets.includes(move.to), `${move.from}→${move.to} is not highlighted`);
  const target = await board.$(`.node-hit[data-id="${move.to}"]`);
  assert.ok(target, `target ${move.to} missing`);
  await target.tap();
  return until(page, value => Boolean(value.answer) && !value.isSubmittingAnswer,
    'engine grading', 60000);
}

async function main() {
  const mini = await automator.connect({ wsEndpoint: endpoint });
  try {
    accountToken = await createDeviceAccount(apiBase);
    await seedMiniAccount(mini, apiBase, accountToken);
    const game = await api('POST', '/api/v1/game', { first_player: 'A', mode: 'LOCAL' });
    const gameId = game.game_id;
    for (const [from, to] of fixture) {
      await api('POST', `/api/v1/game/${gameId}/move`, { from_node: from, to_node: to });
    }
    const finished = await api('GET', `/api/v1/game/${gameId}`);
    assert.equal(finished.state.game_status, 'FINISHED');
    assert.equal(finished.version, fixture.length);
    const before = database(gameId);
    assert.equal(before.game_review_count, 0);
    assert.equal(before.training_items_count, 0);

    const reviewPage = await mini.reLaunch(`/pages/review/review?gameId=${gameId}`);
    const reviewData = await until(reviewPage,
      value => value.state === 'success' && value.review?.gameId === gameId,
      'real review', 120000);
    const review = reviewData.review;
    assert.ok(review.moveReviews.some(row => row.category === 'BLUNDER'));
    const generateButton = await reviewPage.$('#generate-training');
    assert.ok(generateButton, 'review-to-training action missing');
    await generateButton.tap();
    let trainingPage;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      trainingPage = await mini.currentPage();
      if (trainingPage?.path === 'pages/training/training') break;
      await reviewPage.waitFor(250);
    }
    assert.equal(trainingPage?.path, 'pages/training/training');
    const generated = await api('POST', `/api/v1/game/${gameId}/training`, {});
    assert.ok(generated.items.length > 0);
    const item = generated.items.find(row => row.sourceTurn === 1) || generated.items[0];
    const source = review.moveReviews.find(row => row.turn === item.sourceTurn);
    assert.ok(source);
    assert.ok(source.scoreLoss > 0);
    const listed = await until(trainingPage,
      value => value.items.some(row => row.id === item.id), 'training list');
    assert.ok(listed.items.length > 0);
    const row = await trainingPage.$(`.training-item[data-id="${item.id}"]`);
    assert.ok(row, 'generated question absent from training page');
    await row.tap();
    let data = await until(trainingPage,
      value => value.question?.id === item.id && !value.isLoading, 'question');
    assert.equal(data.answer, null);
    for (const field of ['bestMove', 'bestScore', 'originalMove', 'sourceGameId']) {
      assert.equal(Object.hasOwn(data.question, field), false, `public question leaked ${field}`);
    }
    assert.deepEqual(data.question.stateSnapshot, item.stateSnapshot);
    const beforeBoard = JSON.stringify(data.board.pieces);
    const heading = await trainingPage.$('.challenge-heading');
    const headingText = await heading.text();
    assert.ok(headingText.includes(`第 ${item.sourceTurn} 手`));
    assert.ok(!headingText.includes(source.bestMove.from + ' → ' + source.bestMove.to));

    data = await chooseMove(trainingPage, source.bestMove);
    const correct = data.answer;
    assert.equal(correct.result, 'CORRECT');
    assert.equal(correct.bestMoveEquivalent, true);
    assert.equal(correct.scoreLoss, 0);
    assert.equal(correct.searchDepth, source.searchDepth);
    assert.ok((await (await trainingPage.$('.training-result')).text()).includes('达到最佳评分'));
    let db = database(gameId);
    assert.equal(db.training_records_count, 1);
    assert.equal(db.records[0].result, 'CORRECT');
    assert.deepEqual(db.current_state, before.current_state);
    assert.equal(db.version, before.version);

    await (await trainingPage.$('.training-actions button')).tap();
    data = await until(trainingPage,
      value => value.question?.id === item.id && !value.isLoading && !value.answer,
      'retry question');
    assert.equal(JSON.stringify(data.board.pieces), beforeBoard);
    data = await chooseMove(trainingPage, source.actualMove);
    const suboptimal = data.answer;
    assert.equal(suboptimal.result, 'SUBOPTIMAL');
    assert.equal(suboptimal.bestMoveEquivalent, false);
    assert.ok(suboptimal.scoreLoss > 0);
    assert.ok((await (await trainingPage.$('.training-result')).text()).includes('还有更优走法'));
    db = database(gameId);
    assert.equal(db.training_items_count, generated.items.length);
    assert.equal(db.training_records_count, 2);
    assert.ok(db.items.every(row => row.stateMatchesMove && row.reviewRowExists));
    assert.deepEqual(new Set(db.records.map(row => row.result)), new Set(['CORRECT', 'SUBOPTIMAL']));
    assert.equal(new Set(db.records.map(row => row.clientAttemptId)).size, 2);
    assert.deepEqual(db.current_state, before.current_state);
    assert.equal(db.version, before.version);
    assert.equal(db.game_moves_count, before.game_moves_count);
    assert.deepEqual((await api('GET', `/api/v1/game/${gameId}`)).state, finished.state);
    console.log(JSON.stringify({ finishedGame: gameId, reviewGenerated: review.id,
      trainingGenerated: generated.items.length, trainingPage: trainingPage.path,
      questionLoaded: item.id, sourceTurn: item.sourceTurn, sourceCategory: item.sourceCategory,
      player: item.player, correct, suboptimal, databaseRecords: db.training_records_count,
      sourceGameUnchanged: true }));
  } finally {
    mini.disconnect();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
