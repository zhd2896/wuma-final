import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createWechatAccount, seedMiniAccount } = require('../scripts/device-account-e2e.cjs');

test('DevTools fixtures authenticate using the simulator WeChat code and share its expiring session', async () => {
  const previous = globalThis.fetch;
  const calls: any[] = [];
  const mini = { callWxMethod: async (name: string, ...args: unknown[]) => {
    calls.push([name, ...args]);
    if (name === 'login') return { code: 'real-simulator-code' };
  } };
  const session = { userId: 'u', token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' };
  globalThis.fetch = (async (url: string, options: any) => {
    assert.equal(url, 'https://backend.test/api/v1/auth/wechat');
    assert.deepEqual(JSON.parse(options.body), { code: 'real-simulator-code' });
    return { ok: true, json: async () => ({ code: 0, data: session }) };
  }) as typeof fetch;
  try {
    const account = await createWechatAccount('https://backend.test', mini);
    await seedMiniAccount(mini, 'https://backend.test/', account);
    assert.deepEqual(calls[1], ['setStorageSync', 'wuma:wechat-session:v1:https://backend.test', session]);
  } finally { globalThis.fetch = previous; }
});
