import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
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

test('online history restores active rooms and opens real review for finished games', async () => {
  const storage = new Map<string, unknown>();
  const routes: string[] = [];
  let definition: Record<string, any> | null = null;
  (globalThis as any).Page = (page: Record<string, any>) => { definition = page; };
  (globalThis as any).wx = {
    getStorageSync: (key: string) => storage.get(key) ?? '',
    setStorageSync: (key: string, value: unknown) => { storage.set(key, value); },
    removeStorageSync: (key: string) => { storage.delete(key); },
    navigateTo: ({ url }: { url: string }) => { routes.push(url); },
  };
  const { createWxDeviceHistoryStore } = await import('../miniprogram/services/device-history.ts');
  const history = createWxDeviceHistoryStore();
  const initial = createInitialGameState();
  history.record({ id: 'online-active', mode: 'online', state: initial, turns: 1 });
  history.record({ id: 'online-finished', mode: 'online',
    state: { ...initial, game_status: 'FINISHED', winner: 'A',
      winner_reason: 'RESIGN' }, turns: 0 });
  await import('../miniprogram/pages/history/history.ts');
  const page = { ...definition!, data: { ...definition!.data },
    setData(patch: Record<string, unknown>) { this.data = { ...this.data, ...patch }; } };
  page.onLoad({});
  assert.equal(page.data.records.find((row: any) => row.id === 'online-active').title, '远程双人');
  page.openRecord({ currentTarget: { dataset: { id: 'online-active' } } });
  page.openRecord({ currentTarget: { dataset: { id: 'online-finished' } } });
  assert.deepEqual(routes, [
    '/pages/online/online?gameId=online-active',
    '/pages/review/review?mode=online&gameId=online-finished',
  ]);
  const reviewable = { ...definition!, data: { ...definition!.data },
    setData(patch: Record<string, unknown>) { this.data = { ...this.data, ...patch }; } };
  reviewable.onLoad({ filter: 'reviewable' });
  assert.equal(reviewable.data.records.length, 1);
  assert.equal(reviewable.data.records[0].turns, 0);
  assert.equal(reviewable.data.records[0].action, '查看复盘');
  assert.match(reviewable.data.records[0].result, /玩家 B 认输/);
});
