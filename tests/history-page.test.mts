import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { createInitialGameState } from '../miniprogram/domain/index.ts';

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

test('history page shows real local records and routes each status to a usable destination', async () => {
  const storage = new Map<string, unknown>();
  const destinations: string[] = [];
  let pageDefinition: Record<string, any> | null = null;
  (globalThis as any).Page = (definition: Record<string, any>) => { pageDefinition = definition; };
  (globalThis as any).wx = {
    getStorageSync: (key: string) => storage.get(key) ?? '',
    setStorageSync: (key: string, value: unknown) => { storage.set(key, structuredClone(value)); },
    removeStorageSync: (key: string) => { storage.delete(key); },
    navigateTo: ({ url }: { url: string }) => { destinations.push(url); },
    navigateBack: () => {},
  };
  const { createWxDeviceHistoryStore } = await import('../miniprogram/services/device-history.ts');
  await import('../miniprogram/pages/history/history.ts');
  const definition = pageDefinition!;
  const makePage = () => ({ ...definition, data: { ...definition.data },
    setData(patch: Record<string, unknown>) { this.data = { ...this.data, ...patch }; } });
  const page = makePage();
  page.onLoad({});
  assert.equal(page.data.state, 'empty');
  const initial = createInitialGameState();
  const finished = { ...initial, game_status: 'FINISHED' as const,
    winner: 'A' as const, winner_reason: 'CAPTURE_ALL' as const };
  const history = createWxDeviceHistoryStore();
  history.record({ id: 'server-ai', mode: 'ai', state: finished, turns: 8 });
  history.record({ id: 'server-remote', mode: 'remote', state: initial, turns: 3 });
  history.record({ id: 'local-1', mode: 'local', state: initial, turns: 1 });
  history.record({ id: 'local-finished', mode: 'local', state: finished, turns: 8 });
  page.onShow();
  assert.equal(page.data.state, 'success');
  assert.equal(page.data.records.length, 2);
  assert.equal(page.data.records.find((item: any) => item.id === 'server-ai'), undefined);
  page.openRecord({ currentTarget: { dataset: { id: 'local-1' } } });
  assert.deepEqual(destinations, [
    '/pages/game/game?mode=local&gameId=local-1',
  ]);
  const finishedOnly = makePage();
  finishedOnly.onLoad({ filter: 'finished' });
  assert.deepEqual(finishedOnly.data.records.map((item: any) => item.id),
    ['local-finished']);
  const reviewableOnly = makePage();
  reviewableOnly.onLoad({ filter: 'reviewable' });
  assert.deepEqual(reviewableOnly.data.records.map((item: any) => item.id), []);
  assert.equal(reviewableOnly.data.emptyTitle, '还没有可复盘的棋局');
  history.remove('server-ai');
  reviewableOnly.onShow();
  assert.equal(reviewableOnly.data.state, 'empty');
  assert.equal(reviewableOnly.data.emptyAction, '开始 AI 对弈');
  const { homeFeatures } = await import('../miniprogram/mock/game.ts');
  assert.equal(homeFeatures.find(feature => feature.id === 'review')?.route,
    '/pages/history/history?filter=reviewable');
  const wxml = readFileSync(new URL('../miniprogram/pages/history/history.wxml', import.meta.url), 'utf8');
  assert.doesNotMatch(wxml, /Mock|演示数据|预览空状态/);

  storage.set('activeAiGameId', 'legacy-ai');
  (globalThis as any).wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'develop' } });
  (globalThis as any).wx.login = (options: any) => options.success({ code: 'history-code' });
  const fetched: string[] = [];
  const token = 'a'.repeat(64);
  (globalThis as any).wx.request = (options: any) => {
    fetched.push(new URL(options.url).pathname);
    const path = new URL(options.url).pathname;
    options.success({ statusCode: 200, data: { code: 0, message: 'success',
      data: path === '/api/v1/auth/wechat' ? { userId: 'u1', token, expiresAt: '2099-01-01T00:00:00Z' } : {
        items: [{ gameId: 'current-ai', mode: 'AI', status: 'FINISHED', winner: 'A',
          startedAt: '2026-09-28T08:00:00+00:00', finishedAt: '2026-09-28T09:00:00+00:00',
          turns: 0, winnerReason: 'RESIGN', reviewAvailable: true }], nextCursor: null,
      } } });
  };
  storage.set('wuma:wechat-session:v1:http://127.0.0.1:8000', { token, expiresAt: '2099-01-01T00:00:00Z' });
  const legacy = makePage();
  legacy.onLoad({});
  for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(fetched, ['/api/v1/me/games']);
  assert.equal(legacy.data.records.find((item: any) => item.id === 'legacy-ai'), undefined);
  assert.equal(legacy.data.records.find((item: any) => item.id === 'current-ai')?.turns, 0);
  assert.match(legacy.data.records.find((item: any) => item.id === 'current-ai')?.result, /玩家 B 认输/);
  legacy.openRecord({ currentTarget: { dataset: { id: 'current-ai' } } });
  assert.equal(destinations.at(-1), '/pages/review/review?gameId=current-ai');
  (globalThis as any).wx.request = (options: any) => options.fail({ errMsg: 'offline' });
  legacy.onShow();
  for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(legacy.data.records.find((item: any) => item.id === 'current-ai'), undefined,
    'an unavailable account cannot leave a stale cloud game visible');
});
