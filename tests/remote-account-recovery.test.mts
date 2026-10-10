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

const room = (extra = {}) => ({ game_id: 'cloud-room', seat: 'A', room_status: 'PLAYING',
  invite_code: 'ABCDEFGH', public: false, expires_at: new Date().toISOString(),
  version: 0, ply_count: 0, pending_undo: null, state: createInitialGameState(), token: 'new-token', ...extra });
const storage = (entries = new Map<string, unknown>()) => ({ read: key => entries.get(key),
  write: (key, value) => entries.set(key, value), remove: key => entries.delete(key), entries });

test('cloud room without a local credential restores by authenticated account and saves its own token', async () => {
  const { OnlineGameController } = await import('../miniprogram/pages/online/online-game.ts');
  const saved = storage();
  const calls: string[] = [];
  const api = { recover: async id => { calls.push(id); return room(); } };
  const controller = new OnlineGameController(api as any, saved, () => {});
  await controller.restore('cloud-room');
  assert.deepEqual(calls, ['cloud-room']);
  assert.equal(controller.snapshot.room?.seat, 'A');
  assert.equal(saved.entries.get('wuma:online:seat:cloud-room'), 'new-token');
});

test('first account recovery network failure can retry the cloud game without an established room or token', async () => {
  const { OnlineGameController } = await import('../miniprogram/pages/online/online-game.ts');
  const { ApiError } = await import('../miniprogram/services/api-client.ts');
  const saved = storage();
  let calls = 0;
  const api = { recover: async id => {
    assert.equal(id, 'cloud-room');
    if (++calls === 1) throw new ApiError('NETWORK_ERROR', 0);
    return room();
  } };
  const controller = new OnlineGameController(api as any, saved, () => {});
  await controller.restore('cloud-room');
  assert.equal(controller.snapshot.room, null);
  assert.ok(controller.snapshot.error);
  await controller.retry();
  assert.equal(calls, 2);
  assert.equal(controller.snapshot.room?.game_id, 'cloud-room');
  assert.equal(controller.snapshot.error, '');
  assert.equal(saved.entries.get('wuma:online:seat:cloud-room'), 'new-token');
});

test('legacy token restoration explicitly claims only the authentic seat and saves its rotated token', async () => {
  const credentials = await import('../miniprogram/services/online-credentials.ts');
  const saved = storage(new Map([['wuma:online:seat:cloud-room', 'original-token']]));
  const calls: string[] = [];
  const api = { get: async (_id, token) => { calls.push('get:' + token); return room({ token: null, account_bound: false }); },
    claim: async (_id, token) => { calls.push('claim:' + token); return room({ account_bound: true }); } };
  const restored = await credentials.restoreOnlineSeat(api as any, saved, 'cloud-room');
  assert.deepEqual(calls, ['get:original-token', 'claim:original-token']);
  assert.equal(restored.token, 'new-token');
  assert.equal(saved.entries.get('wuma:online:seat:cloud-room'), 'new-token');
});

test('an invalid saved token can recover only by account and never falls back to unauthenticated access', async () => {
  const credentials = await import('../miniprogram/services/online-credentials.ts');
  const { ApiError } = await import('../miniprogram/services/api-client.ts');
  const saved = storage(new Map([['wuma:online:seat:cloud-room', 'retired-token']]));
  let calls = 0;
  const api = { get: async () => { throw new ApiError('REMOTE_ACCESS_DENIED', 403); },
    recover: async () => { calls++; throw new ApiError('REMOTE_ACCESS_DENIED', 403); } };
  await assert.rejects(credentials.restoreOnlineSeat(api as any, saved, 'cloud-room'), { code: 'REMOTE_ACCESS_DENIED' });
  assert.equal(calls, 1);
  assert.equal(saved.entries.get('wuma:online:seat:cloud-room'), 'retired-token');
});

