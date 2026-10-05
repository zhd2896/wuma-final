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

test('independent coach loads the active AI game and reveals three real hint levels', async () => {
  const state = createInitialGameState();
  const storage = new Map<string, unknown>([
    ['activeAiGameId', 'ai-real'],
    ['wuma:wechat-session:v1:http://127.0.0.1:8000', { token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' }],
  ]);
  const requests: Array<{ method: string; path: string; data: any }> = [];
  const navigations: string[] = [];
  let version = 6;
  let pageDefinition: Record<string, any> | null = null;
  (globalThis as any).Page = (definition: Record<string, any>) => { pageDefinition = definition; };
  (globalThis as any).wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getStorageSync: (key: string) => storage.get(key) ?? '',
    setStorageSync: (key: string, value: unknown) => { storage.set(key, value); },
    removeStorageSync: (key: string) => { storage.delete(key); },
    navigateBack: () => {}, reLaunch: ({ url }: { url: string }) => { navigations.push(url); },
    navigateTo: ({ url }: { url: string }) => { navigations.push(url); },
    switchTab: ({ url }: { url: string }) => { navigations.push(url); },
    request: (options: any) => {
      const url = new URL(options.url);
      requests.push({ method: options.method, path: url.pathname, data: options.data });
      const reply = (data: unknown) => options.success({ statusCode: 200,
        data: { code: 0, message: 'success', data } });
      if (options.method === 'GET' && url.pathname === '/api/v1/game/ai-real') {
        reply({ game_id: 'ai-real', version, state, mode: 'AI',
          human_player: 'A', ai_player: 'B', ai_level: 'STANDARD' });
        return;
      }
      if (options.method === 'POST' &&
          url.pathname === '/api/v1/game/ai-real/coach/hint') {
        const level = options.data.level as 1 | 2 | 3;
        reply({ gameId: 'ai-real', gameVersion: version, analyzedPlayer: 'A', level,
          hintText: `服务端第 ${level} 级讲解`,
          focusTopics: level === 1 ? ['机动性'] : [],
          candidateFromNodes: level >= 2 ? ['P01'] : [],
          bestMove: level === 3 ? { from: 'P01', to: 'P02' } : null,
          fallbackUsed: true, provider: 'engine', model: null,
          promptVersion: 'coach_hint_v1', generatedAt: new Date(0).toISOString() });
        return;
      }
      throw new Error(`Unexpected request ${options.method} ${url.pathname}`);
    },
  };
  await import('../miniprogram/pages/coach/coach.ts');
  const definition = pageDefinition!;
  const page = { ...definition, data: { ...definition.data },
    setData(patch: Record<string, unknown>) { this.data = { ...this.data, ...patch }; } };
  const flush = async () => { for (let i = 0; i < 8; i++) {
    await new Promise(resolve => setImmediate(resolve));
  } };

  page.onLoad({});
  page.onShow();
  await flush();
  assert.equal(page.data.state, 'ready');
  assert.equal(page.data.gameId, 'ai-real');
  assert.equal(page.data.gameVersion, 6);
  assert.equal(page.data.board.pieces.length, 10);
  assert.equal(page.data.cards[0].locked, false);
  assert.equal(page.data.cards[1].locked, true);

  for (const level of [1, 2, 3]) {
    page.selectHint({ detail: { level } });
    await flush();
    if (level === 2) {
      assert.deepEqual(page.data.board.nodes.filter((node: any) => node.focused)
        .map((node: any) => node.id), ['P01']);
      assert.equal(page.data.board.recommendLine, undefined);
    }
  }
  assert.deepEqual(page.data.hints.map((item: any) => item.level), [1, 2, 3]);
  assert.equal(page.data.cards[0].body, '服务端第 1 级讲解');
  assert.match(page.data.cards[0].detail, /机动性/);
  assert.match(page.data.cards[1].detail, /P01/);
  assert.match(page.data.cards[2].detail, /P01 → P02/);
  assert.equal(page.data.board.recommendedFrom, 'P01');
  assert.equal(page.data.board.recommendedTo, 'P02');
  assert.ok(page.data.board.recommendLine);
  const unchangedPieces = structuredClone(page.data.board.pieces);
  page.selectHint({ detail: { level: 1 } });
  assert.equal(page.data.board.recommendLine, undefined);
  assert.equal(page.data.board.nodes.some((node: any) => node.focused), false);
  page.selectHint({ detail: { level: 3 } });
  assert.equal(page.data.board.recommendedTo, 'P02');
  page.selectHint({ detail: { level: 3 } });
  assert.equal(page.data.board.recommendLine, undefined);
  assert.deepEqual(page.data.board.pieces, unchangedPieces);
  assert.deepEqual(requests.map(row => [row.method, row.path]), [
    ['GET', '/api/v1/game/ai-real'],
    ['POST', '/api/v1/game/ai-real/coach/hint'],
    ['POST', '/api/v1/game/ai-real/coach/hint'],
    ['POST', '/api/v1/game/ai-real/coach/hint'],
  ]);
  assert.deepEqual(requests.slice(1).map(row => row.data), [
    { level: 1, expected_version: 6 },
    { level: 2, expected_version: 6 },
    { level: 3, expected_version: 6 },
  ]);

  page.continueAiGame();
  assert.ok(navigations.some(url =>
    url === '/pages/game/game?mode=ai&gameId=ai-real'));
  version = 7;
  page.onShow();
  await flush();
  assert.equal(page.data.gameVersion, 7);
  assert.deepEqual(page.data.hints, []);
  assert.equal(page.data.board.recommendLine, undefined);
  assert.equal(page.data.board.nodes.some((node: any) => node.focused), false);
  assert.equal(requests.at(-1)?.method, 'GET');
  assert.equal(requests.at(-1)?.path, '/api/v1/game/ai-real');
  page.onUnload();
});

test('coach page and card bind real state without demo explanation or fixed move', () => {
  const pageTs = readFileSync(new URL('../miniprogram/pages/coach/coach.ts', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../miniprogram/pages/coach/coach.wxml', import.meta.url), 'utf8');
  const card = readFileSync(new URL(
    '../miniprogram/components/coach-card/coach-card.wxml', import.meta.url), 'utf8');
  const combined = `${pageTs}\n${page}\n${card}`;
  assert.match(page, /chess-board/);
  assert.match(page, /cards/);
  assert.match(page, /gameVersion/);
  assert.match(pageTs, /hint\?\.hintText/);
  assert.match(pageTs, /hint\.focusTopics/);
  assert.match(pageTs, /hint\.candidateFromNodes/);
  assert.match(pageTs, /hint\.bestMove/);
  assert.doesNotMatch(combined, /UI 演示|演示提示|演示讲解|P09\s*→\s*P13|这一手虽然加强了中央控制/);
});
