import { getApiBaseUrl } from '../config/api';

const TOKEN_KEY = 'wuma:device-account-token:v1';
const pending = new Map<string, Promise<string>>();

export function getDeviceToken(baseUrl = getApiBaseUrl()): Promise<string> {
  const root = baseUrl.replace(/\/$/, '');
  const key = `${TOKEN_KEY}:${root}`;
  const saved = wx.getStorageSync(key);
  if (typeof saved === 'string' && /^[0-9a-f]{64}$/.test(saved)) return Promise.resolve(saved);
  const inflight = pending.get(root);
  if (inflight) return inflight;
  const created = new Promise<string>((resolve, reject) => {
    wx.request({
      url: `${root}/api/v1/auth/device`,
      method: 'POST', timeout: 10000,
      success: response => {
        const envelope = response.data as { code?: unknown; data?: { token?: unknown } } | null;
        const token = envelope?.data?.token;
        if (response.statusCode !== 200 || envelope?.code !== 0 ||
            typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
          reject(new Error('设备账号创建失败'));
          return;
        }
        try { wx.setStorageSync(key, token); resolve(token); }
        catch { reject(new Error('设备账号保存失败')); }
      },
      fail: () => reject(new Error('设备账号创建失败')),
    });
  });
  const task = created.then(token => { pending.delete(root); return token; }, error => {
    pending.delete(root); throw error;
  });
  pending.set(root, task);
  return task;
}