test('cloud REMOTE history opens online resume or its own seat review', async () => {
  let definition: any;
  const urls: string[] = [];
  (globalThis as any).Page = value => { definition = value; };
  (globalThis as any).wx = { getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getStorageSync: key => key.startsWith('wuma:wechat-session:') ? { token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' } : '', navigateTo: ({ url }) => urls.push(url) };
  await import('../miniprogram/pages/history/history.ts');
  const page = { ...definition, data: { ...definition.data },
    cloud: [{ gameId: 'cloud-room', mode: 'REMOTE', seat: 'B', status: 'PLAYING',
      winner: null, startedAt: new Date().toISOString(), finishedAt: null, turns: 2, reviewAvailable: false }],
    setData(patch) { Object.assign(this.data, patch); } };
  page.renderRows();
  assert.equal(page.data.records[0].mode, 'online');
  assert.match(page.data.records[0].title, /红棋/);
  page.openRecord({ currentTarget: { dataset: { id: 'cloud-room' } } });
  assert.equal(urls.pop(), '/pages/online/online?gameId=cloud-room');
  page.cloud[0].status = 'FINISHED';
  page.renderRows();
  page.openRecord({ currentTarget: { dataset: { id: 'cloud-room' } } });
  assert.equal(urls.pop(), '/pages/review/review?mode=online&gameId=cloud-room');
});

test('finished online review without a local token recovers its account seat before fetching review', async () => {
  let definition: any;
  const requests: any[] = [];
  const saved = new Map<string, unknown>();
  const initial = createInitialGameState();
  const finished = { ...initial, game_status: 'FINISHED', winner: 'A', winner_reason: 'RESIGN' };
  (globalThis as any).Page = value => { definition = value; };
  (globalThis as any).wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getStorageSync: key => key.startsWith('wuma:wechat-session:')
      ? { token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' } : saved.get(key),
    setStorageSync: (key, value) => saved.set(key, value), removeStorageSync: key => saved.delete(key),
    request: options => {
      requests.push(options);
      const path = new URL(options.url).pathname;
      const data = path.endsWith('/recover') ? room({ seat: 'B', room_status: 'FINISHED', version: 1, state: finished })
        : path.endsWith('/replay') ? { game_id: 'cloud-room', version: 1, ply_count: 0,
          initial_state: initial, steps: [{ kind: 'RESIGN', version: 1, ply: 0, player: 'B',
            game_move_id: null, move: null, capture: null, state: finished }] }
        : { id: 'review-b', gameId: 'cloud-room', reviewedPlayer: 'B', winner: 'A', winnerReason: 'RESIGN',
            bestMoveRate: 0, turningPoints: [], moveReviews: [] };
      options.success({ statusCode: 200, data: { code: 0, data } });
    },
  };
  await import('../miniprogram/pages/review/review.ts');
  const page = { ...definition, data: { ...definition.data, mode: 'online' },
    setData(patch) { Object.assign(this.data, patch); } };
  await page.load('cloud-room');
  assert.equal(page.data.state, 'success');
  assert.equal(page.data.review.reviewedPlayer, 'B');
  assert.deepEqual(requests.map(options => new URL(options.url).pathname),
    ['/api/v1/remote/rooms/cloud-room/recover', '/api/v1/remote/rooms/cloud-room/replay', '/api/v1/remote/rooms/cloud-room/review', '/api/v1/remote/rooms/cloud-room/review/explanation']);
  assert.equal(requests[1].header['X-Room-Token'], 'new-token');
});

test('cloud finished state supersedes a stale local online row while device-only history remains available', async () => {
  let definition: any;
  const saved = new Map<string, unknown>();
  (globalThis as any).Page = value => { definition = value; };
  (globalThis as any).wx = { getStorageSync: key => saved.get(key),
    setStorageSync: (key, value) => saved.set(key, value) };
  const { createWxDeviceHistoryStore } = await import('../miniprogram/services/device-history.ts');
  createWxDeviceHistoryStore().record({ id: 'cloud-room', mode: 'online', state: createInitialGameState(), turns: 1 });
  createWxDeviceHistoryStore().record({ id: 'legacy-room', mode: 'online', state: createInitialGameState(), turns: 2 });
  await import('../miniprogram/pages/history/history.ts?authoritative-cloud');
  const page = { ...definition, data: { ...definition.data }, cloud: [{ gameId: 'cloud-room',
    mode: 'REMOTE', seat: 'B', status: 'FINISHED', winner: 'B', winnerReason: 'RESIGN',
    startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-02T00:00:00Z', turns: 8, reviewAvailable: true }],
    setData(patch) { Object.assign(this.data, patch); } };
  page.renderRows();
  assert.equal(page.data.records.length, 2);
  const authoritative = page.data.records.find(row => row.id === 'cloud-room');
  assert.equal(authoritative.status, 'FINISHED');
  assert.equal(authoritative.turns, 8);
  assert.match(authoritative.title, /红棋/);
  assert.equal(page.data.records.find(row => row.id === 'legacy-room').status, 'PLAYING');
});
