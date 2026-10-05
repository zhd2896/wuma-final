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

test('profile uses saved device identity and real account totals', async () => {
  const storage = new Map<string, unknown>();
  const paths: string[] = [];
  let definition: Record<string, any> | null = null;
  (globalThis as any).Page = (page: Record<string, any>) => { definition = page; };
  (globalThis as any).wx = {
    login: (options: any) => options.success({ code: 'profile-code' }),
    removeStorageSync: (key: string) => storage.delete(key),
    getStorageSync: (key: string) => storage.get(key) ?? '',
    setStorageSync: (key: string, value: unknown) => { storage.set(key, value); },
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    request: (options: any) => {
      const path = new URL(options.url).pathname;
      paths.push(path);
      if (path === '/api/v1/me/profile')
        assert.equal(options.header.Authorization, `Bearer ${'a'.repeat(64)}`);
      options.success({ statusCode: 200, data: { code: 0, data: path === '/api/v1/auth/wechat'
        ? { token: 'a'.repeat(64), userId: 'user1', expiresAt: '2099-01-01T00:00:00Z' }
        : { id: 'user1', nickname: '本机棋手', games: 2, finishedGames: 1,
          wins: 1, losses: 0, reviewedGames: 1, training: 2, trainingAttempts: 4, correct: 3 } } });
    },
  };
  await import('../miniprogram/pages/profile/profile.ts');
  const page = { ...definition!, data: { ...definition!.data },
    setData(patch: Record<string, unknown>) { this.data = { ...this.data, ...patch }; } };
  storage.set('wuma:wechat-session:v1:http://127.0.0.1:8000', { token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' });
  await page.load();
  assert.equal(page.data.state, 'success');
  assert.equal(page.data.cloudGames, 2);
  assert.equal(page.data.accuracy, '75%');
  await page.load();
  assert.deepEqual(paths, ['/api/v1/me/profile', '/api/v1/me/profile']);
  const wxml = readFileSync(new URL('../miniprogram/pages/profile/profile.wxml', import.meta.url), 'utf8');
  assert.doesNotMatch(wxml, /演示数据|UI 演示开关/);
});
