import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (specifier.startsWith('.') && context.parentURL &&
        (error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return nextResolve(url.href, context);
    }
    throw error;
  }
} });

test('review page reads or creates review, explains it, and keeps structured fields', async () => {
  const { createInitialGameState, executeTurn } = await import('../miniprogram/domain/index.ts');
  const initial = createInitialGameState();
  const stateBefore = { ...initial, board: {
    occupancy: { ...initial.board.occupancy, P19: 'A', P13: null },
  } };
  const before = structuredClone(stateBefore);
  const turn = executeTurn(stateBefore, { from: 'P19', to: 'P13' });
  const terminal = { ...turn.state, game_status: 'FINISHED', winner: 'A', winner_reason: 'CAPTURE_ALL' };
  const requests: string[] = [];
  const review = { id: 'r1', gameId: 'g1', reviewedPlayer: 'A', winner: 'A',
    winnerReason: 'CAPTURE_ALL', goodMoves: 1, normalMoves: 0, mistakes: 0, blunders: 0,
    bestMoveRate: 1, turningPoints: [], moveReviews: [{ turn: 1, player: 'A',
      actualMove: { from: 'P19', to: 'P13' }, bestMove: { from: 'P19', to: 'P18' },
      stateBefore,
      scoreLoss: 0, category: 'GOOD', engineExplanation: '实际走法与最佳方案搜索同分。' }] };
  const explanation = { gameReviewId: 'r1', promptVersion: 'review_explanation_v1',
    gameExplanation: { overall_summary: '本局共复盘一手。', strengths: [], main_problems: [],
      practice_suggestions: ['比较实际走法。'], fallbackUsed: true, provider: 'fallback', model: null },
    moveExplanations: [{ turn: 1, headline: '第 1 手复盘', explanation: '这一手同分。',
      suggestion: '比较实际走法。', fallbackUsed: true, provider: 'fallback', model: null }] };
  let definition: Record<string, any> | null = null;
  (globalThis as any).Page = (value: Record<string, any>) => { definition = value; };
  (globalThis as any).wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getStorageSync: (key: string) => key.startsWith('wuma:wechat-session:')
      ? { token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' } : '',
    request: (options: any) => {
      requests.push(`${options.method} ${new URL(options.url).pathname}`);
      const path = new URL(options.url).pathname;
      if (path === '/api/v1/game/g1') return options.success({ statusCode: 200, data: { code: 0, data: {
        game_id: 'g1', version: 1, ply_count: 1, mode: 'LOCAL', ai_player: null, human_player: null,
        ai_level: null, state: terminal } } });
      if (path.endsWith('/replay')) return options.success({ statusCode: 200, data: { code: 0, data: {
        game_id: 'g1', version: 1, ply_count: 1, initial_state: stateBefore,
        steps: [{ kind: 'MOVE', ply: 1, version: 1, game_move_id: 1, player: 'A', move: turn.move,
          capture: turn.capture, state: terminal }] } } });
      const explain = path.endsWith('/explain');
      if (options.method === 'GET') options.success({ statusCode: 404,
        data: { code: explain ? 'EXPLANATION_NOT_FOUND' : 'REVIEW_NOT_FOUND',
          message: 'missing', data: null } });
      else options.success({ statusCode: 200,
        data: { code: 0, message: 'success', data: explain
          ? { review, explanation } : review } });
    },
  };
  await import('../miniprogram/pages/review/review.ts');
  assert.ok(definition);
  const page = { ...definition!, data: { ...definition!.data },
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); } };
  await page.load('g1');
  assert.deepEqual(requests, ['GET /api/v1/game/g1', 'GET /api/v1/game/g1/replay', 'GET /api/v1/game/g1/review', 'POST /api/v1/game/g1/review',
    'GET /api/v1/game/g1/review/explain', 'POST /api/v1/game/g1/review/explain']);
  assert.equal(page.data.state, 'success');
  assert.equal(page.data.bestMoveRateText, '100.0%');
  assert.equal(page.data.rows[0].actualText, 'P19 → P13');
  assert.equal(page.data.rows[0].categoryText, '好棋');
  assert.deepEqual(page.data.keyMoments, []);
  assert.doesNotMatch(page.data.terminalText, /CAPTURE_ALL/);
  assert.equal(page.data.selectedTurn, 1);
  assert.equal(page.data.reviewBoard.recommendedTo, 'P13');
  assert.ok(page.data.reviewBoard.pieces.some((piece: any) => piece.nodeId === 'P19'));
  assert.ok(!page.data.reviewBoard.pieces.some((piece: any) => piece.nodeId === 'P13'));
  const pieces = structuredClone(page.data.reviewBoard.pieces);
  page.selectReviewMove({ currentTarget: { dataset: { turn: 1, kind: 'best' } } });
  assert.equal(page.data.reviewBoard.recommendedTo, 'P18');
  assert.equal(page.data.selectedRoute, 'best');
  assert.match(page.data.routeText, /P18/);
  page.selectReviewMove({ currentTarget: { dataset: { turn: 1, kind: 'actual' } } });
  assert.equal(page.data.reviewBoard.recommendedTo, 'P13');
  assert.deepEqual(page.data.reviewBoard.pieces, pieces);
  assert.deepEqual(stateBefore, before);
  assert.equal(page.data.isGeneratingExplanation, false);
  assert.equal(page.data.explanationState, 'success');
  assert.equal(page.data.rows[0].naturalExplanation, '这一手同分。');
  assert.equal(page.data.gameExplanation.overall_summary, '本局共复盘一手。');
  assert.match(readFileSync('miniprogram/pages/review/review.wxml', 'utf8'), /scoreLoss/);
  assert.match(readFileSync('miniprogram/pages/review/review.wxml', 'utf8'), /naturalExplanation/);
});


