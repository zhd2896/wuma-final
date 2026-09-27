/** Real AI game → three no-key Coach hints → independent human move → AI response. */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const automator = require('miniprogram-automator');

const endpoint = process.env.WUMA_WECHAT_AUTO_ENDPOINT || 'ws://127.0.0.1:9420';
const apiBase = process.env.WUMA_COACH_E2E_API || 'http://127.0.0.1:8000';
const python = process.env.WUMA_PYTHON || path.resolve('backend/.venv/Scripts/python.exe');
const storageKey = 'activeAiGameId';

function timed(promise, label, ms = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); });
  });
}

async function until(page, predicate, label, ms = 30000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const data = await timed(page.data(), `${label} page data`, 10000);
    if (data.aiState?.errorMessage) throw new Error(`${label}: ${data.aiState.errorMessage}`);
    if (predicate(data)) return data;
    await page.waitFor(250);
  }
  throw new Error(`${label} timed out`);
}

async function api(method, route, body) {
  const response = await fetch(`${apiBase}${route}`, { method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(50000) });
  const envelope = await response.json();
  assert.equal(response.status, 200, `${method} ${route}: ${JSON.stringify(envelope)}`);
  return envelope.data;
}

function database(gameId) {
  assert.ok(process.env.WUMA_TEST_DATABASE_URL, 'isolated MySQL URL required');
  return JSON.parse(execFileSync(python,
    [path.resolve('scripts/phase23_coach_db_probe.py'), gameId],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 15000 }));
}

async function main() {
  const mini = await timed(automator.connect({ wsEndpoint: endpoint }),
    'DevTools connection', 15000);
  let saved;
  try {
    saved = await mini.callWxMethod('getStorageSync', storageKey);
    await mini.callWxMethod('removeStorageSync', storageKey);
    const page = await timed(mini.reLaunch('/pages/game/game?mode=ai&first=human'),
      'AI page', 15000);
    let data = await until(page, value => value.aiReady && value.aiState?.gameId &&
      value.aiState.gameState.current_player === value.aiState.humanPlayer, 'human turn');
    const gameId = data.aiState.gameId;
    const before = database(gameId);
    const boardBefore = JSON.stringify(data.board.pieces);
    const analyzed = await api('POST', '/api/v1/ai/analyze',
      { game_id: gameId, expected_version: 0 });
    const bestText = `${analyzed.bestMove.from} → ${analyzed.bestMove.to}`;
    const hintButton = await page.$('#action-hint');
    assert.ok(hintButton, 'Coach entry missing');
    await hintButton.tap();
    data = await until(page, value => value.aiState.coachHint?.level === 1 &&
      !value.aiState.isCoachLoading, 'level 1');
    const one = data.aiState.coachHint;
    assert.equal(one.bestMove, null);
    assert.deepEqual(one.candidateFromNodes, []);
    assert.doesNotMatch(one.hintText, /P\d{2}/);
    const levelOneCard = await page.$('.coach-card');
    const levelOneText = await levelOneCard.text();
    assert.ok(levelOneText.includes(one.hintText));
    assert.doesNotMatch(levelOneText, /P\d{2}/);
    assert.ok(!levelOneText.includes(bestText));
    assert.equal(database(gameId).version, before.version);

    let more = await page.$('#coach-more');
    assert.ok(more);
    await more.tap();
    data = await until(page, value => value.aiState.coachHint?.level === 2 &&
      !value.aiState.isCoachLoading, 'level 2');
    const two = data.aiState.coachHint;
    assert.equal(two.bestMove, null);
    assert.ok(two.candidateFromNodes.length > 0 && two.candidateFromNodes.length <= 3);
    assert.doesNotMatch(two.hintText, /P\d{2}\s*(?:→|->|到|至)\s*P\d{2}/);
    const levelTwoText = await (await page.$('.coach-card')).text();
    assert.ok(levelTwoText.includes(two.hintText));
    assert.ok(!levelTwoText.includes(bestText));
    assert.ok(!levelTwoText.includes(analyzed.bestMove.to));

    more = await page.$('#coach-more');
    await more.tap();
    data = await until(page, value => value.aiState.coachHint?.level === 3 &&
      !value.aiState.isCoachLoading, 'level 3');
    const three = data.aiState.coachHint;
    assert.ok(three.bestMove);
    assert.equal(three.fallbackUsed, true);
    assert.deepEqual([one.fallbackUsed, two.fallbackUsed, three.fallbackUsed], [true, true, true]);
    assert.equal(new Set([one.hintText, two.hintText, three.hintText]).size, 3);
    const shown = await page.$('.coach-card');
    assert.ok((await shown.text()).includes(`${three.bestMove.from} → ${three.bestMove.to}`));
    const afterHints = database(gameId);
    assert.deepEqual(afterHints.current_state, before.current_state);
    assert.equal(afterHints.version, before.version);
    assert.equal(afterHints.game_moves_count, before.game_moves_count);
    assert.deepEqual(afterHints.hint_levels, [1, 2, 3]);
    assert.deepEqual(afterHints.fallback_used, [true, true, true]);
    assert.equal(JSON.stringify(data.board.pieces), boardBefore);
    assert.deepEqual(afterHints.best_moves, [null, null, three.bestMove]);

    assert.deepEqual(three.bestMove, analyzed.bestMove);
    const duplicate = await api('POST', `/api/v1/game/${gameId}/coach/hint`,
      { level: 3, expected_version: 0 });
    assert.deepEqual(duplicate, three);
    assert.deepEqual(database(gameId).hint_levels, [1, 2, 3]);

    const board = await page.$('chess-board');
    await (await board.$('.piece-position[data-id="P01"]')).tap();
    data = await until(page, value => value.aiState.selectedNode === 'P01' &&
      !value.aiState.isLoadingLegalMoves, 'selected human piece');
    assert.ok(data.aiState.legalTargets.includes('P02'));
    await (await board.$('.node-hit[data-id="P02"]')).tap();
    data = await until(page, value => value.aiState.gameVersion === 2 &&
      !value.aiState.isAiThinking && value.aiState.gameState.current_player === 'A',
    'human move and AI reply', 40000);
    assert.equal(data.aiState.coachHint, null);
    assert.equal(await page.$('.coach-card'), null);
    const afterMove = database(gameId);
    assert.equal(afterMove.version, 2);
    assert.equal(afterMove.game_moves_count, 2);
    assert.deepEqual(afterMove.hint_levels, [1, 2, 3]);
    console.log(JSON.stringify({ gameId, gameVersion: before.version, analyzedPlayer: 'A',
      bestMove: three.bestMove, level1: one.hintText, level2: two.hintText,
      level3: three.hintText, humanTurn: true, boardUnchanged: true,
      humanMove: 'P01→P02', aiMove: data.aiState.lastMove,
      oldHintCleared: true, fallbackUsed: true, persistedLevels: afterHints.hint_levels }));
  } finally {
    try {
      if (saved) await mini.callWxMethod('setStorageSync', storageKey, saved);
      else await mini.callWxMethod('removeStorageSync', storageKey);
    } finally { mini.disconnect(); }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
