/** Real WeChat simulator → FastAPI → MySQL → Node worker → Phase 15 AI. */
const assert = require('node:assert/strict');
const automator = require('miniprogram-automator');

// Start the IDE first: cli.bat auto --project <repo> --auto-port 9420 --trust-project
const endpoint = process.env.WUMA_WECHAT_AUTO_ENDPOINT || 'ws://127.0.0.1:9420';
const storageKey = 'activeAiGameId';

function timed(promise, label, ms = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    Promise.resolve(promise).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

async function until(page, predicate, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const data = await timed(page.data(), `${label} page data`, 10000);
    if (predicate(data)) return data;
    await page.waitFor(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function openAi(mini, first = 'human') {
  const route = `/pages/game/game?mode=ai&first=${first}`;
  const page = await timed(mini.reLaunch(route), `open ${route}`);
  if (!page) throw new Error('AI game page did not open');
  return page;
}

async function tapHumanMove(page, preferredFrom, preferredTo) {
  let data = await page.data();
  assert.equal(data.aiState.gameState.current_player, data.aiState.humanPlayer);
  const beforeState = JSON.stringify(data.aiState.gameState);
  const previousAi = data.aiState.lastMove;
  const board = await page.$('chess-board');
  if (!board) throw new Error('Existing ChessBoard component is missing');
  const candidates = preferredFrom
    ? [preferredFrom]
    : data.board.pieces.filter(piece =>
      data.aiState.gameState.board.occupancy[piece.nodeId] === data.aiState.humanPlayer)
      .map(piece => piece.nodeId);
  let from;
  let to;
  for (const candidate of candidates) {
    const piece = await board.$(`.piece-position[data-id="${candidate}"]`);
    if (!piece) continue;
    await piece.tap();
    data = await until(page, value => value.aiState.selectedNode === candidate &&
      !value.aiState.isLoadingLegalMoves, `legal moves for ${candidate}`);
    const targets = data.aiState.legalTargets;
    if (targets.length && (!preferredTo || targets.includes(preferredTo))) {
      from = candidate;
      to = preferredTo || targets[0];
      break;
    }
  }
  if (!from || !to) throw new Error('No human move available in simulator');
  const target = await board.$(`.node-hit[data-id="${to}"]`);
  if (!target) throw new Error(`Target ${to} is missing`);
  await target.tap();
  data = await until(page, value => {
    const snap = value.aiState;
    if (!snap?.gameState || JSON.stringify(snap.gameState) === beforeState) return false;
    if (snap.gameState.game_status === 'FINISHED') return true;
    return snap.gameState.current_player === snap.humanPlayer && !snap.isAiThinking &&
      snap.lastMove && (!previousAi ||
        snap.lastMove.from !== previousAi.from || snap.lastMove.to !== previousAi.to);
  }, `human ${from}->${to} and AI reply`);
  assert.equal(data.aiState.gameState.game_status, 'PLAYING', 'Opening E2E must stay playable');
  assert.equal(data.aiState.gameState.current_player, data.aiState.humanPlayer);
  assert.ok(data.aiState.lastSearch);
  return { human: `${from}->${to}`, ai: `${data.aiState.lastMove.from}->${data.aiState.lastMove.to}`,
    data };
}

async function main() {
  console.log(`CONNECT ${endpoint}`);
  const mini = await timed(automator.connect({ wsEndpoint: endpoint }), 'automation connection', 15000);
  let previousId;
  let storagePrepared = false;
  try {
    console.log((await timed(mini.pageStack(), 'page stack')).map(page => page.path));
    previousId = await timed(mini.callWxMethod('getStorageSync', storageKey), 'read stored AI ID');
    await timed(mini.callWxMethod('removeStorageSync', storageKey), 'clear stored AI ID');
    storagePrepared = true;

    let page = await openAi(mini);
    let data = await until(page, value => value.aiReady && value.aiState?.gameId &&
      value.aiState.gameState.current_player === 'A', 'human-first AI game');
    const humanGameId = data.aiState.gameId;
    assert.equal(data.aiState.aiPlayer, 'B');
    assert.equal(data.board.pieces.length, 10);
    console.log(`HUMAN_FIRST CREATE ${humanGameId}`);
    const first = await tapHumanMove(page, 'P01', 'P02');
    console.log(`ROUND_1 human=${first.human} ai=${first.ai}`);
    const second = await tapHumanMove(page);
    console.log(`ROUND_2 human=${second.human} ai=${second.ai}`);
    const afterTwo = JSON.stringify(second.data.aiState.gameState);

    await mini.reLaunch('/pages/index/index');
    page = await openAi(mini);
    data = await until(page, value => value.aiReady && value.aiState?.gameId === humanGameId &&
      JSON.stringify(value.aiState.gameState) === afterTwo,
    'restored human turn from MySQL');
    assert.equal(data.aiState.gameState.current_player, 'A');
    console.log(`RESTORE ${humanGameId} current=A`);
    const continued = await tapHumanMove(page);
    console.log(`CONTINUE human=${continued.human} ai=${continued.ai}`);

    await timed(mini.callWxMethod('removeStorageSync', storageKey), 'clear AI ID for first-move test');
    page = await openAi(mini, 'ai');
    data = await until(page, value => value.aiReady && value.aiState?.gameId &&
      value.aiState.gameId !== humanGameId && value.aiState.lastSearch &&
      value.aiState.gameState.current_player === 'A' && !value.aiState.isAiThinking,
    'AI first search and move');
    const aiFirstGameId = data.aiState.gameId;
    const aiFirstMove = `${data.aiState.lastMove.from}->${data.aiState.lastMove.to}`;
    assert.equal(data.aiState.gameState.first_player, 'B');
    const response = await tapHumanMove(page);
    console.log(`AI_FIRST game_id=${aiFirstGameId} ai=${aiFirstMove} human=${response.human} next_ai=${response.ai}`);
    console.log(`RESULT human_game_id=${humanGameId} ai_first_game_id=${aiFirstGameId} passed=true`);
  } finally {
    try {
      if (storagePrepared) {
        if (previousId) await timed(mini.callWxMethod('setStorageSync', storageKey, previousId), 'restore stored AI ID', 5000);
        else await timed(mini.callWxMethod('removeStorageSync', storageKey), 'clear test AI ID', 5000);
      }
    } finally { mini.disconnect(); }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
