/** Real WeChat developer-tool simulator check. Requires FastAPI/MySQL and CLI automation. */
const assert = require('node:assert/strict');
const automator = require('miniprogram-automator');

// Start the IDE first: cli.bat auto --project <repo> --auto-port 9420 --trust-project
const endpoint = process.env.WUMA_WECHAT_AUTO_ENDPOINT || 'ws://127.0.0.1:9420';

function timed(promise, label, ms = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    Promise.resolve(promise).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

async function until(page, predicate, label) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const data = await page.data();
    if (predicate(data)) return data;
    await page.waitFor(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  console.log(`CONNECT ${endpoint}`);
  const mini = await timed(automator.connect({ wsEndpoint: endpoint }), 'automation connection', 15000);
  console.log('CONNECTED');
  mini.on('exception', entry => console.log('DEVEXCEPTION', JSON.stringify(entry).slice(0, 600)));
  let previousGameId;
  let storagePrepared = false;
  try {
    console.log('PAGE STACK');
    console.log((await timed(mini.pageStack(), 'page stack')).map(page => page.path));
    previousGameId = await timed(mini.callWxMethod('getStorageSync', 'activeRemoteGameId'), 'read stored ID');
    await timed(mini.callWxMethod('removeStorageSync', 'activeRemoteGameId'), 'clear stored ID');
    storagePrepared = true;
    console.log('OPEN remote page');
    let page = await timed(mini.reLaunch('/pages/game/game?mode=remote'), 'open remote page', 30000);
    if (!page) throw new Error('Remote game page did not open');
    let data = await until(page, value => value.remoteReady && value.remoteState?.gameId,
      'remote game creation');
    const gameId = data.remoteState.gameId;
    assert.equal(data.mode, 'remote');
    assert.equal(data.board.pieces.length, 10);
    console.log(`CREATE ${gameId} current=${data.remoteView.currentPlayer}`);

    const board = await page.$('chess-board');
    if (!board) throw new Error('Existing ChessBoard component is missing');
    const piece = await board.$('.piece-position[data-id="P01"]');
    if (!piece) throw new Error('P01 piece is missing');
    await piece.tap();
    data = await until(page, value => value.board.nodes.some(node => node.id === 'P02' && node.legalTarget),
      'server legal target');
    console.log(`LEGAL ${data.remoteState.legalTargets.join(',')}`);

    const target = await board.$('.node-hit[data-id="P02"]');
    if (!target) throw new Error('P02 board target is missing');
    await target.tap();
    data = await until(page, value => value.remoteState?.gameState?.board?.occupancy?.P02 === 'A' &&
      value.remoteView?.currentPlayer === 'B', 'server accepted move');
    console.log(`MOVE P01->P02 current=${data.remoteView.currentPlayer}`);

    await mini.reLaunch('/pages/index/index');
    page = await mini.reLaunch('/pages/game/game?mode=remote');
    if (!page) throw new Error('Remote game page did not reopen');
    data = await until(page, value => value.remoteReady && value.remoteState?.gameId === gameId &&
      value.remoteState?.gameState?.board?.occupancy?.P02 === 'A', 'database-backed restore');
    console.log(`RESTORE ${data.remoteState.gameId} current=${data.remoteView.currentPlayer}`);

    const secondBoard = await page.$('chess-board');
    const secondPiece = await secondBoard?.$('.piece-position[data-id="P05"]');
    if (!secondPiece) throw new Error('P05 piece is missing after restore');
    await secondPiece.tap();
    data = await until(page, value => value.remoteState?.legalTargets?.includes('P04'),
      'B legal target after restore');
    const secondTarget = await secondBoard.$('.node-hit[data-id="P04"]');
    if (!secondTarget) throw new Error('P04 board target is missing');
    await secondTarget.tap();
    data = await until(page, value => value.remoteState?.gameState?.board?.occupancy?.P04 === 'B' &&
      value.remoteView?.currentPlayer === 'A', 'continued move after restore');
    console.log(`CONTINUE P05->P04 current=${data.remoteView.currentPlayer}`);
    console.log(`RESULT game_id=${gameId} two_moves=true`);
  } finally {
    try {
      if (storagePrepared) {
        if (previousGameId) await timed(mini.callWxMethod('setStorageSync', 'activeRemoteGameId', previousGameId), 'restore stored ID', 5000);
        else await timed(mini.callWxMethod('removeStorageSync', 'activeRemoteGameId'), 'clear test ID', 5000);
      }
    } finally { mini.disconnect(); }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
