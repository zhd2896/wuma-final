import { getApiBaseUrl } from '../config/api';
import { normalizeApiRoot } from '../config/api-root';

const LEGACY_KEY = 'wuma:device-account-token:v1';
const SESSION_KEY = 'wuma:wechat-session:v1';
const pending = new Map<string, Promise<string>>();
const TOKEN = /^[0-9a-f]{64}$/;

export class WechatLoginError extends Error {
  constructor(message: string) { super(message); this.name = 'WechatLoginError'; }
}

interface WechatSession { token: string; expiresAt: string; }

function readSession(root: string): WechatSession | null {
  const saved = wx.getStorageSync(`${SESSION_KEY}:${root}`) as Partial<WechatSession> | null;
  return saved && typeof saved.token === 'string' && TOKEN.test(saved.token) &&
    typeof saved.expiresAt === 'string' && Date.parse(saved.expiresAt) > Date.now() + 30000
    ? saved as WechatSession : null;
}

export function getSavedWechatToken(baseUrl = getApiBaseUrl()): string | null {
  return readSession(baseUrl.replace(/\/$/, ''))?.token ?? null;
}

export function hasWechatSession(): boolean {
  try { return getSavedWechatToken() !== null; } catch { return false; }
}

export function logoutWechat(baseUrl = getApiBaseUrl()): void {
  wx.removeStorageSync(`${SESSION_KEY}:${baseUrl.replace(/\/$/, '')}`);
}

export function clearWechatSession(baseUrl: string, rejectedToken: string): void {
  const root = normalizeApiRoot(baseUrl, false);
  const key = `${SESSION_KEY}:${root}`;
  const saved = wx.getStorageSync(key) as Partial<WechatSession> | null;
  if (saved?.token === rejectedToken) wx.removeStorageSync(key);
}

// Keep the exported name for existing API clients; credentials now belong to WeChat users.
export function getDeviceToken(baseUrl = getApiBaseUrl()): Promise<string> {
  const root = normalizeApiRoot(baseUrl, false);
  const inflight = pending.get(root);
  if (inflight) return inflight;
  const saved = readSession(root);
  if (saved) return Promise.resolve(saved.token);
  // Defer execution until pending is registered, even when test adapters reply synchronously.
  const created = Promise.resolve().then(async () => {
    const code = await new Promise<string>((resolve, reject) => {
      wx.login({ timeout: 10000,
        success: result => result.code ? resolve(result.code)
          : reject(new WechatLoginError('微信登录失败，请重试')),
        fail: () => reject(new WechatLoginError('微信登录失败，请检查网络后重试')),
      });
    });
    const legacy = wx.getStorageSync(`${LEGACY_KEY}:${root}`);
    return new Promise<string>((resolve, reject) => {
      wx.request({
        url: `${root}/api/v1/auth/wechat`, method: 'POST', timeout: 15000,
        data: { code, ...(typeof legacy === 'string' && TOKEN.test(legacy)
          ? { device_token: legacy } : {}) },
        success: response => {
          const envelope = response.data as { code?: unknown;
            data?: { token?: unknown; expiresAt?: unknown } } | null;
          const token = envelope?.data?.token;
          const expiresAt = envelope?.data?.expiresAt;
          if (response.statusCode !== 200 || envelope?.code !== 0 ||
              typeof token !== 'string' || !TOKEN.test(token) ||
              typeof expiresAt !== 'string' || Date.parse(expiresAt) <= Date.now() + 30000 ||
              !Number.isFinite(Date.parse(expiresAt))) {
            reject(new WechatLoginError(envelope?.code === 'WECHAT_NOT_CONFIGURED'
              ? '微信登录服务尚未配置，请联系管理员'
              : envelope?.code === 'REMOTE_ACCOUNT_CONFLICT'
                ? '两个账号占同一棋局的不同席位，无法合并，请保留原记录和原账号'
                : envelope?.code === 'LOCAL_IMPORT_ACCOUNT_CONFLICT'
                  ? '两账号中同编号棋谱指向不同棋局，无法合并，请保留原记录和原账号'
                  : '微信登录暂时不可用，请稍后重试'));
            return;
          }
          try { wx.setStorageSync(`${SESSION_KEY}:${root}`, { token, expiresAt }); }
          catch { reject(new WechatLoginError('登录状态保存失败，请重试')); return; }
          // Only clear the migration credential after the new session is durably saved.
          try { wx.removeStorageSync(`${LEGACY_KEY}:${root}`); } catch { /* retry is safe */ }
          resolve(token);
        },
        fail: () => reject(new WechatLoginError('微信登录失败，请检查网络后重试')),
      });
    });
  });
  const task = created.then(token => { pending.delete(root); return token; }, error => {
    pending.delete(root); throw error;
  });
  pending.set(root, task);
  return task;
}