test('online review verifies its saved seat and only requests room review, including zero move resignation', async () => {
  const { createInitialGameState, executeTurn } = await import('../miniprogram/domain/index.ts');
  for (const seat of ['A', 'B']) {
    const requests: any[] = [];
    const review = { id: 'remote-review', gameId: 'online/id', reviewedPlayer: seat,
      winner: 'B', winnerReason: 'RESIGN', goodMoves: 0, normalMoves: 0,
      mistakes: 0, blunders: 0, bestMoveRate: 0, turningPoints: [], moveReviews: [] };
    let definition: any;
    (globalThis as any).Page = (value: any) => { definition = value; };
    (globalThis as any).wx = {
      getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
      getStorageSync: (key: string) => key === 'wuma:online:seat:online/id' ? 'room-token'
        : key.startsWith('wuma:wechat-session:') ? { token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' } : '',
      request: (options: any) => {
        requests.push(options);
        assert.equal(options.header['X-Room-Token'], 'room-token');
        const path = new URL(options.url).pathname;
        if (path.endsWith('/replay')) return options.success({ statusCode: 200, data: { code: 0, data: {
          game_id: 'online/id', version: 8, ply_count: 0, initial_state: createInitialGameState(),
          steps: [{ kind: 'RESIGN', ply: 0, version: 8, game_move_id: null, player: 'A', move: null,
            capture: null, state: { ...createInitialGameState(), game_status: 'FINISHED', winner: 'B', winner_reason: 'RESIGN' } }] } } });
        if (path.endsWith('/review') && options.method === 'GET')
          options.success({ statusCode: 404, data: { code: 'REVIEW_NOT_FOUND' } });
        else if (path.endsWith('/review/explanation') || path.endsWith('/review/explain'))
          options.success({ statusCode: 200, data: { code: 0, data: { review, explanation: {
            gameReviewId: review.id, gameExplanation: { overall_summary: '本方没有有效落子。', fallbackUsed: true }, moveExplanations: [] } } } });
        else if (path.endsWith('/training')) options.success({ statusCode: 200, data: { code: 0, data: { items: [], total: 0 } } });
        else options.success({ statusCode: 200, data: { code: 0, data: path.endsWith('/review') ? review : {
          game_id: 'online/id', seat, version: 8, ply_count: 0, room_status: 'FINISHED', pending_undo: null,
          state: { ...createInitialGameState(), game_status: 'FINISHED', winner: 'B', winner_reason: 'RESIGN' },
        } } });
      },
    };
    await import(`../miniprogram/pages/review/review.ts?online-${seat}`);
    const page = { ...definition, data: { ...definition.data },
      setData(patch: any) { Object.assign(this.data, patch); } };
    page.onLoad({ gameId: 'online/id', mode: 'online' });
    for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(page.data.state, 'success');
    assert.equal(page.data.review.reviewedPlayer, seat);
    assert.deepEqual(page.data.rows, []);
    assert.match(page.data.terminalText, seat === 'A' ? /你已认输/ : /对方已认输/);
    assert.equal(page.data.explanationState, 'success');
    await page.generateTraining(); page.retryExplanation();
    for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(requests.map(r => `${r.method} ${new URL(r.url).pathname}`), [
      'GET /api/v1/remote/rooms/online%2Fid',
      'GET /api/v1/remote/rooms/online%2Fid/replay',
      'GET /api/v1/remote/rooms/online%2Fid/review',
      'POST /api/v1/remote/rooms/online%2Fid/review',
      'GET /api/v1/remote/rooms/online%2Fid/review/explanation',
      'POST /api/v1/remote/rooms/online%2Fid/training',
      'GET /api/v1/remote/rooms/online%2Fid/review/explanation',
    ]);
  }
  const wxml = readFileSync('miniprogram/pages/review/review.wxml', 'utf8');
  assert.doesNotMatch(wxml, /wx:if="\{\{mode != 'online'\}\}"/);
  assert.match(wxml, /terminalText/);
});

test('online review fails clearly for missing, invalid, or mismatched seat credentials without public fallback', async () => {
  const { createInitialGameState, executeTurn } = await import('../miniprogram/domain/index.ts');
  for (const failure of ['missing', 'invalid', 'mismatch']) {
    const paths: string[] = [];
    let definition: any;
    (globalThis as any).Page = (value: any) => { definition = value; };
    (globalThis as any).wx = {
      getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
      getStorageSync: (key: string) => key.startsWith('wuma:online:seat:')
        ? (failure === 'missing' ? '' : 'bad-token')
        : key.startsWith('wuma:wechat-session:')
          ? { token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' } : '',
      request: (options: any) => {
        const path = new URL(options.url).pathname; paths.push(path);
        if (failure === 'invalid' || failure === 'missing') options.success({ statusCode: 403, data: { code: 'REMOTE_ACCESS_DENIED' } });
        else options.success({ statusCode: 200, data: { code: 0, data: path.endsWith('/review')
          ? { gameId: 'g1', reviewedPlayer: 'B' } : { game_id: 'g1', seat: 'A', version: 1,
            ply_count: 0, room_status: 'FINISHED', pending_undo: null, state: {
              ...createInitialGameState(), game_status: 'FINISHED', winner: 'B', winner_reason: 'RESIGN' } } } });
      },
    };
    await import(`../miniprogram/pages/review/review.ts?${failure}`);
    const page = { ...definition, data: { ...definition.data }, setData(patch: any) { Object.assign(this.data, patch); } };
    page.onLoad({ gameId: 'g1', mode: 'online' });
    for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(page.data.state, 'error');
    assert.match(page.data.errorMessage, failure === 'mismatch' ? /数据异常/ : /凭证/);
    assert.ok(paths.every(path => path.startsWith('/api/v1/remote/rooms/')));
    if (failure === 'missing') assert.deepEqual(paths, ['/api/v1/remote/rooms/g1/recover']);
    if (failure === 'invalid') assert.deepEqual(paths, ['/api/v1/remote/rooms/g1', '/api/v1/remote/rooms/g1/recover']);
  }
});
