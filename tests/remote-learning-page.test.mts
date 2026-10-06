import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { createInitialGameState } from '../miniprogram/domain/index.ts';
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); } catch (error) {
    if (specifier.startsWith('.') && context.parentURL && (error as any).code === 'ERR_MODULE_NOT_FOUND') {
      const url = new URL(`${specifier}.ts`, context.parentURL); if (existsSync(url)) return next(url.href, context);
    } throw error;
  }
} });
const { analyzePosition } = await import('../miniprogram/ai/position-analysis.ts');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
let sequence = 0;
async function mount(name: string, respond: (options: any, reply: (data: any) => void) => void) {
  let definition: any; const requests: any[] = [], navigation: string[] = [];
  let identity = 'a'.repeat(64), seatToken = 'seat-token';
  (globalThis as any).Page = (value: any) => { definition = value; };
  (globalThis as any).wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getStorageSync: (key: string) => key.startsWith('wuma:wechat-session:') ? { token: identity, expiresAt: '2099-01-01T00:00:00Z' }
      : key.startsWith('wuma:online:seat:') ? seatToken : '',
    setStorageSync: () => {}, removeStorageSync: () => {}, showToast: () => {},
    navigateTo: ({ url }: any) => navigation.push(url), navigateBack: () => {},
    request: (options: any) => { requests.push(options); respond(options, data => options.success({ statusCode: 200, data: { code: 0, data } })); },
  };
  await import(`../miniprogram/pages/${name}/${name}.ts?phase7-${sequence++}`);
  const page = { ...definition, data: structuredClone(definition.data), setData(patch: any) { Object.assign(this.data, patch); } };
  return { page, requests, navigation, changeAccount: () => { identity = 'b'.repeat(64); }, rotateSeat: () => { seatToken = 'new-seat'; } };
}
const state = createInitialGameState();
const terminal = { ...state, game_status: 'FINISHED', winner: 'A', winner_reason: 'RESIGN' };
const room = (finished = false) => ({ game_id: 'online-room', account_bound: true, seat: 'B', version: finished ? 1 : 0,
  ply_count: 0, pending_undo: null, room_status: finished ? 'FINISHED' : 'PLAYING', state: finished ? terminal : state });
const review = { id: 'seat-review', gameId: 'online-room', reviewedPlayer: 'B', winner: 'A', winnerReason: 'RESIGN',
  bestMoveRate: 0, turningPoints: [], moveReviews: [], goodMoves: 0, normalMoves: 0, mistakes: 0, blunders: 0 };
const explained = { review, explanation: { gameReviewId: review.id, moveExplanations: [],
  gameExplanation: { overall_summary: '本方没有有效落子。', strengths: [], main_problems: [], practice_suggestions: [], fallbackUsed: true } } };
function reviewReply(options: any, reply: (data: any) => void) {
  const path = new URL(options.url).pathname;
  assert.ok(path.startsWith('/api/v1/remote/rooms/'));
  assert.equal(options.header['X-Room-Token'], 'seat-token');
  if (path.endsWith('/replay')) return reply({ game_id: 'online-room', version: 1, ply_count: 0, initial_state: state,
    steps: [{ kind: 'RESIGN', version: 1, ply: 0, game_move_id: null, player: 'B', move: null, capture: null, state: terminal }] });
  if (path.endsWith('/review')) return reply(review);
  if (path.endsWith('/review/explanation') || path.endsWith('/review/explain')) return reply(explained);
  if (path.endsWith('/training')) return reply({ items: [], total: 0 });
  reply(room(true));
}

test('actual online game exposes playing and finished analysis route with room ID', async () => {
  const { page, navigation } = await mount('online', () => {});
  for (const status of ['PLAYING', 'FINISHED', 'WAITING', 'CANCELLED', 'EXPIRED']) {
    page.data.snapshot = { room: { ...room(), room_status: status } }; page.openAnalysis();
  }
  assert.deepEqual(navigation, ['/pages/analysis/analysis?mode=online&gameId=online-room', '/pages/analysis/analysis?mode=online&gameId=online-room']);
  assert.match(readFileSync('miniprogram/pages/online/online.wxml', 'utf8'), /bindtap="openAnalysis"/);
});

