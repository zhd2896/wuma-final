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

test('invite opens a real guest room page and history reopens the saved seat', async () => {
  const storage = new Map<string, unknown>();
  storage.set('wuma:device-account-token:v1:http://127.0.0.1:8000', 'a'.repeat(64));
  const requests: any[] = [];
  const initial = createInitialGameState();
  let definition: Record<string, any> | null = null;
  (globalThis as any).Page = (page: Record<string, any>) => { definition = page; };
  (globalThis as any).wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getStorageSync: (key: string) => storage.get(key) ?? '',
    setStorageSync: (key: string, value: unknown) => { storage.set(key, value); },
    removeStorageSync: (key: string) => { storage.delete(key); },
    request: (options: any) => {
      requests.push(options);
      const path = new URL(options.url).pathname;
      const room = { game_id: 'online-id', seat: 'B', room_status: 'PLAYING',
        invite_code: 'ABCDEFGH', public: false, expires_at: new Date().toISOString(),
        version: 0, state: initial, token: path.endsWith('/join') ? 'guest-seat' : null };
      assert.ok(path.endsWith('/join') || path.endsWith('/rooms/online-id'));
      options.success({ statusCode: 200, data: { code: 0, data: room } });
    },
  };
  await import('../miniprogram/pages/online/online.ts');
  const makePage = () => ({ ...definition!, data: { ...definition!.data },
    setData(patch: Record<string, unknown>) { this.data = { ...this.data, ...patch }; } });
  const first = makePage();
  first.onLoad({ code: 'ABCDEFGH' });
  assert.equal(first.data.joinCode, 'ABCDEFGH');
  first.joinRoom();
  for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(first.data.snapshot.room.seat, 'B');
  assert.equal(first.data.board.pieces.length, 10);
  assert.equal(storage.get('wuma:online:seat:online-id'), 'guest-seat');
  assert.equal(requests[0].data.invite_code, 'ABCDEFGH');
  assert.equal(first.onShareAppMessage().path, '/pages/online/online');
  first.onNode({ detail: { id: 'P05' } });
  assert.equal(requests.length, 1, 'guest cannot request moves on A turn');
  first.onUnload();

  const restored = makePage();
  restored.onLoad({ gameId: 'online-id' });
  for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(restored.data.snapshot.room.seat, 'B');
  assert.equal(requests[1].header['X-Room-Token'], 'guest-seat');
  restored.onUnload();
});
