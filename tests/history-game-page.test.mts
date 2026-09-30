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

test('game page records and resumes real local games and indexes server games', async () => {
  const storage = new Map<string, unknown>();
  storage.set('wuma:device-account-token:v1:http://127.0.0.1:8000', 'a'.repeat(64));
  let failHistoryWrite = false;
  let failActiveWrite = false;
  const navigations: string[] = [];
  let pageDefinition: Record<string, any> | null = null;
  (globalThis as any).Page = (definition: Record<string, any>) => { pageDefinition = definition; };
  (globalThis as any).wx = {
    getStorageSync: (key: string) => storage.get(key) ?? '',
    setStorageSync: (key: string, value: unknown) => {
      if (key === 'wuma:history:v1' && failHistoryWrite) {
        failHistoryWrite = false;
        throw new Error('storage full');
      }
      if (key === 'activeAiGameId' && failActiveWrite) {
        failActiveWrite = false;
        throw new Error('storage unavailable');
      }
      storage.set(key, structuredClone(value));
    },
    removeStorageSync: (key: string) => { storage.delete(key); },
    showToast: () => {},
    navigateTo: ({ url }: { url: string }) => { navigations.push(url); },
  };
  await import('../miniprogram/pages/game/game.ts');
  const definition = pageDefinition!;
  const makePage = () => ({ ...definition, data: { ...definition.data },
    setData(patch: Record<string, unknown>) { this.data = { ...this.data, ...patch }; } });
  const first = makePage();
  first.onLoad({ mode: 'local' });
  const firstId = first.data.localGameId;
  assert.match(firstId, /^local-/);
  first.onNode({ detail: { id: 'P01' } });
  failHistoryWrite = true;
  first.onNode({ detail: { id: 'P02' } });
  assert.equal(first.data.localTurns, 0, 'a failed save must not commit the local turn');
  assert.equal(first.data.localSession.gameState.board.occupancy.P02, null);
  first.onNode({ detail: { id: 'P02' } });
  const { createWxDeviceHistoryStore } = await import('../miniprogram/services/device-history.ts');
  let rows = createWxDeviceHistoryStore().list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, firstId);
  assert.equal(rows[0].turns, 1);
  assert.equal(rows[0].localState?.board.occupancy.P02, 'A');
  first.openAnalysis();
  assert.equal(navigations.at(-1),
    `/pages/analysis/analysis?mode=local&gameId=${encodeURIComponent(firstId)}`);
  first.onUnload();

  const reopened = makePage();
  reopened.onLoad({ mode: 'local', gameId: firstId });
  assert.equal(reopened.data.localSession.gameState.current_player, 'B');
  assert.equal(reopened.data.board.pieces.find((piece: any) => piece.nodeId === 'P02')?.side, 'black');
  reopened.restartLocalGame();
  assert.notEqual(reopened.data.localGameId, firstId);
  rows = createWxDeviceHistoryStore().list();
  assert.equal(rows.length, 2);

  const initial = createInitialGameState();
  reopened.renderRemote({ gameId: 'remote-1', gameState: initial, gameVersion: 4, plyCount: 4,
    selectedNode: null, legalTargets: [], lastMove: null, lastCapture: null });
  reopened.renderAi({ gameId: 'ai-1', gameState: initial, gameVersion: 2, plyCount: 2,
    selectedNode: null, legalTargets: [], lastMove: null, lastCapture: null,
    aiPlayer: 'B', analysis: null });
  rows = createWxDeviceHistoryStore().list();
  assert.equal(rows.length, 4);
  assert.equal(rows.find((row: any) => row.id === 'remote-1')?.turns, 4);
  assert.equal(rows.find((row: any) => row.id === 'ai-1')?.turns, 2);

  const loaded: string[] = [];
  (globalThis as any).wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'develop' } });
  (globalThis as any).wx.request = (options: any) => {
    const path = new URL(options.url).pathname;
    loaded.push(`${options.method} ${path}`);
    const data = path.endsWith('/ai-1')
      ? { game_id: 'ai-1', version: 2, ply_count: 2, state: initial, mode: 'AI',
          human_player: 'A', ai_player: 'B', ai_level: 'STANDARD' }
      : { game_id: 'remote-1', version: 4, ply_count: 4, state: initial, mode: 'LOCAL',
          human_player: null, ai_player: null, ai_level: null };
    options.success({ statusCode: 200, data: { code: 0, message: 'success', data } });
  };
  const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
  const oldAi = makePage();
  oldAi.onLoad({ mode: 'ai', gameId: 'ai-1' });
  await flush();
  assert.equal(oldAi.data.aiState.gameId, 'ai-1');
  oldAi.onUnload();
  const oldRemote = makePage();
  oldRemote.onLoad({ mode: 'remote', gameId: 'remote-1' });
  await flush();
  assert.equal(oldRemote.data.remoteState.gameId, 'remote-1');
  oldRemote.openAnalysis();
  assert.equal(navigations.at(-1),
    '/pages/analysis/analysis?mode=remote&gameId=remote-1');
  oldRemote.onUnload();
  assert.deepEqual(loaded, ['GET /api/v1/game/ai-1', 'GET /api/v1/game/remote-1']);

  storage.set('activeAiGameId', 'ai-Y');
  (globalThis as any).wx.request = (options: any) => {
    const path = new URL(options.url).pathname;
    loaded.push(`${options.method} ${path}`);
    const id = path.split('/').at(-1);
    options.success({ statusCode: 200, data: { code: 0, message: 'success',
      data: { game_id: id, version: 0, ply_count: 0, state: initial, mode: 'AI',
        human_player: 'A', ai_player: 'B', ai_level: 'STANDARD' } } });
  };
  failActiveWrite = true;
  const historical = makePage();
  historical.onLoad({ mode: 'ai', gameId: 'ai-X' });
  await flush();
  assert.ok(historical.data.aiState.errorMessage);
  historical.retryAiGame();
  await flush();
  assert.equal(historical.data.aiState.gameId, 'ai-X');
  assert.deepEqual(loaded.slice(-2), [
    'GET /api/v1/game/ai-X', 'GET /api/v1/game/ai-X',
  ]);
  historical.onUnload();

  let creates = 0;
  (globalThis as any).wx.request = (options: any) => {
    const path = new URL(options.url).pathname;
    if (options.method === 'POST') creates++;
    loaded.push(`${options.method} ${path}`);
    options.success({ statusCode: 404, data: { code: 'GAME_NOT_FOUND',
      message: 'missing' } });
  };
  const missingAi = makePage();
  missingAi.onLoad({ mode: 'ai', gameId: 'missing-ai' });
  await flush();
  assert.equal(missingAi.data.aiState.gameId, null);
  assert.match(missingAi.data.aiState.errorMessage, /不存在/);
  missingAi.retryAiGame();
  await flush();
  assert.equal(creates, 0, 'a missing history game must never create another game');
  assert.deepEqual(loaded.slice(-2), [
    'GET /api/v1/game/missing-ai', 'GET /api/v1/game/missing-ai',
  ]);
  missingAi.onUnload();

  const missingRemote = makePage();
  missingRemote.onLoad({ mode: 'remote', gameId: 'missing-remote' });
  await flush();
  assert.equal(missingRemote.data.remoteState.gameId, null);
  assert.match(missingRemote.data.remoteState.errorMessage, /不存在/);
  missingRemote.retryRemoteGame();
  await flush();
  assert.equal(creates, 0);
  assert.deepEqual(loaded.slice(-2), [
    'GET /api/v1/game/missing-remote', 'GET /api/v1/game/missing-remote',
  ]);
  missingRemote.onUnload();

  storage.delete('activeLocalGameId');
  failHistoryWrite = true;
  const unsavedLocal = makePage();
  unsavedLocal.onLoad({ mode: 'local' });
  assert.equal(unsavedLocal.data.mode, 'local');
  assert.equal(unsavedLocal.data.localSession, null);
  assert.match(unsavedLocal.data.localErrorMessage, /保存失败/);
  unsavedLocal.restartLocalGame();
  assert.ok(unsavedLocal.data.localSession);
  unsavedLocal.onUnload();

  const beforeMissingLocal = createWxDeviceHistoryStore().list().length;
  const missingLocal = makePage();
  missingLocal.onLoad({ mode: 'local', gameId: 'missing-local' });
  assert.equal(missingLocal.data.localSession, null);
  assert.match(missingLocal.data.localErrorMessage, /不存在/);
  assert.equal(createWxDeviceHistoryStore().list().length, beforeMissingLocal);
  missingLocal.onUnload();
});