test('actual analysis page uses bound room token version and keeps terminal empty analysis', async () => {
  for (const finished of [false, true]) {
    const current = room(finished);
    const { page, requests } = await mount('analysis', (options, reply) => {
      assert.ok(new URL(options.url).pathname.startsWith('/api/v1/remote/rooms/'));
      assert.equal(options.header['X-Room-Token'], 'seat-token');
      if (options.method === 'POST') {
        assert.deepEqual(options.data, { expected_version: current.version });
        return reply({ ...analyzePosition(current.state as any, { maxDepth: 1, timeLimitMs: 1000, now: () => 0 }),
          game_id: current.game_id, game_version: current.version });
      } reply(current);
    });
    page.onLoad({ mode: 'online', gameId: 'online-room' }); await flush();
    assert.equal(page.data.state, 'success'); assert.equal(page.data.seat, 'B'); assert.equal(requests.length, 2);
    assert.deepEqual(page.data.view.reserve, { A: current.state.players.A.reserve_count, B: current.state.players.B.reserve_count });
    if (finished) assert.equal(page.data.view.candidates.length, 0);
    page.onHide(); assert.equal(page.data.view, null); page.onUnload();
  }
  assert.match(readFileSync('miniprogram/pages/analysis/analysis.wxml', 'utf8'), /view.reserve.A/);
  assert.match(readFileSync('miniprogram/pages/analysis/analysis.wxml', 'utf8'), /view.reserve.B/);
});

test('actual online review reads explanation and empty training gives honest notice; own list route retains player', async () => {
  let empty = true;
  const { page, navigation, requests } = await mount('review', (options, reply) => {
    if (new URL(options.url).pathname.endsWith('/training')) {
      assert.deepEqual(options.data, {}); return reply(empty ? { items: [], total: 0 } : { items: [{ player: 'B' }], total: 1 });
    } reviewReply(options, reply);
  });
  page.onLoad({ mode: 'online', gameId: 'online-room' }); await flush();
  assert.equal(page.data.state, 'success'); assert.equal(page.data.explanationState, 'success');
  assert.equal(page.data.reviewedPlayer, 'B'); assert.equal(page.data.canSelectPerspective, false);
  await page.generateTraining(); assert.match(page.data.trainingNotice, /没有.*失误|无需/); assert.deepEqual(navigation, []);
  empty = false; await page.generateTraining();
  assert.deepEqual(navigation, ['/pages/training/training?source=REVIEW&gameId=online-room&player=B']);
  assert.ok(requests.some(r => new URL(r.url).pathname.endsWith('/review/explanation')));
  assert.doesNotMatch(readFileSync('miniprogram/pages/review/review.wxml', 'utf8'), /wx:if="\{\{mode != 'online'\}\}"/);
});

test('online review ignores explanation and training after hide, account switch or token rotation', async () => {
  for (const boundary of ['hide', 'account', 'token']) {
    let late: (() => void) | undefined;
    const mounted = await mount('review', (options, reply) => {
      if (new URL(options.url).pathname.endsWith('/review/explanation')) { late = () => reply(explained); return; }
      reviewReply(options, reply);
    });
    mounted.page.onLoad({ mode: 'online', gameId: 'online-room' }); await flush(); assert.ok(late);
    if (boundary === 'hide') mounted.page.onHide();
    else if (boundary === 'account') mounted.changeAccount(); else mounted.rotateSeat();
    late(); await flush(); assert.notEqual(mounted.page.data.explanationState, 'success');
    assert.equal(mounted.page.data.gameExplanation, null);
    if (boundary !== 'hide') {
      assert.equal(mounted.page.data.state, 'error');
      assert.equal(mounted.page.data.review, null);
      assert.match(mounted.page.data.errorMessage, /账号|席位/);
    }
  }
});

test('online training generation cannot navigate after hide, account switch or token rotation', async () => {
  for (const boundary of ['hide', 'account', 'token']) {
    let late!: () => void;
    const mounted = await mount('review', (options, reply) => {
      if (new URL(options.url).pathname.endsWith('/training')) { late = () => reply({ items: [{ player: 'B' }], total: 1 }); return; }
      reviewReply(options, reply);
    });
    mounted.page.onLoad({ mode: 'online', gameId: 'online-room' }); await flush();
    const pending = mounted.page.generateTraining(); await flush(); assert.ok(late);
    if (boundary === 'hide') mounted.page.onHide();
    else if (boundary === 'account') mounted.changeAccount(); else mounted.rotateSeat();
    late(); await pending; assert.deepEqual(mounted.navigation, []);
    if (boundary !== 'hide') assert.equal(mounted.page.data.isGeneratingTraining, false);
  }
});
