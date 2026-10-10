import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
registerHooks({ resolve(s,c,next) { try { return next(s,c); } catch(e) {
  if(s.startsWith('.') && c.parentURL && existsSync(new URL(`${s}.ts`,c.parentURL))) return next(new URL(`${s}.ts`,c.parentURL).href,c);
  throw e;
} } });
const routes: string[] = [];
let loggedIn = false;
let envVersion = 'develop';
let current = 'pages/index/index';
(globalThis as any).getCurrentPages = () => [{ route: current, options: {} }];
(globalThis as any).wx = {
  getAccountInfoSync: () => ({ miniProgram: { envVersion } }),
  getStorageSync: () => loggedIn ? { token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' } : '',
  navigateTo: (o:any) => routes.push(o.url),
  reLaunch: (o:any) => { routes.push(o.url); o.complete?.(); },
  login: () => { throw Error('no implicit login'); }, request: () => { throw Error('guest must not request'); },
};

test('first page is home and public pages work without API config or implicit login', async () => {
  const config = JSON.parse(readFileSync('miniprogram/app.json','utf8'));
  assert.equal(config.pages[0], 'pages/index/index');
  let app:any; (globalThis as any).App = (d:any) => app=d;
  await import('../miniprogram/app.ts');
  envVersion='trial'; routes.length=0;
  for (const page of ['pages/index/index', 'pages/learning/learning', 'guide/pages/tutorial/tutorial', 'guide/pages/trial/trial', 'pages/login/login']) {
    current=page; app.onShow({ path: page, query: {} });
  }
  assert.deepEqual(routes, []);
});

test('private navigation authenticates before entering page and retains room/query target', async () => {
  envVersion='develop'; current='pages/index/index'; loggedIn=false; routes.length=0;
  const { openPage, openTab } = await import('../miniprogram/utils/navigation.ts');
  openPage('/guide/pages/trial/trial');
  assert.equal(routes.pop(), '/guide/pages/trial/trial');
  const target='/pages/online/online?roomCode=AB1234';
  openPage(target);
  assert.equal(new URL(`https://local${routes.pop()}`).searchParams.get('next'), target);
  openTab('/pages/history/history');
  assert.match(routes.pop()!, /^\/pages\/login\/login/);
  loggedIn=true; openPage(target); assert.equal(routes.pop(),target);
});

test('home offers guest teaching, trial and explicit login; login can return to browsing', async () => {
  let definition:any; (globalThis as any).Page = (d:any) => definition=d;
  loggedIn=false; routes.length=0;
  await import('../miniprogram/pages/index/index.ts');
  const home={...definition,data:{...definition.data},setData(v:any){this.data={...this.data,...v};}};
  home.onShow(); assert.equal(home.data.loggedIn,false);
  home.openTrial(); assert.equal(routes.pop(),'/guide/pages/trial/trial');
  home.login(); assert.match(routes.pop()!,/^\/pages\/login\/login/);
  assert.match(readFileSync('miniprogram/pages/index/index.wxml','utf8'), /免登录/);
  await import('../miniprogram/pages/login/login.ts');
  definition.browse(); assert.equal(routes.pop(),'/pages/index/index');
});
