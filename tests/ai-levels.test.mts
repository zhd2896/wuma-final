import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { RuleEngine, createInitialGameState } from '../miniprogram/domain/index.ts';
registerHooks({ resolve(s, c, next) {
        try {
            return next(s, c);
        }
        catch (e) {
            if (s.startsWith('.') && c.parentURL && existsSync(new URL(`${s}.ts`, c.parentURL)))
                return next(new URL(`${s}.ts`, c.parentURL).href, c);
            throw e;
        }
    } });
const { createGameSettingsStore, DEFAULT_GAME_SETTINGS } = await import('../miniprogram/services/game-settings.ts');
test('legacy preferences keep all choices and gain STANDARD; all levels persist', () => {
    let saved: any = { version: 1, settings: { showNodeLabels: true, showLegalTargets: false, showCaptureNotice: false, vibrateOnAction: false, aiFirstPlayer: 'B' } };
    const store = createGameSettingsStore({ get: () => saved, set: (_k, v) => saved = v });
    assert.deepEqual(store.read(), { ...saved.settings, defaultAiLevel: 'STANDARD' });
    for (const defaultAiLevel of ['BEGINNER', 'STANDARD', 'ADVANCED'] as const) {
        store.write({ ...store.read(), defaultAiLevel });
        assert.equal(store.read().defaultAiLevel, defaultAiLevel);
    }
});
test('native picker string index emits selected difficulty and ignores invalid indexes', async () => {
    let definition: any;
    (globalThis as any).Component = (d: any) => definition = d;
    await import('../miniprogram/components/game-settings/game-settings.ts');
    const emitted: any[] = [];
    const instance = { ...definition.methods, properties: { settings: DEFAULT_GAME_SETTINGS }, triggerEvent: (_n: any, v: any) => emitted.push(v) };
    instance.onAiLevelChange({ detail: { value: '2' } });
    assert.equal(emitted[0].defaultAiLevel, 'ADVANCED');
    for (const value of ['bogus', '-1', '1.5', true])
        instance.onAiLevelChange({ detail: { value } });
    assert.equal(emitted.length, 1);
});
test('actual page uses next default on new/restart, keeps saved current label, and restores difficulty', async () => {
    let definition: any;
    (globalThis as any).Page = (d: any) => definition = d;
    const settings = { ...DEFAULT_GAME_SETTINGS, defaultAiLevel: 'BEGINNER' };
    const storage = new Map<string, any>([['wuma:game-settings:v1', { version: 1, settings }]]);
    const games = new Map<string, any>();
    const requests: any[] = [];
    (globalThis as any).wx = { getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }), getStorageSync: (k: string) => k.startsWith('wuma:wechat-session:') ? { token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' } : storage.get(k), setStorageSync: (k: string, v: any) => storage.set(k, v), removeStorageSync: (k: string) => storage.delete(k), showToast: () => { }, request: (o: any) => {
            const path = new URL(o.url).pathname;
            let game: any;
            if (o.method === 'POST' && path === '/api/v1/game') {
                requests.push(o.data);
                game = { game_id: `g${requests.length}`, version: 0, ply_count: 0, state: createInitialGameState({ firstPlayer: o.data.first_player }), mode: 'AI', human_player: 'A', ai_player: 'B', ai_level: o.data.ai_level };
                games.set(game.game_id, game);
            }
            else if (path.endsWith('/ai-move')) {
                game = games.get(path.split('/').at(-2)!);
                const move = RuleEngine.getAllLegalMoves(game.state)[0];
                const turn = RuleEngine.executeTurn(game.state, move);
                game.state = turn.state;
                game.version++;
                game.ply_count++;
                o.success({ statusCode: 200, data: { code: 0, data: { turn, search: { bestMove: move, scorePerspective: 'B', searchDepth: 1, thinkingTimeMs: 5, timedOut: false } } } });
                return;
            }
            else
                game = games.get(path.split('/').at(-1)!);
            o.success({ statusCode: 200, data: { code: 0, data: game } });
        } };
    await import('../miniprogram/pages/game/game.ts');
    const make = () => ({ ...definition, data: { ...definition.data }, setData(p: any) { this.data = { ...this.data, ...p }; } });
    const flush = async () => { for (let i = 0; i < 10; i++)
        await new Promise(r => setImmediate(r)); };
    const page = make();
    page.onLoad({ mode: 'ai' });
    await flush();
    assert.equal(requests[0].ai_level, 'BEGINNER');
    assert.equal(page.data.aiBName, '入门 AI · B');
    assert.equal(page.data.aiLevelLabel, '入门');
    page.onSettingsChange({ detail: { ...page.data.settings, defaultAiLevel: 'ADVANCED' } });
    await flush();
    assert.equal(requests.length, 1);
    assert.equal(page.data.aiState.aiLevel, 'BEGINNER');
    assert.equal(page.data.aiBName, '入门 AI · B');
    page.restartAiGame();
    await flush();
    assert.equal(requests[1].ai_level, 'ADVANCED');
    assert.equal(page.data.aiBName, '进阶 AI · B');
    assert.equal(storage.get('wuma:history:v1').records.find((r: any) => r.id === 'g2').aiLevel, 'ADVANCED');
    page.restartAiFirstGame();
    await flush();
    assert.equal(requests[2].first_player, 'B');
    assert.equal(requests[2].ai_level, 'ADVANCED');
    assert.equal(page.data.aiState.plyCount, 1);
    assert.equal(page.data.aiState.aiLevel, 'ADVANCED');
    page.onUnload();
    const resumed = make();
    resumed.onLoad({ mode: 'ai', gameId: 'g1' });
    await flush();
    assert.equal(requests.length, 3);
    assert.equal(resumed.data.aiState.aiLevel, 'BEGINNER');
    assert.equal(resumed.data.aiBName, '入门 AI · B');
    resumed.onUnload();
});
test('independent coach and replay context accept all saved AI levels', async () => {
    const { IndependentCoachController } = await import('../miniprogram/pages/coach/coach-controller.ts');
    const { requireReviewContext } = await import('../miniprogram/services/replay-contract.ts');
    for (const ai_level of ['BEGINNER', 'ADVANCED'] as const) {
        const game = { game_id: 'learn', version: 0, ply_count: 0, state: createInitialGameState(), mode: 'AI' as const, human_player: 'A' as const, ai_player: 'B' as const, ai_level };
        assert.equal(requireReviewContext(game, game.game_id).human_player, 'A');
        const controller = new IndependentCoachController({ api: { getGame: async () => game, getCoachHint: async () => { throw Error('unused'); } }, readActiveAiId: () => game.game_id, writeActiveAiId: () => { }, onChange: () => { } });
        await controller.enter();
        assert.equal(controller.snapshot.state, 'ready');
        controller.dispose();
    }
});
test('history displays real cloud/device levels and leaves unknown older metadata unlabeled', async () => {
    let definition: any;
    (globalThis as any).Page = (d: any) => definition = d;
    const state = createInitialGameState();
    (globalThis as any).wx = { getStorageSync: () => ({ version: 1, records: [{ id: 'device-ai', mode: 'ai', aiLevel: 'BEGINNER', startedAt: 1, updatedAt: 1, turns: 0, status: 'PLAYING', winner: null, winnerReason: null }] }), setStorageSync: () => { }, removeStorageSync: () => { } };
    await import('../miniprogram/pages/history/history.ts');
    const page = { ...definition, data: { ...definition.data }, cloud: [{ gameId: 'cloud-ai', mode: 'AI', aiLevel: 'ADVANCED', status: 'PLAYING', winner: null, startedAt: '2026-10-06', finishedAt: null, turns: 0 }, { gameId: 'legacy-ai', mode: 'AI', status: 'PLAYING', winner: null, startedAt: '2026-10-06', finishedAt: null, turns: 0 }], setData(p: any) { this.data = { ...this.data, ...p }; } };
    page.renderRows();
    const titles = Object.fromEntries(page.data.records.map((r: any) => [r.id, r.title]));
    assert.deepEqual(titles, { 'device-ai': 'AI 对弈 · 入门', 'cloud-ai': 'AI 对弈 · 进阶', 'legacy-ai': 'AI 对弈' });
});
