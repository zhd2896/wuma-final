/** Real AI game → independent Coach page → three version-bound hint levels. */
const assert = require('node:assert/strict');
const automator = require('miniprogram-automator');

const endpoint = process.env.WUMA_WECHAT_AUTO_ENDPOINT || 'ws://127.0.0.1:9420';
const storageKey = 'activeAiGameId';

function timed(promise, label, ms = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    Promise.resolve(promise).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(new Error(`${label}: ${error.message}`, { cause: error })); },
    );
  });
}

async function until(page, predicate, label, ms = 70000) {
  const deadline = Date.now() + ms;
  let last;
  while (Date.now() < deadline) {
    const data = await timed(page.data(), `${label} page data`, 10000);
    last = data;
    if (data.state === 'error') throw new Error(`${label}: ${data.errorMessage}`);
    if (data.aiState?.errorMessage) throw new Error(`${label}: ${data.aiState.errorMessage}`);
    if (predicate(data)) return data;
    await page.waitFor(250);
  }
  throw new Error(`${label} timed out: ${JSON.stringify({
    state: last?.state, gameId: last?.gameId, gameVersion: last?.gameVersion,
    notice: last?.notice, errorMessage: last?.errorMessage,
  })}`);
}

async function tapLevel(page, index) {
  const cards = await page.$$('coach-card');
  assert.equal(cards.length, 3, 'three coach cards must be rendered');
  const card = await cards[index].$('.card');
  assert.ok(card, `coach level ${index + 1} card body missing`);
  await card.tap();
}

async function main() {
  const mini = await timed(automator.connect({ wsEndpoint: endpoint }),
    'DevTools connection', 15000);
  let saved;
  try {
    saved = await timed(mini.callWxMethod('getStorageSync', storageKey), 'read active AI game');
    await timed(mini.callWxMethod('removeStorageSync', storageKey), 'clear active AI game');
    let page = await timed(mini.reLaunch('/pages/game/game?mode=ai&first=human'),
      'open fresh AI game', 15000);
    let data = await until(page, value => value.aiReady && value.aiState?.gameId &&
      value.aiState.gameState.current_player === value.aiState.humanPlayer, 'human turn');
    const gameId = data.aiState.gameId;
    const version = data.aiState.gameVersion;
    const expectedPieces = data.board.pieces.length;
    assert.equal(await timed(mini.callWxMethod('getStorageSync', storageKey),
      'verify active AI game'), gameId);

    page = await timed(mini.reLaunch('/pages/coach/coach'), 'open independent coach', 15000);
    data = await until(page, value => value.state === 'ready' && value.gameId === gameId,
      'authoritative coach game');
    assert.equal(data.gameVersion, version);
    assert.equal(data.currentPlayer, data.humanPlayer);
    assert.equal(data.board.pieces.length, expectedPieces);
    assert.deepEqual(data.hints, []);
    assert.equal(data.cards[0].locked, false);
    assert.equal(data.cards[1].locked, true);

    await tapLevel(page, 0);
    data = await until(page, value => value.hints?.length === 1 && !value.loadingLevel,
      'coach level 1');
    assert.equal(data.hints[0].level, 1);
    assert.ok(data.hints[0].hintText);
    assert.equal(data.cards[1].locked, false);

    await tapLevel(page, 1);
    data = await until(page, value => value.hints?.length === 2 && !value.loadingLevel,
      'coach level 2');
    assert.equal(data.hints[1].level, 2);
    assert.ok(data.hints[1].candidateFromNodes.length > 0);
    assert.equal(data.cards[2].locked, false);

    await tapLevel(page, 2);
    data = await until(page, value => value.hints?.length === 3 && !value.loadingLevel,
      'coach level 3');
    assert.equal(data.hints[2].level, 3);
    assert.ok(data.hints[2].bestMove);
    assert.ok(data.cards[2].detail.includes(
      `${data.hints[2].bestMove.from} → ${data.hints[2].bestMove.to}`));
    const pageText = await page.$('.coach-page');
    assert.doesNotMatch(await pageText.text(), /UI 演示|演示提示|演示讲解/);

    console.log(`RESULT independent-coach=PASS game_id=${gameId} version=${version} levels=1,2,3 best_move=${data.hints[2].bestMove.from}->${data.hints[2].bestMove.to}`);
  } finally {
    try {
      if (saved === undefined || saved === null || saved === '') {
        await timed(mini.callWxMethod('removeStorageSync', storageKey), 'restore empty active AI game');
      } else {
        await timed(mini.callWxMethod('setStorageSync', storageKey, saved), 'restore active AI game');
      }
    } finally { mini.disconnect(); }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
