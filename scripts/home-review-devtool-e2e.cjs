/** Real local terminal must not appear as reviewable through the home card. */
const assert = require('node:assert/strict');
const automator = require('miniprogram-automator');

const endpoint = process.env.WUMA_WECHAT_AUTO_ENDPOINT || 'ws://127.0.0.1:9420';
const keys = ['wuma:history:v1', 'activeLocalGameId',
  'activeAiGameId', 'activeRemoteGameId'];
const fixture = [
  ['P01', 'P19'], ['P05', 'P01'], ['P16', 'P18'], ['P01', 'P07'],
  ['P18', 'P13'], ['P07', 'P03'], ['P11', 'P17'], ['P10', 'P07'],
  ['P06', 'P11'], ['P15', 'P14'], ['P17', 'P22'], ['P14', 'P04'],
  ['P19', 'P23'], ['P20', 'P17'],
];

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
  for (let attempt = 0; attempt < 60; attempt++) {
    const data = await timed(page.data(), `${label} page data`);
    if (data.state === 'error') throw new Error(`${label}: ${data.errorMessage}`);
    if (predicate(data)) return data;
    await page.waitFor(250);
  }
  throw new Error(`${label} timed out`);
}

async function main() {
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

    let page = await timed(mini.reLaunch('/pages/game/game?mode=local'),
      'start local game');
    let data = await until(page, value => value.localGameId && value.localSession,
      'local game');
    const gameId = data.localGameId;
    for (const [index, [from, to]] of fixture.entries()) {
      const board = await page.$('chess-board');
      assert.ok(board, 'local chess board is missing');
      const piece = await board.$(`.piece-position[data-id="${from}"]`);
      const target = await board.$(`.node-hit[data-id="${to}"]`);
      assert.ok(piece && target, `move ${index + 1} nodes are missing`);
      await piece.tap();
      await target.tap();
      data = await until(page, value => value.localTurns === index + 1,
        `move ${index + 1}`);
    }
    assert.equal(data.localSession.gameState.game_status, 'FINISHED');

    page = await timed(mini.reLaunch('/pages/history/history'), 'open all history');
    data = await until(page, value => value.state === 'success' &&
      value.records.some(row => row.id === gameId && row.status === 'FINISHED'),
    'real finished local history');
    assert.equal(data.records.find(row => row.id === gameId).action, '查看终局');

    page = await timed(mini.reLaunch('/pages/index/index'), 'open home');
    const card = await page.$('#feature-review');
    assert.ok(card, 'home review card is missing');
    const trigger = await card.$('.feature');
    assert.ok(trigger, 'home review card tap target is missing');
    await trigger.tap();
    for (let attempt = 0; attempt < 40; attempt++) {
      const current = await timed(mini.currentPage(), 'navigate from home review card');
      if (current?.path === 'pages/history/history') { page = current; break; }
      await page.waitFor(250);
    }
    assert.equal(page.path, 'pages/history/history');
    data = await until(page, value => value.filter === 'reviewable' &&
      value.state === 'empty', 'reviewable empty state');
    assert.equal(data.records.length, 0);
    assert.equal(data.emptyTitle, '还没有可复盘的棋局');
    assert.equal(data.emptyAction, '开始 AI 对弈');
    console.log(`RESULT home-review=PASS local_finished_id=${gameId} turns=${fixture.length} reviewable=0`);
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
