import { getApiBaseUrl } from '../config/api';
import { getSavedWechatToken } from './device-auth';
import { ApiError, createApiClient } from './api-client';
import type { ApiClient } from './api-client';
import { createAccountApi } from './account-api';
import { createWxDeviceHistoryStore } from './device-history';
import type { DeviceHistoryEntry, DeviceHistoryStore, PendingLocalSync } from './device-history';
import type { GameDto } from './api-contract';

interface SyncContext { readonly root: string; readonly token: string | null; }
interface SyncOptions {
  readonly store?: DeviceHistoryStore;
  readonly onPending?: () => void;
  readonly context?: () => SyncContext;
  readonly client?: (context: SyncContext) => ApiClient;
  readonly profile?: (client: ApiClient) => Promise<{ readonly id: string }>;
}
const inflight = new Set<string>();
const currentContext = (): SyncContext => {
  const root = getApiBaseUrl().replace(/\/$/, '');
  return { root, token: getSavedWechatToken(root) };
};

/** Save an unknown-result record before the first byte is sent; every retry uses its exact body. */
export async function syncLocalScore(id: string, options: SyncOptions = {}): Promise<DeviceHistoryEntry> {
  if (inflight.has(id)) throw new Error('棋谱正在同步，请等待结果');
  inflight.add(id);
  try {
    const store = options.store ?? createWxDeviceHistoryStore();
    const context = options.context ?? currentContext;
    const captured = context();
    if (!captured.token) throw new ApiError('AUTH_REQUIRED', 401);
    const assertContext = () => {
      const current = context();
      if (current.root !== captured.root || current.token !== captured.token) {
        throw new Error('同步期间账号或服务地址已改变，请重新点击同步');
      }
    };
    // Token is captured for both identity lookup and import; it is never persisted in the score.
    const client = options.client?.(captured) ?? createApiClient({ baseUrl: captured.root,
      deviceTokenProvider: async () => { assertContext(); return captured.token!; } });
    const owner = await (options.profile ?? (api => createAccountApi(api).profile()))(client);
    assertContext();
    const row = store.beginLocalSync(id, owner.id, captured.root);
    const pending = row.localSync as PendingLocalSync;
    options.onPending?.();
    assertContext();
    const response = await client.request<GameDto>('POST', '/api/v1/game/import-local',
      pending.payload, 120000);
    if (!response || response.mode !== 'LOCAL' || !/^[0-9a-f]{32}$/.test(response.game_id) ||
        !Number.isInteger(response.ply_count) || response.ply_count < 0 ||
        typeof response.version !== 'number' || !Number.isInteger(response.version) || response.version < response.ply_count) {
      throw new ApiError('INVALID_GAME_RESPONSE', 502);
    }
    // Persist the known result for the captured owner even if the visible session changed.
    // A failed write leaves the original pending record intact for idempotent recovery.
    const linked = store.linkLocalSync(id, pending, response.game_id);
    assertContext();
    return linked;
  } finally { inflight.delete(id); }
}
