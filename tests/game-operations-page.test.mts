import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

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

test('local page persists moves, confirms undo and resignation separately, and honors settings', async () => {
  const storage = new Map<string, unknown>();
  storage.set('wuma:game-settings:v1', { version: 1, settings: {
    showLegalTargets: false, showCaptureNotice: false,
    vibrateOnAction: true, aiFirstPlayer: 'B',
  } });
  const toasts: string[] = [];
  let vibrations = 0;
  let pageDefinition: Record<string, any> | null = null;
  (globalThis as any).Page = (definition: Record<string, any>) => { pageDefinition = definition; };
  (globalThis as any).wx = {
    getStorageSync: (key: string) => storage.get(key) ?? '',
    setStorageSync: (key: string, value: unknown) => storage.set(key, structuredClone(value)),
    removeStorageSync: (key: string) => storage.delete(key),
    showToast: ({ title }: { title: string }) => { toasts.push(title); },
    vibrateShort: () => { vibrations += 1; },
    navigateTo: () => {},
  };
  await import('../miniprogram/pages/game/game.ts');
  const definition = pageDefinition!;
  const page: any = { ...definition, data: { ...definition.data },
    setData(patch: Record<string, unknown>) { this.data = { ...this.data, ...patch }; } };

  page.onLoad({ mode: 'local' });
  assert.equal(page.data.settings.aiFirstPlayer, 'B');
  page.onNode({ detail: { id: 'P01' } });
  assert.equal(page.data.localSession.legalDestinations.length > 0, true);
  assert.equal(page.data.board.nodes.some((node: any) => node.legalTarget), false);
  page.onNode({ detail: { id: 'P02' } });
  assert.equal(page.data.localTurns, 1);
  assert.equal(vibrations, 1);

  page.undo();
  assert.equal(page.data.showUndoConfirm, true);
  assert.equal(page.data.showResign, false);
  page.confirmUndo();
  assert.equal(page.data.localTurns, 0);
  assert.equal(page.data.localSession.gameState.board.occupancy.P01, 'A');
  assert.equal(page.data.localSession.undoFrame, null);
  assert.equal(vibrations, 2);
  page.undo();
  assert.match(toasts.at(-1)!, /没有可悔/);

  page.onNode({ detail: { id: 'P01' } });
  page.onNode({ detail: { id: 'P02' } });
  page.resign();
  assert.equal(page.data.showResign, true);
  assert.equal(page.data.showUndoConfirm, false);
  page.confirmResign();
  assert.equal(page.data.localSession.gameState.game_status, 'FINISHED');
  assert.equal(page.data.localSession.gameState.winner, 'A');
  assert.equal(page.data.localSession.gameState.winner_reason, 'RESIGN');
  assert.equal(vibrations, 4);

  const { createWxDeviceHistoryStore } = await import('../miniprogram/services/device-history.ts');
  const saved = createWxDeviceHistoryStore().get(page.data.localGameId)!;
  assert.equal(saved.status, 'FINISHED');
  assert.equal(saved.winnerReason, 'RESIGN');
  assert.equal(saved.localUndoFrame, null);

  const changed = { ...page.data.settings, showLegalTargets: true, aiFirstPlayer: 'A' };
  page.onSettingsChange({ detail: changed });
  assert.deepEqual(page.data.settings, changed);
  assert.deepEqual((storage.get('wuma:game-settings:v1') as any).settings, changed);
  let restartedWith: string | null = null;
  page.setData({ mode: 'ai' });
  page.aiController = { restart: (first: string) => { restartedWith = first; } };
  page.restartAiGame();
  assert.equal(restartedWith, 'A');

  const retried: string[] = [];
  page.aiController = { retry: (first: string) => { retried.push(`ai:${first}`); },
    enter: () => { retried.push('ai:refresh'); } };
  page.remoteController = { retry: () => { retried.push('remote'); },
    enter: () => { retried.push('remote:refresh'); } };
  page.retryAiGame();
  page.retryRemoteGame();
  assert.deepEqual(retried, ['ai:A', 'remote']);
});

test('game page exposes real operation controls, shared settings, and separate dialogs', () => {
  const root = new URL('../miniprogram/pages/game/', import.meta.url);
  const wxml = readFileSync(new URL('game.wxml', root), 'utf8');
  const manifest = JSON.parse(readFileSync(new URL('game.json', root), 'utf8'));

  assert.match(wxml, /id="action-resign"/);
  assert.match(wxml, /visible="\{\{showUndoConfirm\}\}"[^>]*title="确认悔棋？"/);
  assert.match(wxml, /visible="\{\{showResign\}\}"[^>]*title="确认结束对局？"/);
  assert.match(wxml, /<game-settings\b[^>]*settings="\{\{settings\}\}"[^>]*bind:change="onSettingsChange"/);
  assert.equal(manifest.usingComponents['game-settings'],
    '../../components/game-settings/game-settings');
  assert.doesNotMatch(wxml, /UI 演示模式|演示对局已结束/);
});
