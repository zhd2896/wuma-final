import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { RuleEngine, createInitialGameState } from '../miniprogram/domain/index.ts';

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

test('existing game page renders remote server state, saves ID, restores and keeps local mode', async () => {
  const initial = createInitialGameState();
  const turn = RuleEngine.executeTurn(initial, { from: 'P01', to: 'P02' });
  let serverState = initial;
  let storedId: string | null = null;
  const otherStorage = new Map<string, unknown>();
  otherStorage.set('wuma:wechat-session:v1:http://127.0.0.1:8000', { token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' });
  let creates = 0;
  const requests: Array<{ method: string; url: string; data?: unknown }> = [];
  let pageDefinition: Record<string, any> | null = null;
  (globalThis as any).Page = (definition: Record<string, any>) => { pageDefinition = definition; };
  (globalThis as any).wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getStorageSync: (key: string) => key === 'activeRemoteGameId'
      ? storedId : otherStorage.get(key) ?? '',
    setStorageSync: (key: string, value: unknown) => {
      if (key === 'activeRemoteGameId') storedId = value as string;
      else otherStorage.set(key, structuredClone(value));
    },
    removeStorageSync: (key: string) => {
      if (key === 'activeRemoteGameId') storedId = null;
      else otherStorage.delete(key);
    },
    showToast: () => {},
    request: (options: any) => {
      requests.push(options);
      const path = new URL(options.url).pathname;
      const reply = (data: unknown) => options.success({ statusCode: 200,
        data: { code: 0, message: 'success', data } });
      if (path === '/api/v1/game' && options.method === 'POST') {
        creates++;
        reply({ game_id: `g${creates}`, version: 0, ply_count: 0, state: initial });
      } else if (path === '/api/v1/game/g1' && options.method === 'GET') {
        reply({ game_id: 'g1', version: serverState === initial ? 0 : 1,
          ply_count: serverState === initial ? 0 : 1, state: serverState });
      } else if (path.endsWith('/legal-moves')) {
        reply({ moves: [{ from: 'P01', to: 'P02' }] });
      } else if (path.endsWith('/move')) {
        serverState = turn.state;
        reply({ turn });
      } else if (path.endsWith('/undo')) {
        assert.equal(options.data.expected_version, 1);
        serverState = initial;
        reply({ version: 2, ply_count: 0, state: initial, reverted_turns: 1 });
      } else throw new Error(`Unexpected request ${options.url}`);
    },
  };
  await import('../miniprogram/pages/game/game.ts');
  assert.ok(pageDefinition);
  const definition = pageDefinition!;
  const makePage = () => ({ ...definition, data: { ...definition.data },
    setData(patch: Record<string, unknown>) { this.data = { ...this.data, ...patch }; } });
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };

  const page = makePage();
  page.onLoad({ mode: 'remote' });
  await flush();
  assert.equal(storedId, 'g1');
  assert.equal(page.data.mode, 'remote');
  assert.equal(page.data.remoteView.currentPlayer, 'A');
  assert.equal(page.data.board.pieces.length, 10);
  page.onNode({ detail: { id: 'P01' } });
  await flush();
  assert.equal(page.data.board.nodes.find((node: any) => node.id === 'P02').legalTarget, true);
  page.onNode({ detail: { id: 'P02' } });
  await flush();
  assert.equal(page.data.board.pieces.find((piece: any) => piece.nodeId === 'P02').side, 'black');
  assert.equal(page.data.remoteView.currentPlayer, 'B');
  assert.deepEqual(requests.find(request => request.url.endsWith('/move'))?.data,
    { from_node: 'P01', to_node: 'P02' });
  page.onAction({ currentTarget: { dataset: { action: 'undo' } } });
  assert.equal(page.data.showUndoConfirm, true);
  page.confirmUndo();
  await flush();
  assert.equal(page.data.remoteState.plyCount, 0);
  assert.equal(page.data.remoteView.currentPlayer, 'A');
  page.onUnload();

  const reopened = makePage();
  reopened.onLoad({ mode: 'remote' });
  await flush();
  assert.equal(creates, 1);
  assert.equal(reopened.data.remoteView.currentPlayer, 'A');
  reopened.onAction({ currentTarget: { dataset: { action: 'restart' } } });
  await flush();
  assert.equal(storedId, 'g2');
  assert.equal(creates, 2);
  assert.equal(reopened.data.remoteView.currentPlayer, 'A');
  reopened.onUnload();

  const local = makePage();
  local.onLoad({ mode: 'local' });
  assert.equal(local.data.mode, 'local');
  assert.equal(local.data.localSession.gameState.current_player, 'A');
  assert.equal(local.data.board.pieces.length, 10);
  const wxml = readFileSync(new URL('../miniprogram/pages/game/game.wxml', import.meta.url), 'utf8');
  assert.match(wxml, /<chess-board\b[^>]*board="{{board}}"[^>]*bind:node="onNode"/);
});
