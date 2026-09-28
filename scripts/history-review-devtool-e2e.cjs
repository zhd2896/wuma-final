/** Finished MySQL game -> local history import -> real WeChat review page. */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const automator = require('miniprogram-automator');

const endpoint = process.env.WUMA_WECHAT_AUTO_ENDPOINT || 'ws://127.0.0.1:9420';
const apiBase = process.env.WUMA_REVIEW_E2E_API || 'http://127.0.0.1:8000';
const python = process.env.WUMA_PYTHON || path.resolve('backend/.venv/Scripts/python.exe');
const gameId = process.env.WUMA_HISTORY_E2E_GAME_ID;
const accountToken = process.env.WUMA_HISTORY_E2E_DEVICE_TOKEN;
const accountKey = `wuma:device-account-token:v1:${apiBase.replace(/\/$/, '')}`;
const keys = ['wuma:history:v1', 'activeLocalGameId',
  'activeAiGameId', 'activeRemoteGameId', accountKey];

function timed(promise, label, ms = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    Promise.resolve(promise).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

async function until(page, predicate, label, ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const data = await timed(page.data(), `${label} page data`);
    if (data.state === 'error') throw new Error(`${label}: ${data.errorMessage}`);
    if (predicate(data)) return data;
    await page.waitFor(250);
  }
  throw new Error(`${label} timed out after ${ms} ms`);
}

async function apiGame(id) {
  const response = await fetch(`${apiBase}/api/v1/game/${encodeURIComponent(id)}`,
    { headers: { Authorization: `Bearer ${accountToken}` },
      signal: AbortSignal.timeout(10000) });
  const envelope = await response.json();
  assert.equal(response.status, 200, 'fixture is unavailable from the configured API');
  assert.equal(envelope.code, 0);
  return envelope.data;
}

function database(id) {
  return JSON.parse(execFileSync(python,
    [path.resolve('scripts/phase21_review_db_probe.py'), id],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 15000 }));
}

async function main() {
  if (!process.env.WUMA_TEST_DATABASE_URL) {
    throw new Error('WUMA_TEST_DATABASE_URL must name an isolated MySQL *_test database');
  }
  if (!gameId) throw new Error('WUMA_HISTORY_E2E_GAME_ID must name a finished test game');
  if (!accountToken || !/^[0-9a-f]{64}$/.test(accountToken)) {
    throw new Error('WUMA_HISTORY_E2E_DEVICE_TOKEN must own the finished test game');
  }

  // Verify that the supplied API and independent test DB expose the same finished fixture
  // before asking the WeChat review page to generate any rows.
  const before = database(gameId);
  const game = await apiGame(gameId);
  assert.equal(game.game_id, gameId);
  assert.equal(game.state.game_status, 'FINISHED');
  assert.equal(game.version, before.version);
  assert.deepEqual(game.state, before.current_state);

  const mini = await timed(automator.connect({ wsEndpoint: endpoint }),
    'DevTools connection');
  const saved = new Map();
  let prepared = false;
  try {
    for (const key of keys) {
      saved.set(key, await timed(mini.callWxMethod('getStorageSync', key), `read ${key}`));
    }
    prepared = true;
    for (const key of keys) {
      await timed(mini.callWxMethod('removeStorageSync', key), `clear ${key}`);
    }
    await timed(mini.callWxMethod('setStorageSync', accountKey, accountToken),
      'set fixture device account');

    let page = await timed(mini.reLaunch('/pages/index/index'), 'open home');
    const reviewCard = await page.$('#feature-review');
    assert.ok(reviewCard, 'home review card is missing');
    const trigger = await reviewCard.$('.feature');
    assert.ok(trigger, 'home review card tap target is missing');
    await trigger.tap();
    for (let attempt = 0; attempt < 40; attempt++) {
      const current = await timed(mini.currentPage(), 'open reviewable history');
      if (current?.path === 'pages/history/history') { page = current; break; }
      await page.waitFor(250);
    }
    assert.equal(page.path, 'pages/history/history');
    const history = await until(page, data => data.state === 'success' &&
      data.records.some(row => row.id === gameId && row.status === 'FINISHED'),
    'finished personal history');
    assert.equal(history.filter, 'reviewable');
    const rowData = history.records.find(row => row.id === gameId);
    assert.equal(rowData.turns, before.version);
    assert.equal(rowData.action, '查看复盘');
    const row = await page.$(`.record[data-id="${gameId}"]`);
    assert.ok(row, 'finished game is not rendered in history');
    await row.tap();

    for (let attempt = 0; attempt < 40; attempt++) {
      const current = await timed(mini.currentPage(), 'open review');
      if (current?.path === 'pages/review/review') { page = current; break; }
      await page.waitFor(250);
    }
    assert.equal(page.path, 'pages/review/review');
    const reviewPage = await until(page, data => data.state === 'success' &&
      data.review?.gameId === gameId, 'finished review', 120000);
    assert.ok(reviewPage.rows.length > 0, 'review moves were not rendered');
    const after = database(gameId);
    assert.equal(after.game_review_count, 1);
    assert.equal(after.game_moves_count, before.game_moves_count);
    assert.deepEqual(after.current_state, before.current_state);
    console.log(`RESULT history-review=PASS game_id=${gameId} turns=${rowData.turns} review_rows=${reviewPage.rows.length}`);
  } finally {
    try {
      if (prepared) {
        for (const key of keys) {
          const value = saved.get(key);
          if (value === undefined || value === null || value === '') {
            await timed(mini.callWxMethod('removeStorageSync', key), `restore empty ${key}`);
          } else {
            await timed(mini.callWxMethod('setStorageSync', key, value), `restore ${key}`);
          }
        }
      }
    } finally { mini.disconnect(); }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
