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

const { analyzePosition } = await import('../miniprogram/ai/position-analysis.ts');

test('independent page analyzes saved local state offline and authoritative server version', async () => {
  const state = createInitialGameState();
  const storage = new Map<string, unknown>();
  storage.set('wuma:history:v1', { version: 1, records: [{
    id: 'local-1', mode: 'local', startedAt: 1, updatedAt: 1, turns: 0,
    status: 'PLAYING', winner: null, winnerReason: null, localState: state,
    lastMove: null,
  }] });
  storage.set('activeLocalGameId', 'local-1');
  storage.set('wuma:device-account-token:v1:http://127.0.0.1:8000', 'a'.repeat(64));
  const requests: Array<{ method: string; path: string; data: any }> = [];
  let pageDefinition: Record<string, any> | null = null;
  (globalThis as any).Page = (definition: Record<string, any>) => { pageDefinition = definition; };
  (globalThis as any).wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getStorageSync: (key: string) => storage.get(key) ?? '',
    setStorageSync: (key: string, value: unknown) => { storage.set(key, value); },
    removeStorageSync: (key: string) => { storage.delete(key); },
    navigateBack: () => {}, navigateTo: () => {},
    request: (options: any) => {
      const url = new URL(options.url);
      requests.push({ method: options.method, path: url.pathname, data: options.data });
      const reply = (data: unknown) => options.success({ statusCode: 200,
        data: { code: 0, message: 'success', data } });
      if (options.method === 'GET' && url.pathname === '/api/v1/game/server-1') {
        reply({ game_id: 'server-1', version: 4, state, mode: 'LOCAL',
          human_player: null, ai_player: null, ai_level: null });
      } else if (options.method === 'POST' && url.pathname === '/api/v1/ai/analyze') {
        reply({ game_id: 'server-1', game_version: 4,
          ...analyzePosition(state, { maxDepth: 1, timeLimitMs: 1000, now: () => 0 }) });
      } else throw new Error(`Unexpected request ${options.method} ${url.pathname}`);
    },
  };
  await import('../miniprogram/pages/analysis/analysis.ts');
  const definition = pageDefinition!;
  const makePage = () => ({ ...definition, data: { ...definition.data },
    setData(patch: Record<string, unknown>) { this.data = { ...this.data, ...patch }; } });
  const flush = async () => { for (let i = 0; i < 8; i++) {
    await new Promise(resolve => setImmediate(resolve));
  } };

  const local = makePage();
  local.onLoad({ mode: 'local', gameId: 'local-1' });
  await flush();
  assert.equal(local.data.state, 'success');
  assert.equal(local.data.gameId, 'local-1');
  assert.equal(local.data.view.board.pieces.length, 10);
  assert.ok(local.data.view.candidates.length > 0);
  assert.deepEqual(requests, [], 'local analysis must remain available offline');
  local.onUnload();

  const remote = makePage();
  remote.onLoad({ mode: 'remote', gameId: 'server-1' });
  await flush();
  assert.equal(remote.data.state, 'success');
  assert.equal(remote.data.gameVersion, 4);
  assert.deepEqual(requests.map(row => [row.method, row.path]), [
    ['GET', '/api/v1/game/server-1'],
    ['POST', '/api/v1/ai/analyze'],
  ]);
  assert.equal(requests[1].data.expected_version, 4);
  assert.equal(remote.data.view.perspective, 'A');
  remote.onUnload();
});

test('analysis templates bind real fields and contain no demo labels', () => {
  const page = readFileSync(new URL('../miniprogram/pages/analysis/analysis.wxml',
    import.meta.url), 'utf8');
  const evaluation = readFileSync(new URL(
    '../miniprogram/components/evaluation-panel/evaluation-panel.wxml', import.meta.url), 'utf8');
  assert.match(page, /view\.breakdown/);
  assert.match(page, /view\.keyPieces/);
  assert.match(page, /view\.candidates/);
  assert.match(page, /best-score="\{\{view\.bestScore\}\}"/);
  assert.doesNotMatch(page, /bestScore=/);
  assert.match(page, /view\.winner/);
  assert.match(page, /view\.winnerReason/);
  assert.doesNotMatch(`${page}\n${evaluation}`, /演示数据|演示棋盘|UI 演示/);
});
