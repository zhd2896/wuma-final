/** Real WeChat pages: local offline analysis and versioned server analysis. */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const automator = require('miniprogram-automator');

const endpoint = process.env.WUMA_WECHAT_AUTO_ENDPOINT || 'ws://127.0.0.1:9420';
const keys = ['wuma:history:v1', 'activeLocalGameId', 'activeRemoteGameId'];

function timed(promise, label, ms = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    Promise.resolve(promise).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(new Error(`${label}: ${error.message}`, { cause: error })); },
    );
  });
}

async function until(page, predicate, label, ms = 60000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const data = await timed(page.data(), `${label} page data`, 10000);
    if (data.state === 'error' || data.state === 'conflict') {
      throw new Error(`${label}: ${data.errorMessage}`);
    }
    if (data.remoteState?.errorMessage) {
      throw new Error(`${label}: ${data.remoteState.errorMessage}`);
    }
    if (predicate(data)) return data;
    await page.waitFor(250);
  }
  throw new Error(`${label} timed out`);
}

async function waitForPath(mini, page, path, label) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const current = await timed(mini.currentPage(), label);
    if (current?.path === path) return current;
    await page.waitFor(250);
  }
  throw new Error(`${label} did not open ${path}`);
}

async function move(page, from, to, mode) {
  const board = await page.$('chess-board');
  assert.ok(board, `${mode} board missing`);
  const source = await board.$(`.piece-position[data-id="${from}"]`);
  const target = await board.$(`.node-hit[data-id="${to}"]`);
  assert.ok(source && target, `${mode} move ${from}->${to} nodes missing`);
  await source.tap();
  await target.tap();
}

async function openAnalysis(mini, page) {
  const action = await page.$('#action-analysis');
  assert.ok(action, 'analysis action missing');
  await action.tap();
  return waitForPath(mini, page, 'pages/analysis/analysis', 'open analysis');
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    const isolatedTargets = ['local', 'server'];
    for (const [index, isolatedTarget] of isolatedTargets.entries()) {
      execFileSync(process.execPath, [__filename, isolatedTarget],
        { cwd: process.cwd(), stdio: 'inherit' });
      if (index < isolatedTargets.length - 1) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 8000);
      }
    }
    return;
  }
  if (target !== 'local' && target !== 'server') {
    throw new Error(`Unknown target ${target}`);
  }
  const mini = await timed(automator.connect({ wsEndpoint: endpoint }),
    'DevTools connection', 15000);
  const saved = new Map();
  try {
    for (const key of keys) saved.set(key,
      await timed(mini.callWxMethod('getStorageSync', key), `read ${key}`));
    for (const key of keys) await timed(mini.callWxMethod('removeStorageSync', key),
      `clear ${key}`);
    await timed(mini.pageStack(), 'synchronize page stack');

    if (target === 'local') {
      let page = await timed(mini.reLaunch('/pages/game/game?mode=local'),
        'open local game');
      let data = await until(page, value => value.localGameId && value.localSession,
        'fresh local game');
      const localId = data.localGameId;
      await move(page, 'P01', 'P02', 'local');
      data = await until(page, value => value.localTurns === 1, 'local move');
      page = await openAnalysis(mini, page);
      data = await until(page, value => value.state === 'success' && value.view,
        'local analysis');
      assert.equal(data.gameId, localId);
      assert.equal(data.gameVersion, 1);
      assert.equal(data.view.board.pieces.find(piece => piece.nodeId === 'P02')?.side, 'black');
      assert.equal(data.view.breakdown.length, 7);
      assert.ok(data.view.keyPieces.length > 0);
      assert.ok(data.view.candidates.length > 0);
      console.log(`RESULT local-analysis=PASS game_id=${localId} turns=1 candidates=${data.view.candidates.length}`);
    } else {
      let page = await timed(mini.reLaunch('/pages/game/game?mode=remote'),
        'open server game');
      let data = await until(page, value => value.remoteReady && value.remoteState?.gameId,
        'fresh server game');
      const serverId = data.remoteState.gameId;
      await move(page, 'P01', 'P02', 'server');
      data = await until(page, value => value.remoteState?.gameVersion === 1 &&
        value.remoteState.gameState.current_player === 'B', 'server move');
      page = await openAnalysis(mini, page);
      data = await until(page, value => value.state === 'success' && value.view,
        'server analysis', 120000);
      assert.equal(data.gameId, serverId);
      assert.equal(data.gameVersion, 1);
      assert.equal(data.view.perspective, 'B');
      assert.equal(data.view.breakdown.length, 7);
      assert.ok(data.view.candidates.length > 0);
      console.log(`RESULT server-analysis=PASS game_id=${serverId} version=1 candidates=${data.view.candidates.length}`);
    }
  } finally {
    try {
      for (const key of keys) {
        const value = saved.get(key);
        if (value === undefined || value === null || value === '') {
          await timed(mini.callWxMethod('removeStorageSync', key), `restore empty ${key}`);
        } else {
          await timed(mini.callWxMethod('setStorageSync', key, value), `restore ${key}`);
        }
      }
    } finally { mini.disconnect(); }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
