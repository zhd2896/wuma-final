import type { Player } from '../domain/index';

export const GAME_SETTINGS_STORAGE_KEY = 'wuma:game-settings:v1';

export interface GameSettings {
  readonly showNodeLabels: boolean;
  readonly showLegalTargets: boolean;
  readonly showCaptureNotice: boolean;
  readonly vibrateOnAction: boolean;
  readonly aiFirstPlayer: Player;
}

export const DEFAULT_GAME_SETTINGS: GameSettings = Object.freeze({
  showNodeLabels: false,
  showLegalTargets: true,
  showCaptureNotice: true,
  vibrateOnAction: true,
  aiFirstPlayer: 'A',
});

export interface GameSettingsStorage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export interface GameSettingsStore {
  read(): GameSettings;
  write(settings: GameSettings): void;
}

interface StoredGameSettings {
  readonly version: 1;
  readonly settings: GameSettings;
}

function copySettings(settings: GameSettings): GameSettings {
  return {
    showNodeLabels: settings.showNodeLabels ?? false,
    showLegalTargets: settings.showLegalTargets,
    showCaptureNotice: settings.showCaptureNotice,
    vibrateOnAction: settings.vibrateOnAction,
    aiFirstPlayer: settings.aiFirstPlayer,
  };
}

function isGameSettings(value: unknown): value is GameSettings {
  if (!value || typeof value !== 'object') return false;
  const settings = value as Partial<GameSettings>;
  return typeof settings.showLegalTargets === 'boolean' &&
    (settings.showNodeLabels === undefined || typeof settings.showNodeLabels === 'boolean') &&
    typeof settings.showCaptureNotice === 'boolean' &&
    typeof settings.vibrateOnAction === 'boolean' &&
    (settings.aiFirstPlayer === 'A' || settings.aiFirstPlayer === 'B');
}

function envelope(settings: GameSettings): StoredGameSettings {
  return { version: 1, settings: copySettings(settings) };
}

export function createGameSettingsStore(storage: GameSettingsStorage): GameSettingsStore {
  return {
    read: () => {
      const stored = storage.get(GAME_SETTINGS_STORAGE_KEY);
      if (stored === undefined || stored === null || stored === '') {
        return copySettings(DEFAULT_GAME_SETTINGS);
      }
      if (typeof stored === 'object' &&
          (stored as Partial<StoredGameSettings>).version === 1 &&
          isGameSettings((stored as Partial<StoredGameSettings>).settings)) {
        return copySettings((stored as StoredGameSettings).settings);
      }
      const defaults = copySettings(DEFAULT_GAME_SETTINGS);
      storage.set(GAME_SETTINGS_STORAGE_KEY, envelope(defaults));
      return defaults;
    },
    write: settings => {
      if (!isGameSettings(settings) || typeof settings.showNodeLabels !== 'boolean') {
        throw new Error('Invalid game settings');
      }
      storage.set(GAME_SETTINGS_STORAGE_KEY, envelope(settings));
    },
  };
}

export function createWxGameSettingsStore(): GameSettingsStore {
  return createGameSettingsStore({
    get: key => wx.getStorageSync(key),
    set: (key, value) => { wx.setStorageSync(key, value); },
  });
}

export function vibrateForSuccessfulAction(settings: GameSettings): void {
  if (!settings.vibrateOnAction || typeof wx === 'undefined') return;
  const vibrate = (wx as unknown as {
    vibrateShort?: (options: { type: 'light'; fail: () => void }) => unknown;
  }).vibrateShort;
  if (typeof vibrate !== 'function') return;
  try {
    const result = vibrate.call(wx, { type: 'light', fail: () => undefined });
    if (result && typeof result === 'object' &&
        typeof (result as { catch?: unknown }).catch === 'function') {
      (result as Promise<unknown>).catch(() => undefined);
    }
  } catch {
    // Vibration is optional feedback and must never affect a successful action.
  }
}
