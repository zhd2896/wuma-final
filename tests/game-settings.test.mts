import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
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

const {
  DEFAULT_GAME_SETTINGS,
  GAME_SETTINGS_STORAGE_KEY,
  createGameSettingsStore,
  createWxGameSettingsStore,
  vibrateForSuccessfulAction,
} = await import('../miniprogram/services/game-settings.ts');

function memoryStorage(initial?: unknown) {
  const values = new Map<string, unknown>();
  if (initial !== undefined) values.set(GAME_SETTINGS_STORAGE_KEY, initial);
  const writes: unknown[] = [];
  return {
    values,
    writes,
    storage: {
      get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => {
        const copy = structuredClone(value);
        values.set(key, copy);
        writes.push(copy);
      },
    },
  };
}

test('game settings use safe defaults and persist versioned changes', () => {
  const memory = memoryStorage();
  const store = createGameSettingsStore(memory.storage);

  assert.deepEqual(store.read(), {
    showLegalTargets: true,
    showCaptureNotice: true,
    vibrateOnAction: true,
    aiFirstPlayer: 'A',
  });

  store.write({ ...store.read(), showLegalTargets: false, aiFirstPlayer: 'B' });

  assert.deepEqual(memory.values.get('wuma:game-settings:v1'), {
    version: 1,
    settings: {
      showLegalTargets: false,
      showCaptureNotice: true,
      vibrateOnAction: true,
      aiFirstPlayer: 'B',
    },
  });
  assert.equal(createGameSettingsStore(memory.storage).read().aiFirstPlayer, 'B');
});

test('damaged, partial, and wrongly typed stored settings are replaced with defaults', () => {
  const damagedValues = [
    'broken',
    { version: 2, settings: DEFAULT_GAME_SETTINGS },
    { version: 1, settings: { showLegalTargets: true } },
    { version: 1, settings: { ...DEFAULT_GAME_SETTINGS, showCaptureNotice: 'yes' } },
    { version: 1, settings: { ...DEFAULT_GAME_SETTINGS, aiFirstPlayer: 'C' } },
  ];

  for (const damaged of damagedValues) {
    const memory = memoryStorage(damaged);
    const result = createGameSettingsStore(memory.storage).read();
    assert.deepEqual(result, DEFAULT_GAME_SETTINGS);
    assert.deepEqual(memory.writes, [{ version: 1, settings: DEFAULT_GAME_SETTINGS }]);
  }
});

test('store reads and writes defensive copies', () => {
  const memory = memoryStorage();
  const store = createGameSettingsStore(memory.storage);
  const input = { ...DEFAULT_GAME_SETTINGS };
  store.write(input);
  (input as { showLegalTargets: boolean }).showLegalTargets = false;
  assert.equal(store.read().showLegalTargets, true);

  const first = store.read() as { showLegalTargets: boolean };
  first.showLegalTargets = false;
  assert.equal(store.read().showLegalTargets, true);
  assert.notEqual(store.read(), DEFAULT_GAME_SETTINGS);
});

test('wx store uses the versioned storage key', () => {
  const values = new Map<string, unknown>();
  const previousWx = (globalThis as any).wx;
  (globalThis as any).wx = {
    getStorageSync: (key: string) => values.get(key),
    setStorageSync: (key: string, value: unknown) => { values.set(key, structuredClone(value)); },
  };
  try {
    const store = createWxGameSettingsStore();
    store.write({ ...DEFAULT_GAME_SETTINGS, vibrateOnAction: false });
    assert.equal((values.get(GAME_SETTINGS_STORAGE_KEY) as any).settings.vibrateOnAction, false);
  } finally {
    (globalThis as any).wx = previousWx;
  }
});

test('successful-action vibration respects settings and never breaks the operation', () => {
  const previousWx = (globalThis as any).wx;
  let calls = 0;
  try {
    (globalThis as any).wx = { vibrateShort: () => { calls += 1; } };
    assert.doesNotThrow(() => vibrateForSuccessfulAction({
      ...DEFAULT_GAME_SETTINGS, vibrateOnAction: false,
    }));
    assert.equal(calls, 0);

    assert.doesNotThrow(() => vibrateForSuccessfulAction(DEFAULT_GAME_SETTINGS));
    assert.equal(calls, 1);

    (globalThis as any).wx = {};
    assert.doesNotThrow(() => vibrateForSuccessfulAction(DEFAULT_GAME_SETTINGS));
    (globalThis as any).wx = { vibrateShort: () => { throw new Error('unsupported'); } };
    assert.doesNotThrow(() => vibrateForSuccessfulAction(DEFAULT_GAME_SETTINGS));
  } finally {
    (globalThis as any).wx = previousWx;
  }
});

test('game settings component emits a complete settings object for every control', async () => {
  let definition: any;
  const previousComponent = (globalThis as any).Component;
  (globalThis as any).Component = (value: unknown) => { definition = value; };
  try {
    await import('../miniprogram/components/game-settings/game-settings.ts');
  } finally {
    (globalThis as any).Component = previousComponent;
  }

  assert.equal(definition.properties.showAiFirstPlayer.value, true);
  assert.deepEqual(definition.properties.settings.value, DEFAULT_GAME_SETTINGS);
  const base = { ...DEFAULT_GAME_SETTINGS };
  for (const [method, detail, changedKey, expected] of [
    ['onLegalTargetsChange', { value: false }, 'showLegalTargets', false],
    ['onCaptureNoticeChange', { value: false }, 'showCaptureNotice', false],
    ['onVibrationChange', { value: false }, 'vibrateOnAction', false],
    ['onAiFirstPlayerChange', { value: 'B' }, 'aiFirstPlayer', 'B'],
  ] as const) {
    let emitted: unknown;
    const component = {
      properties: { settings: base },
      triggerEvent: (name: string, value: unknown) => {
        assert.equal(name, 'change');
        emitted = value;
      },
      emitChange: definition.methods.emitChange,
    };
    definition.methods[method].call(component, { detail });
    assert.deepEqual(emitted, { ...base, [changedKey]: expected });
  }
});

test('component template contains three switches, one AI radio group, and no controller access', () => {
  const root = new URL('../miniprogram/components/game-settings/', import.meta.url);
  const wxml = readFileSync(new URL('game-settings.wxml', root), 'utf8');
  const source = readFileSync(new URL('game-settings.ts', root), 'utf8');
  const manifest = JSON.parse(readFileSync(new URL('game-settings.json', root), 'utf8'));

  assert.equal((wxml.match(/<switch\b/g) ?? []).length, 3);
  assert.match(wxml, /<radio-group\b/);
  assert.match(wxml, /showAiFirstPlayer/);
  assert.deepEqual(manifest, { component: true });
  assert.doesNotMatch(source, /Controller|pages\/game|pages\/online/);
});
