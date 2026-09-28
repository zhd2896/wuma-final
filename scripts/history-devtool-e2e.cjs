/** Device-local history: real WeChat page, legal local move, record and resume. */
const assert = require('node:assert/strict');
const automator = require('miniprogram-automator');

const endpoint = process.env.WUMA_WECHAT_AUTO_ENDPOINT || 'ws://127.0.0.1:9420';
const keys = ['wuma:history:v1', 'activeLocalGameId',
  'activeAiGameId', 'activeRemoteGameId'];

function timed(promise, label, ms = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    Promise.resolve(promise).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

async function until(page, predicate, label) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const data = await timed(page.data(), `${label} page data`);
    if (data.state === 'error') throw new Error(`${label}: ${data.errorMessage}`);
    if (predicate(data)) return data;
    await page.waitFor(250);
  }
  throw new Error(`${label} timed out`);
}

async function main() {
  console.log(`[1] Connecting DevTools ${endpoint}`);
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
    console.log('[2] Empty history');
    let page = await timed(mini.reLaunch('/pages/history/history'), 'open history');
    await until(page, data => data.state === 'empty' && data.records.length === 0,
      'empty history');

    console.log('[3] Creating a real local game and making one legal move');
    page = await timed(mini.reLaunch('/pages/game/game?mode=local'), 'open local game');
    let data = await until(page, value => value.localGameId && value.localSession,
      'local game creation');
    const gameId = data.localGameId;
    const board = await page.$('chess-board');
    assert.ok(board, 'ChessBoard is missing');
    const piece = await board.$('.piece-position[data-id="P01"]');
    assert.ok(piece, 'P01 piece is missing');
    await piece.tap();
    const target = await board.$('.node-hit[data-id="P02"]');
    assert.ok(target, 'P02 target is missing');
    await target.tap();
    data = await until(page, value => value.localTurns === 1 &&
      value.localSession?.gameState?.board?.occupancy?.P02 === 'A', 'legal local move');

    console.log('[4] Checking the actual history list');
    page = await timed(mini.reLaunch('/pages/history/history'), 'reopen history');
    data = await until(page, value => value.state === 'success' &&
      value.records.some(row => row.id === gameId && row.turns === 1),
    'saved history record');
    const row = await page.$(`.record[data-id="${gameId}"]`);
    assert.ok(row, 'History record not rendered');
    assert.ok((await row.text()).includes('继续对弈'));

    console.log('[5] Resuming the exact saved game');
    await row.tap();
    for (let attempt = 0; attempt < 40; attempt++) {
      const current = await timed(mini.currentPage(), 'open saved game');
      if (current?.path === 'pages/game/game') { page = current; break; }
      await page.waitFor(250);
    }
    assert.equal(page?.path, 'pages/game/game');
    data = await until(page, value => value.localGameId === gameId &&
      value.localSession?.gameState?.board?.occupancy?.P02 === 'A', 'saved game restore');
    assert.equal(data.localSession.gameState.current_player, 'B');
    console.log(`RESULT history=PASS mode=local game_id=${gameId} turns=1`);
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
