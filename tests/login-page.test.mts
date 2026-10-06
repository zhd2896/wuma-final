import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';

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


const root = 'http://127.0.0.1:8000';
const key = `wuma:wechat-session:v1:${root}`;
let definition: any;
(globalThis as any).Page = (page: any) => { definition = page; };

function environment() {
  const storage = new Map<string, any>();
  const destinations: string[] = [];
  let calls = 0;
  let finish: ((value: any) => void) | null = null;
  (globalThis as any).getCurrentPages = () => [{ route: 'pages/login/login', options: {} }];
  (globalThis as any).wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
    reLaunch: ({ url, complete }: any) => { destinations.push(url); complete?.(); },
    login: (options: any) => { calls++; finish = options.success; },
    request: (options: any) => options.success({ statusCode: 200, data: { code: 0,
      data: { token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' } } }),
  };
  return { storage, destinations, calls: () => calls,
    finish: () => finish!({ code: 'login-button-code' }) };
}

function page() {
  return { ...definition, data: { ...definition.data },
    setData(patch: any) { this.data = { ...this.data, ...patch }; } };
}

test('login waits for button and coalesces repeat taps, then restores a deep link', async () => {
  const env = environment();
  await import('../miniprogram/pages/login/login.ts');
  const instance = page();
  instance.onLoad({ next: '/pages/review/review?gameId=g1' });
  assert.equal(env.calls(), 0);
  const first = instance.login();
  const second = instance.login();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.calls(), 1);
  assert.equal(instance.data.isLoading, true);
  env.finish();
  await Promise.all([first, second]);
  assert.deepEqual(env.destinations, ['/pages/review/review?gameId=g1']);
});

test('valid session skips login; unsafe next routes fall back to home', () => {
  const env = environment();
  env.storage.set(key, { token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' });
  const instance = page();
  instance.onLoad({ next: 'https://evil.test' });
  assert.deepEqual(env.destinations, ['/pages/index/index']);
  assert.equal(env.calls(), 0);
});

test('failed WeChat login stays on page with a retryable error', async () => {
  const env = environment();
  (globalThis as any).wx.login = (options: any) => options.fail({ errMsg: 'offline' });
  const instance = page();
  instance.onLoad({});
  await instance.login();
  assert.equal(instance.data.isLoading, false);
  assert.match(instance.data.errorMessage, /微信登录/);
  assert.deepEqual(env.destinations, []);
});

test('business API with no session redirects without automatically logging in', async () => {
  const env = environment();
  (globalThis as any).getCurrentPages = () => [{ route: 'pages/profile/profile', options: {} }];
  const { createApiClient } = await import('../miniprogram/services/api-client.ts');
  const outcome = createApiClient().request('GET', '/api/v1/me/profile').then(() => 'resolved', () => 'rejected');
  const result = await Promise.race([outcome, new Promise(resolve => setTimeout(() => resolve('hung'), 100))]);
  assert.equal(result, 'rejected');
  assert.equal(env.calls(), 0);
  assert.equal(env.destinations[0], '/pages/login/login?next=/pages/profile/profile');
});

test('logout clears only login state and preserves local records', async () => {
  const env = environment();
  env.storage.set(key, { token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' });
  env.storage.set('wuma:history:v1', ['local-game']);
  const { logoutWechat } = await import('../miniprogram/services/device-auth.ts');
  logoutWechat();
  assert.equal(env.storage.has(key), false);
  assert.deepEqual(env.storage.get('wuma:history:v1'), ['local-game']);
});


test('app protects cold-start deep links and resumes expired sessions even if launch path was login', async () => {
  const env = environment();
  let app: any;
  (globalThis as any).App = (value: any) => { app = value; };
  (globalThis as any).getCurrentPages = () => [];
  await import('../miniprogram/app.ts');
  app.onShow({ path: 'pages/review/review', query: { gameId: 'g1' } });
  assert.equal(env.destinations[0], '/pages/login/login?next=/pages/review/review%3FgameId%3Dg1');
  (globalThis as any).getCurrentPages = () => [{ route: 'pages/profile/profile', options: {} }];
  app.onShow({ path: 'pages/login/login', query: {} });
  assert.equal(env.destinations[1], '/pages/login/login?next=/pages/profile/profile');
  env.storage.set(key, { token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' });
  app.onShow({ path: 'pages/profile/profile', query: {} });
  assert.equal(env.destinations.length, 2);
  env.storage.clear();
  (globalThis as any).getCurrentPages = () => [];
  app.onShow({ path: 'guide/pages/rules/rules', query: {} });
  assert.equal(env.destinations.length, 2, 'offline rules must not require server login');
  (globalThis as any).getCurrentPages = () => [{ route: 'guide/pages/rules/rules', options: {} }];
  app.onShow({ path: 'pages/login/login', query: {} });
  assert.equal(env.destinations.length, 2, 'resuming offline rules must stay on rules');
});

test('guest can open rules and the safe return route recognizes only the registered guide', async () => {
  const env = environment();
  const { safeReturnRoute } = await import('../miniprogram/services/auth-navigation.ts');
  assert.equal(safeReturnRoute('/guide/pages/rules/rules'), '/guide/pages/rules/rules');
  assert.equal(safeReturnRoute('/guide/pages/unknown/unknown'), '/pages/index/index');
  (globalThis as any).wx.navigateTo = ({ url }: any) => env.destinations.push(url);
  page().openRules();
  assert.deepEqual(env.destinations, ['/guide/pages/rules/rules']);
});

test('profile logout returns to login while preserving local history', async () => {
  const env = environment();
  env.storage.set(key, { token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' });
  env.storage.set('wuma:history:v1', ['local-game']);
  let profile: any;
  (globalThis as any).Page = (value: any) => { profile = value; };
  await import('../miniprogram/pages/profile/profile.ts');
  profile = { ...profile, requestGeneration: 2,
    data: { ...profile.data, cloudGames: 5, skillProfile: { seal: '熟' } },
    setData(patch: Record<string, unknown>) { this.data = { ...this.data, ...patch }; } };
  profile.logout();
  assert.equal(profile.requestGeneration, 3);
  assert.equal(profile.data.skillProfile, null);
  assert.equal(profile.data.cloudGames, 0);
  assert.deepEqual(env.destinations, ['/pages/login/login']);
  assert.equal(env.storage.has(key), false);
  assert.deepEqual(env.storage.get('wuma:history:v1'), ['local-game']);
});


test('concurrent login redirects preserve the first return target while navigation is pending', async () => {
  const env = environment();
  (globalThis as any).getCurrentPages = () => [{ route: 'pages/review/review', options: { gameId: 'g1' } }];
  let complete: (() => void) | undefined;
  (globalThis as any).wx.reLaunch = (options: any) => { env.destinations.push(options.url); complete = options.complete; };
  const { showLogin } = await import('../miniprogram/services/auth-navigation.ts');
  showLogin('/pages/review/review?gameId=g1');
  showLogin('/pages/profile/profile');
  assert.equal(env.destinations.length, 1);
  assert.equal(env.destinations[0], '/pages/login/login?next=/pages/review/review%3FgameId%3Dg1');
  complete?.();
  showLogin('/pages/profile/profile');
  assert.equal(env.destinations.length, 2);
  complete?.();
});
