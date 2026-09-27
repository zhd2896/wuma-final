/** Real WeChat simulator → FastAPI → MySQL → Node worker → position analysis. */
const assert = require('node:assert/strict');
const automator = require('miniprogram-automator');

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
  for (let attempt = 0; attempt < 120; attempt++) {
    const data = await timed(page.data(), `${label} page data`, 10000);
    if (predicate(data)) return data;
    await page.waitFor(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  console.log(`CONNECT ${endpoint}`);
  const mini = await timed(automator.connect({ wsEndpoint: endpoint }), 'automation connection', 15000);
  let saved;
  try {
    saved = await mini.callWxMethod('getStorageSync', storageKey);
    await mini.callWxMethod('removeStorageSync', storageKey);
    const page = await mini.reLaunch('/pages/game/game?mode=ai&first=human');
    let data = await until(page, value => value.aiReady && value.aiState?.gameId &&
      value.aiState.gameState.current_player === 'A', 'fresh AI game');
    const gameId = data.aiState.gameId;
    const before = JSON.stringify(data.aiState.gameState);
    const boardBefore = JSON.stringify(data.board.pieces);
    const analysisButton = await page.$('#action-analysis');
    assert.ok(analysisButton, 'analysis action missing');
    await analysisButton.tap();
    data = await until(page, value => value.aiState?.analysis && !value.aiState.isAnalyzing,
      'position analysis');
    const analysis = data.aiState.analysis;
    assert.equal(analysis.game_id, gameId);
    assert.equal(analysis.game_version, 0);
    assert.equal(analysis.analyzedPlayer, 'A');
    assert.equal(analysis.scorePerspective, 'A');
    assert.ok(analysis.candidateMoves.length >= 2);
    assert.equal(analysis.candidateMoves[0].score, analysis.bestScore);
    assert.deepEqual(analysis.bestMove, analysis.candidateMoves.find(item => item.isBest)?.move);
    assert.equal(JSON.stringify(data.aiState.gameState), before);
    assert.equal(JSON.stringify(data.board.pieces), boardBefore);
    assert.ok(data.aiAnalysisBreakdown.length >= 7);
    console.log(`ANALYSIS game_id=${gameId} player=${analysis.analyzedPlayer} static=${analysis.evaluationBefore.score} best=${analysis.bestMove.from}->${analysis.bestMove.to} candidates=${analysis.candidateMoves.length} depth=${analysis.searchDepth} nodes=${analysis.nodesSearched} ms=${analysis.thinkingTimeMs} ttHits=${analysis.ttHits} timedOut=${analysis.timedOut} board_unchanged=true`);

    const board = await page.$('chess-board');
    assert.ok(board);
    const source = await board.$('.piece-position[data-id="P01"]');
    assert.ok(source);
    await source.tap();
    data = await until(page, value => value.aiState?.selectedNode === 'P01' &&
      !value.aiState.isLoadingLegalMoves, 'legal moves after analysis');
    assert.ok(data.aiState.legalTargets.includes('P02'));
    const target = await board.$('.node-hit[data-id="P02"]');
    assert.ok(target);
    await target.tap();
    data = await until(page, value => value.aiState?.gameState.current_player === 'A' &&
      value.aiState.lastSearch && !value.aiState.isAiThinking &&
      JSON.stringify(value.aiState.gameState) !== before, 'human move and AI response');
    assert.equal(data.aiState.analysis, null);
    const moved = `${data.aiState.lastMove.from}->${data.aiState.lastMove.to}`;
    console.log(`CONTINUE human=P01->P02 ai=${moved} analysis_cleared=true`);

    await analysisButton.tap();
    data = await until(page, value => value.aiState?.analysis &&
      value.aiState.analysis.game_version === 2, 'version two analysis');
    assert.equal(data.aiState.analysis.analyzedPlayer, 'A');
    console.log(`REANALYZE game_id=${gameId} version=2 passed=true`);
  } finally {
    try {
      if (saved) await mini.callWxMethod('setStorageSync', storageKey, saved);
      else await mini.callWxMethod('removeStorageSync', storageKey);
    } finally { mini.disconnect(); }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
