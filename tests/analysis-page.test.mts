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
  const requests: Array<{ method: string; path: string; data: any }> = [];
  const scrolls: string[] = [];
  let pageDefinition: Record<string, any> | null = null;
  (globalThis as any).Page = (definition: Record<string, any>) => { pageDefinition = definition; };
  (globalThis as any).wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getStorageSync: (key: string) => key.startsWith('wuma:wechat-session:v1:')
      ? { token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' } : storage.get(key) ?? '',
    setStorageSync: (key: string, value: unknown) => { storage.set(key, value); },
    removeStorageSync: (key: string) => { storage.delete(key); },
    navigateBack: () => {}, navigateTo: () => {},
    pageScrollTo: (options: any) => { scrolls.push(options.selector); },
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
    setData(patch: Record<string, unknown>, callback?: () => void) {
      this.data = { ...this.data, ...patch }; callback?.(); } });
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
  const originalBoard = structuredClone(local.data.view.board);
  const candidate = local.data.view.candidates.at(-1);
  local.selectMove({ detail: { id: candidate.id } });
  assert.equal(local.data.previewBoard.recommendedFrom, candidate.move.from);
  assert.equal(local.data.previewBoard.recommendedTo, candidate.move.to);
  assert.equal(local.data.previewMoveId, candidate.id);
  assert.match(local.data.previewText, /正在预览/);
  assert.equal(scrolls.at(-1), '#analysis-board-preview');
  assert.ok(local.data.previewBoard.recommendLine);
  assert.deepEqual(local.data.previewBoard.pieces, originalBoard.pieces);
  assert.deepEqual(local.data.view.board, originalBoard);
  const selectedBoard = local.data.previewBoard;
  local.selectMove({ detail: { id: 'not-a-candidate' } });
  assert.equal(local.data.previewBoard, selectedBoard);
  local.showBestMove();
  assert.equal(local.data.previewBoard.recommendedTo, local.data.view.bestMove.move.to);
  local.clearPreview();
  assert.equal(local.data.previewMoveId, '');
  assert.equal(local.data.previewText, '');
  assert.equal(local.data.previewBoard.recommendLine, undefined);
  assert.deepEqual(local.data.previewBoard.pieces, originalBoard.pieces);
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
  assert.match(evaluation, /analysis\.breakdown/);
  assert.match(page, /view\.keyPieces/);
  assert.match(page, /view\.alternatives/);
  assert.match(page, /analysis="\{\{view\}\}"/);
  assert.match(evaluation, /<expandable-details[\s\S]*analysis\.scoreText/);
  assert.doesNotMatch(evaluation, /class="track"|class="marker"/);
  assert.doesNotMatch(page, /bestScore=/);
  assert.match(page, /view\.winner/);
  assert.match(page, /view\.presentation\.reasons/);
  assert.doesNotMatch(`${page}\n${evaluation}`, /演示数据|演示棋盘|UI 演示/);
});
