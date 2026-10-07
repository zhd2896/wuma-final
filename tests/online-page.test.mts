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
  storage.set('wuma:wechat-session:v1:http://127.0.0.1:8000', { token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' });
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
        version: 0, ply_count: 0, pending_undo: null, state: initial, token: path.endsWith('/join') ? 'guest-seat' : null };
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

test('online page confirms real operations, uses ply count and settings, and never vibrates on polling', async () => {
  const { RuleEngine } = await import('../miniprogram/domain/index.ts');
  const storage = new Map<string, unknown>([
    ['wuma:wechat-session:v1:http://127.0.0.1:8000', { token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' }],
    ['wuma:online:active', 'page-ops'], ['wuma:online:seat:page-ops', 'seat'],
    ['wuma:game-settings:v1', { version: 1, settings: {
      showLegalTargets: false, showCaptureNotice: false, vibrateOnAction: true, aiFirstPlayer: 'A' } }],
  ]);
  const first = RuleEngine.executeTurn(createInitialGameState(), { from: 'P01', to: 'P02' });
  const second = RuleEngine.executeTurn(first.state, { from: 'P05', to: 'P04' });
  const moved = RuleEngine.executeTurn(second.state, { from: 'P02', to: 'P03' });
  let current: any = { game_id: 'page-ops', seat: 'A', room_status: 'PLAYING', invite_code: 'ABCDEFGH',
    public: false, expires_at: '2099-01-01T00:00:00Z', version: 10, ply_count: 2,
    pending_undo: null, state: second.state, token: null };
  const requests: any[] = [];
  let vibrations = 0;
  let definition: any;
  (globalThis as any).Page = (value: any) => { definition = value; };
  (globalThis as any).wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getStorageSync: (key: string) => storage.get(key) ?? '',
    setStorageSync: (key: string, value: unknown) => storage.set(key, structuredClone(value)),
    removeStorageSync: (key: string) => storage.delete(key),
    vibrateShort: () => { vibrations++; },
    request: (options: any) => {
      requests.push(options);
      const path = new URL(options.url).pathname;
      let result: any = current;
      if (path.endsWith('/legal-moves')) result = { moves: [{ from: 'P02', to: 'P03' }] };
      else if (path.endsWith('/move')) {
        current = { ...current, version: 11, ply_count: 3, state: moved.state };
        result = { version: 11, ply_count: 3, turn: { ...moved, capture: {
          ...moved.capture, was_applied: true, captured_nodes: ['P04'], reserve_used: 1 } } };
      } else if (path.endsWith('/undo-requests')) {
        current = { ...current, pending_undo: { id: 'server-undo', requester: 'A', responder: 'B',
          base_revision: current.version, anchor_turn: 3, revert_count: 1, status: 'PENDING' } };
        result = current;
      } else if (path.endsWith('/decline')) {
        current = { ...current, pending_undo: null }; result = current;
      } else if (path.endsWith('/accept')) {
        current = { ...current, version: current.version + 1, ply_count: 1, pending_undo: null, state: first.state }; result = current;
      } else if (path.endsWith('/resign')) {
        current = { ...current, version: current.version + 1, pending_undo: null, room_status: 'FINISHED',
          state: { ...current.state, game_status: 'FINISHED', winner: 'B', winner_reason: 'RESIGN' } }; result = current;
      }
      options.success({ statusCode: 200, data: { code: 0, data: result } });
    },
  };
  await import('../miniprogram/pages/online/online.ts?operations');
  const page: any = { ...definition, data: { ...definition.data },
    setData(patch: any) { this.data = { ...this.data, ...patch }; } };
  const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
  page.onLoad({ gameId: 'page-ops' }); await settle();
  assert.equal(page.data.settings.showLegalTargets, false);
  const { createWxDeviceHistoryStore } = await import('../miniprogram/services/device-history.ts');
  assert.equal(createWxDeviceHistoryStore().get('page-ops')?.turns, 2);
  page.onNode({ detail: { id: 'P02' } }); await settle();
  assert.deepEqual(page.data.snapshot.legalTargets, ['P03']);
  assert.equal(page.data.board.nodes.some((node: any) => node.legalTarget), false);
  page.onNode({ detail: { id: 'P03' } }); await settle();
  assert.equal(vibrations, 1);
  assert.equal(page.data.captureText, '');
  page.settings(); assert.equal(page.data.showSettings, true);
  page.onSettingsChange({ detail: { ...page.data.settings, showLegalTargets: true, showCaptureNotice: true } });
  assert.match(page.data.captureText, /你吃掉对手的 1 枚/);
  assert.equal((storage.get('wuma:game-settings:v1') as any).settings.showCaptureNotice, true);
  page.requestUndo();
  assert.equal(page.data.showUndoConfirm, true);
  assert.equal(page.data.showResign, false);
  assert.match(page.data.undoMessage, /服务端/);
  assert.equal(requests.some(request => request.url.endsWith('/undo-requests')), false);
  await page.confirmUndo();
  assert.equal(page.data.snapshot.room.pending_undo.revert_count, 1);
  assert.equal(page.data.showUndoConfirm, false);
  assert.equal(vibrations, 2);
  assert.equal(requests.at(-1).method, 'GET');
  const pending = { id: 'incoming-undo', requester: 'B', responder: 'A',
    base_revision: current.version, anchor_turn: 2, revert_count: 2, status: 'PENDING' };
  current = { ...current, pending_undo: pending };
  await page.controller.refresh();
  assert.equal(page.data.snapshot.canRespondToUndo, true);
  assert.equal(vibrations, 2);
  await page.declineUndo();
  assert.equal(page.data.snapshot.room.pending_undo, null);
  assert.equal(vibrations, 3);
  current = { ...current, pending_undo: pending };
  await page.controller.refresh();
  await page.acceptUndo();
  assert.equal(page.data.snapshot.room.ply_count, 1);
  assert.equal(createWxDeviceHistoryStore().get('page-ops')?.turns, 1);
  assert.equal(vibrations, 4);
  await page.controller.refresh(); assert.equal(vibrations, 4);
  page.resign(); assert.equal(page.data.showResign, true); assert.equal(page.data.showUndoConfirm, false);
  await page.confirmResign();
  assert.equal(page.data.snapshot.room.room_status, 'FINISHED');
  assert.equal(page.data.showResign, false);
  assert.equal(page.data.operationBusy, false);
  assert.equal(vibrations, 5);
  assert.equal(createWxDeviceHistoryStore().get('page-ops')?.winnerReason, 'RESIGN');
  let retries = 0;
  page.controller = { retry: async () => { retries++; }, dispose: () => {} };
  page.retryOperation(); assert.equal(retries, 1);
  const routes: string[] = [];
  (globalThis as any).wx.navigateTo = ({ url }: any) => { routes.push(url); };
  page.viewReview();
  assert.deepEqual(routes, ['/pages/review/review?mode=online&gameId=page-ops']);
  page.onUnload();
});

test('online markup binds implemented operations and shared confirmation/settings components', async () => {
  const { readFileSync } = await import('node:fs');
  const root = new URL('../miniprogram/pages/online/', import.meta.url);
  const wxml = readFileSync(new URL('online.wxml', root), 'utf8');
  const manifest = JSON.parse(readFileSync(new URL('online.json', root), 'utf8'));
  for (const method of ['requestUndo', 'acceptUndo', 'declineUndo', 'resign', 'settings', 'retryOperation', 'viewReview'])
    assert.match(wxml, new RegExp(`bindtap="${method}"`));
  assert.match(wxml, /pending_undo.revert_count/);
  assert.match(wxml, /snapshot.room.ply_count/);
  assert.match(wxml, /disabled="\{\{[^}]*operationBusy/);
  assert.match(wxml, /<confirm-dialog\b[^>]*visible="\{\{showResign\}\}"/);
  assert.match(wxml, /<game-settings\b[^>]*bind:change="onSettingsChange"/);
  assert.equal(manifest.usingComponents['confirm-dialog'], '../../components/confirm-dialog/confirm-dialog');
  assert.equal(manifest.usingComponents['game-settings'], '../../components/game-settings/game-settings');
});


test('online page restores terminal resignation using its seat for either winner', async () => {
  for (const seat of ['A', 'B']) for (const winner of ['A', 'B']) {
    const storage = new Map<string, unknown>([['wuma:online:seat:online-resigned', 'seat-token']]);
    let definition: any;
    (globalThis as any).Page = (value: any) => { definition = value; };
    (globalThis as any).wx = {
      getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
      getStorageSync: (key: string) => key.startsWith('wuma:wechat-session:') ? { token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' } : storage.get(key) ?? '',
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
      request: (options: any) => {
        assert.equal(options.header['X-Room-Token'], 'seat-token');
        options.success({ statusCode: 200, data: { code: 0, data: {
          game_id: 'online-resigned', seat, version: 1, ply_count: 0, pending_undo: null,
          room_status: 'FINISHED', token: null,
          state: { ...createInitialGameState(), game_status: 'FINISHED', winner, winner_reason: 'RESIGN' },
        } } });
      },
    };
    await import(`../miniprogram/pages/online/online.ts?resignation-${seat}-${winner}`);
    const page = { ...definition, data: { ...definition.data },
      setData(patch: any) { Object.assign(this.data, patch); } };
    page.onLoad({ gameId: 'online-resigned' });
    for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(page.data.snapshot.room.seat, seat);
    assert.equal(page.data.view.winner, winner);
    assert.equal(page.data.view.winnerMessage, seat === winner ? '对方已认输' : '你已认输');
    page.onUnload();
  }
});
