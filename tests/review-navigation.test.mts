import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';

registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (specifier.startsWith('.') && context.parentURL &&
        (error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return next(url.href, context);
    }
    throw error;
  }
} });

let definition: any;
(globalThis as any).Page = (value: any) => { definition = value; };
await import('../miniprogram/pages/review/review.ts');
const HISTORY = '/pages/history/history?filter=reviewable';
const reviewPage = { route: 'pages/review/review', options: { gameId: 'g1' } };

type StackPage = { route: string; options: Record<string, string> };
function environment(stack: StackPage[], session: 'valid' | 'missing' | 'expired' = 'valid') {
  const backCalls: any[] = [];
  const destinations: string[] = [];
  const pages = [...stack];
  (globalThis as any).getCurrentPages = () => pages;
  (globalThis as any).wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getStorageSync: (key: string) => key.startsWith('wuma:wechat-session:') && session !== 'missing'
      ? { token: 'a'.repeat(64), expiresAt: session === 'valid'
        ? '2099-01-01T00:00:00Z' : '2000-01-01T00:00:00Z' } : '',
    navigateBack: (options: any) => { backCalls.push(options); pages.pop(); options.success?.(); },
    reLaunch: (options: any) => { destinations.push(options.url); options.complete?.(); },
  };
  return { backCalls, destinations, pages };
}

for (const previous of [
  { route: 'pages/history/history', options: { filter: 'finished' } },
  { route: 'pages/game/game', options: { mode: 'ai', gameId: 'g1' } },
  { route: 'pages/online/online', options: { gameId: 'g1' } },
]) {
  test(`review back retains the existing ${previous.route} page and options`, () => {
    const env = environment([previous, reviewPage]);
    definition.back();
    assert.equal(env.backCalls.length, 1);
    assert.equal(env.backCalls[0].delta, 1);
    assert.deepEqual(env.pages, [previous]);
    assert.equal(env.pages[0], previous, 'normal return retains the previous page instance');
    assert.deepEqual(env.destinations, []);
  });
}

for (const stack of [[], [reviewPage]]) {
  test(`review back with ${stack.length} page returns to reviewable history without back navigation`, () => {
    const env = environment(stack);
    definition.back();
    assert.deepEqual(env.destinations, [HISTORY]);
    assert.deepEqual(env.backCalls, []);
  });
}

test('review back recovers to reviewable history after SDK navigation failure', () => {
  const env = environment([{ route: 'pages/game/game', options: { gameId: 'g1' } }, reviewPage]);
  (globalThis as any).wx.navigateBack = (options: any) => {
    env.backCalls.push(options);
    options.fail?.({ errMsg: 'navigateBack:fail navigation unavailable' });
  };
  definition.back();
  assert.equal(env.backCalls.length, 1);
  assert.deepEqual(env.destinations, [HISTORY]);
});

test('review back recovers when the SDK throws synchronously', () => {
  const env = environment([{ route: 'pages/history/history', options: {} }, reviewPage]);
  (globalThis as any).wx.navigateBack = () => { throw new Error('navigation unavailable'); };
  assert.doesNotThrow(() => definition.back());
  assert.deepEqual(env.destinations, [HISTORY]);
});

for (const session of ['missing', 'expired'] as const) {
  for (const kind of ['root', 'failure'] as const) {
    test(`review ${kind} fallback with ${session} session requires login and retains history destination`, () => {
      const env = environment(kind === 'root' ? [reviewPage]
        : [{ route: 'pages/online/online', options: { gameId: 'g1' } }, reviewPage], session);
      (globalThis as any).wx.navigateBack = (options: any) => options.fail?.({ errMsg: 'navigateBack:fail' });
      definition.back();
      assert.equal(env.destinations.length, 1);
      const target = new URL(env.destinations[0], 'https://miniprogram.invalid');
      assert.equal(target.pathname, '/pages/login/login');
      assert.equal(target.searchParams.get('next'), HISTORY);
    });
  }
}
