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

test('public tutorial plays all three steps, restores checkpoints and preserves login AI target', async () => {
  await import('../miniprogram/guide/pages/tutorial/tutorial.ts');
  const p = make(); p.onLoad();
  p.startAi(); assert.equal(destinations.length, 0);
  tap(p, 'P11'); tap(p, 'P12'); p.next();
  const resumed = make(); resumed.onLoad();
  assert.equal(resumed.data.stepIndex, 1);
  tap(resumed, 'P08'); tap(resumed, 'P13'); resumed.next();
  tap(resumed, 'P08'); tap(resumed, 'P13'); resumed.next();
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
