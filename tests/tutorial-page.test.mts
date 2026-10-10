import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
registerHooks({ resolve(s, c, next) {
  try { return next(s, c); } catch (e) {
    if (s.startsWith('.') && c.parentURL && existsSync(new URL(`${s}.ts`, c.parentURL)))
      return next(new URL(`${s}.ts`, c.parentURL).href, c);
    throw e;
  }
} });
let definition: any;
const storage = new Map<string, any>();
const destinations: string[] = [];
let online = false;
(globalThis as any).Page = (d: any) => definition = d;
(globalThis as any).getCurrentPages = () => [{ route: 'guide/pages/tutorial/tutorial', options: {} }];
(globalThis as any).wx = {
  getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
  getStorageSync: (k: string) => k.startsWith('wuma:wechat-session:') && online
    ? { token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' } : storage.get(k),
  setStorageSync: (k: string, v: any) => storage.set(k, v),
  navigateTo: ({ url, complete }: any) => { destinations.push(url); complete?.(); },
  reLaunch: ({ url, complete }: any) => { destinations.push(url); complete?.(); },
  navigateBack: ({ fail }: any) => fail(), showToast: () => {},
  request: () => { throw Error('tutorial must not call backend'); },
};
const make = () => ({ ...definition, data: { ...definition.data },
  setData(p: any) { this.data = { ...this.data, ...p }; } });
const tap = (p: any, id: string) => p.onNode({ detail: { id } });

test('public tutorial plays all lessons, restores checkpoints and preserves login AI target', async () => {
  await import('../miniprogram/guide/pages/tutorial/tutorial.ts');
  const { TUTORIAL_LESSONS } = await import('../miniprogram/guide/tutorial-controller.ts');
  const p = make(); p.onLoad();
  p.startAi(); assert.equal(destinations.length, 0);
  tap(p, 'P11'); tap(p, 'P12');
  assert.deepEqual(p.data.escapeRoutes, [], 'ordinary walking lesson does not list irrelevant red routes');
  p.next();
  const resumed = make(); resumed.onLoad();
  assert.equal(resumed.data.stepIndex, 1);
  tap(resumed, 'P08'); tap(resumed, 'P13'); resumed.next();
  tap(resumed, 'P08'); tap(resumed, 'P13'); resumed.next();
  for (let index = 3; index < TUTORIAL_LESSONS.length; index++) {
    const move = TUTORIAL_LESSONS[index].move ?? { from: 'P07', to: 'P03' };
    tap(resumed, move.from); tap(resumed, move.to); resumed.next();
  }
  assert.equal(resumed.data.completed, true);
  const finished = make(); finished.onLoad();
  assert.equal(finished.data.completed, true);
  finished.startAi();
  const next = new URL(`https://local${destinations.pop()}`).searchParams.get('next');
  assert.equal(next, '/pages/game/game?mode=ai&level=BEGINNER&first=human&new=1');
  online = true; finished.startAi();
  assert.equal(destinations.pop(), next);
  finished.retry(); assert.equal(finished.data.stepIndex, 0);
  resumed.onLoad(); assert.equal(resumed.data.stepIndex, 0);
});

test('old completed checkpoint resumes added lessons and version two stores all progress', async () => {
  await import('../miniprogram/guide/pages/tutorial/tutorial.ts');
  storage.clear();
  storage.set('wuma:tutorial:v1', { version: 1, stepIndex: 3 });
  const p = make(); p.onLoad();
  assert.equal(p.data.stepIndex, 3);
  assert.equal(p.data.completed, false);
  tap(p, 'P08'); tap(p, 'P13'); p.next();
  assert.deepEqual(storage.get('wuma:tutorial:v2'), { version: 2, stepIndex: 4 });
  const restored = make(); restored.onLoad();
  assert.equal(restored.data.stepIndex, 4, 'new progress overrides legacy completion');
  tap(restored, 'P07'); tap(restored, 'P03');
  assert.equal(restored.data.escapeRouteCount, restored.controller.snapshot.escapeMoves.length);
  assert.equal(restored.data.escapeRoutes.length, restored.data.escapeRouteCount, 'all real routes are available');
  assert.ok(restored.data.beforeEscapeRouteCount > 0, 'before-blockade routes are shown for comparison');
});

test('independent exercise exposes legal destinations without a recommended answer', async () => {
  await import('../miniprogram/guide/pages/tutorial/tutorial.ts');
  const { TUTORIAL_LESSONS } = await import('../miniprogram/guide/tutorial-controller.ts');
  storage.clear();
  storage.set('wuma:tutorial:v2', { version: 2, stepIndex: TUTORIAL_LESSONS.length - 1 });
  const p = make(); p.onLoad();
  assert.equal(p.data.independent, true);
  assert.equal(p.data.board.recommendedFrom, undefined);
  assert.equal(p.data.board.recommendedTo, undefined);
  tap(p, 'P09');
  assert.equal(p.data.board.recommendedTo, undefined);
  assert.ok(p.data.board.nodes.filter((node: any) => node.legalTarget).length > 1);
  tap(p, 'P03');
  assert.equal(p.data.passed, true);
  p.retry(); tap(p, 'P07'); tap(p, 'P12');
  assert.equal(p.data.needsRetry, true, 'failed attempt asks for retry after switching to red');
  const attemptedState = p.controller.snapshot.state;
  tap(p, 'P09'); tap(p, 'P03');
  assert.equal(p.controller.snapshot.state, attemptedState, 'cannot play black again after turn switched');
  p.retry(); assert.equal(p.data.needsRetry, false);
});

test('public offline tutorial bypasses API configuration, private game remains protected', async () => {
  const { isPublicRoute, safeReturnRoute } = await import('../miniprogram/services/auth-navigation.ts');
  assert.equal(isPublicRoute('guide/pages/tutorial/tutorial'), true);
  assert.equal(safeReturnRoute('/guide/pages/tutorial/tutorial'), '/guide/pages/tutorial/tutorial');
  online = false;
  (globalThis as any).wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'trial' } });
  let app: any;
  (globalThis as any).App = (d: any) => app = d;
  await import('../miniprogram/app.ts');
  destinations.length = 0;
  app.onShow({ path: 'guide/pages/tutorial/tutorial' });
  assert.equal(destinations.length, 0);
  (globalThis as any).getCurrentPages = () => [{ route: 'pages/game/game', options: {} }];
  app.onShow({ path: 'pages/game/game' });
  assert.match(destinations[0], /^\/pages\/login\/login/);
});

test('teaching is registered and reachable from home, login and rules', () => {
  const app = JSON.parse(readFileSync('miniprogram/app.json', 'utf8'));
  assert.ok(app.subPackages.find((p: any) => p.root === 'guide').pages.includes('pages/tutorial/tutorial'));
  for (const p of ['pages/index/index', 'pages/login/login', 'guide/pages/rules/rules']) {
    assert.match(readFileSync(`miniprogram/${p}.wxml`, 'utf8'), /bindtap="openTutorial"/);
    assert.match(readFileSync(`miniprogram/${p}.ts`, 'utf8'), /\/guide\/pages\/tutorial\/tutorial/);
  }
});
