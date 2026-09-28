import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { RuleEngine, createInitialGameState } from '../miniprogram/domain/index.ts';
import type { GameState } from '../miniprogram/domain/index.ts';

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

test('existing AI page displays server game, thinking, AI move and AI-first restart', async () => {
  let state: GameState = createInitialGameState();
  let stored: string | null = null;
  let creates = 0;
  let aiCalls = 0;
  let analysisCalls = 0;
  let waitForAi: (() => void) | null = null;
  let pageDefinition: Record<string, any> | null = null;
  (globalThis as any).Page = (definition: Record<string, any>) => { pageDefinition = definition; };
  (globalThis as any).wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getStorageSync: (key: string) => key.startsWith('wuma:device-account-token:')
      ? 'a'.repeat(64) : stored,
    setStorageSync: (_key: string, value: string) => { stored = value; },
    removeStorageSync: () => { stored = null; },
    showToast: () => {},
    request: (options: any) => {
      const url = new URL(options.url);
      const reply = (data: unknown) => options.success({ statusCode: 200,
        data: { code: 0, message: 'success', data } });
      const game = () => ({ game_id: `ai${creates}`, state, mode: 'AI',
        human_player: 'A', ai_player: 'B', ai_level: 'STANDARD' });
      if (url.pathname === '/api/v1/game' && options.method === 'POST') {
        assert.equal(options.data.mode, 'AI');
        creates++;
        state = createInitialGameState({ firstPlayer: options.data.first_player });
        reply(game());
      } else if (url.pathname.endsWith('/legal-moves')) {
        reply({ moves: RuleEngine.getAllLegalMoves(state).filter(
          move => move.from === url.searchParams.get('from_node')) });
      } else if (url.pathname.endsWith('/ai-move')) {
        aiCalls++;
        const finish = () => {
          const move = RuleEngine.getAllLegalMoves(state)[0];
          const turn = RuleEngine.executeTurn(state, move);
          state = turn.state;
          reply({ turn, search: { bestMove: move, scorePerspective: 'B',
            searchDepth: 1, thinkingTimeMs: 5, timedOut: false } });
        };
        if (aiCalls === 1) waitForAi = finish;
        else finish();
      } else if (url.pathname.endsWith('/move')) {
        const turn = RuleEngine.executeTurn(state,
          { from: options.data.from_node, to: options.data.to_node });
        state = turn.state;
        reply({ turn });
      } else if (url.pathname === '/api/v1/ai/analyze') {
        analysisCalls++;
        assert.equal(options.data.game_id, `ai${creates}`);
        reply({ game_id: `ai${creates}`, game_version: aiCalls + creates - 1,
          ...analyzePosition(state, { maxDepth: 1, timeLimitMs: 1000, now: () => 0 }) });
      } else if (options.method === 'GET') reply(game());
      else throw new Error(`Unexpected request ${options.url}`);
    },
  };
  await import('../miniprogram/pages/game/game.ts');
  const definition = pageDefinition!;
  const page = { ...definition, data: { ...definition.data },
    setData(patch: Record<string, unknown>) { this.data = { ...this.data, ...patch }; } };
  const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
  page.onLoad({ mode: 'ai' });
  await flush();
  assert.equal(page.data.mode, 'ai');
  assert.equal(stored, 'ai1');
  assert.equal(page.data.aiState.humanPlayer, 'A');
  assert.equal(page.data.board.pieces.length, 10);
  page.onNode({ detail: { id: 'P01' } });
  await flush();
  assert.equal(page.data.board.nodes.find((node: any) => node.id === 'P02').legalTarget, true);
  page.onNode({ detail: { id: 'P02' } });
  await flush();
  assert.equal(page.data.aiState.isAiThinking, true);
  assert.equal(page.data.aiState.gameState.current_player, 'B');
  page.onNode({ detail: { id: 'P05' } });
  await flush();
  assert.equal(page.data.aiState.selectedNode, null);
  waitForAi!();
  await flush();
  assert.equal(page.data.aiState.isAiThinking, false);
  assert.equal(page.data.aiState.gameState.current_player, 'A');
  assert.equal(page.data.aiState.lastSearch.searchDepth, 1);
  const beforeAnalysis = structuredClone(page.data.aiState.gameState);
  page.onAction({ currentTarget: { dataset: { action: 'analysis' } } });
  await flush();
  assert.equal(analysisCalls, 1);
  assert.deepEqual(page.data.aiState.gameState, beforeAnalysis);
  assert.ok(page.data.aiState.analysis.candidateMoves.length);
  assert.ok(page.data.aiAnalysisBreakdown.length);
  assert.equal(page.data.board.recommendedFrom, page.data.aiState.lastMove.from);
  assert.equal(page.data.board.recommendedTo, page.data.aiState.lastMove.to);
  page.restartAiFirstGame();
  await flush();
  assert.equal(creates, 2);
  assert.equal(aiCalls, 2);
  assert.equal(page.data.aiState.gameState.current_player, 'A');
  assert.equal(page.data.aiState.analysis, null);
  page.onUnload();
  const wxml = readFileSync(new URL('../miniprogram/pages/game/game.wxml', import.meta.url), 'utf8');
  assert.match(wxml, /<chess-board board="{{board}}" bind:node="onNode"/);
  assert.match(wxml, /<ai-thinking \/>/);
  assert.match(wxml, /正在分析局面/);
  assert.match(wxml, /aiState\.analysis\.candidateMoves/);
  assert.match(wxml, /side="{{mode == 'ai' && aiState\.aiPlayer == 'A' \? 'ai' : 'human'}}"/);
  assert.match(wxml, /side="{{mode == 'ai' && aiState\.aiPlayer == 'B' \? 'ai' : 'human'}}"/);
  const thinking = readFileSync(new URL('../miniprogram/components/ai-thinking/ai-thinking.wxml', import.meta.url), 'utf8');
  assert.match(thinking, /AI 正在思考/);
});
