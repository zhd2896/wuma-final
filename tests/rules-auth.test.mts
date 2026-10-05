import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';

registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (specifier.startsWith('.') && context.parentURL &&
        existsSync(new URL(`${specifier}.ts`, context.parentURL)))
      return next(new URL(`${specifier}.ts`, context.parentURL).href, context);
    throw error;
  }
} });

let definition: any;
(globalThis as any).Page = (value: any) => { definition = value; };
function environment() {
  const storage = new Map<string, unknown>();
  const destinations: string[] = [];
  (globalThis as any).getCurrentPages = () => [{ route: 'guide/pages/rules/rules', options: {} }];
  (globalThis as any).wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getStorageSync: (key: string) => storage.get(key),
    navigateBack: (options: any) => options.fail(),
    navigateTo: ({ url }: any) => destinations.push(url),
    reLaunch: ({ url, complete }: any) => { destinations.push(url); complete?.(); },
  };
  return { storage, destinations, login() {
    storage.set('wuma:wechat-session:v1:http://127.0.0.1:8000',
      { token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' });
  } };
}

test('guest returning from a cold-start rules page reaches login rather than home', async () => {
  const env = environment();
  await import('../miniprogram/guide/pages/rules/rules.ts');
  definition.back();
  assert.deepEqual(env.destinations, ['/pages/login/login?next=/pages/index/index']);
});

test('rules retains ordinary back navigation and signed-in home fallback', () => {
  const env = environment();
  const fallback = (globalThis as any).wx.navigateBack;
  (globalThis as any).wx.navigateBack = () => {};
  definition.back();
  assert.deepEqual(env.destinations, []);
  env.login();
  (globalThis as any).wx.navigateBack = fallback;
  definition.back();
  assert.deepEqual(env.destinations, ['/pages/index/index']);
});

test('rules starts AI directly only with a session, otherwise preserves the target through login', () => {
  const env = environment();
  definition.startGame();
  assert.deepEqual(env.destinations, ['/pages/login/login?next=/pages/game/game']);
  env.destinations.length = 0;
  env.login();
  definition.startGame();
  assert.deepEqual(env.destinations, ['/pages/game/game']);
});
