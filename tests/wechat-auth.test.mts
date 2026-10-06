import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';

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


const { getDeviceToken, clearWechatSession } = await import('../miniprogram/services/device-auth.ts');
const { createApiClient } = await import('../miniprogram/services/api-client.ts');

test('account merge conflicts keep legacy records and credentials and permit explicit retry', async () => {
  for (const code of ['REMOTE_ACCOUNT_CONFLICT', 'LOCAL_IMPORT_ACCOUNT_CONFLICT']) {
    const root = `https://${code.toLowerCase().replaceAll('_', '-')}.test`;
    const env = environment(root); env.storage.set(env.oldKey, 'a'.repeat(64));
    (globalThis as any).wx.request = (o: any) => o.success({ statusCode: 409, data: { code } });
    await assert.rejects(getDeviceToken(root), /无法合并.*保留原记录/);
    assert.equal(env.storage.get(env.oldKey), 'a'.repeat(64)); assert.equal(env.storage.has(env.key), false);
    (globalThis as any).wx.request = (o: any) => o.success({ statusCode: 200, data: { code: 0, data: {
      token: 'b'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' } } });
    assert.equal(await getDeviceToken(root), 'b'.repeat(64)); assert.equal(env.storage.has(env.oldKey), false);
  }
});

function environment(root: string) {
  const storage = new Map<string, any>();
  const calls: any[] = [];
  let logins = 0;
  (globalThis as any).getCurrentPages = () => [{ route: 'pages/profile/profile', options: {} }];
  (globalThis as any).wx = {
    reLaunch: (options: any) => options.complete?.(),
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
    login: (options: any) => { logins++; options.success({ code: 'one-time-code' }); },
    request: (options: any) => {
      calls.push(options);
      options.success({ statusCode: 200, data: { code: 0, data: {
        userId: 'wechat-user', token: 'b'.repeat(64), expiresAt: new Date(Date.now() + 3600000).toISOString(),
      } } });
    },
  };
  return { storage, calls, logins: () => logins,
    oldKey: `wuma:device-account-token:v1:${root}`,
    key: `wuma:wechat-session:v1:${root}` };
}

test('WeChat login merges concurrent requests and sends the old anonymous credential once', async () => {
  const root = 'https://migration.test';
  const env = environment(root);
  env.storage.set(env.oldKey, 'a'.repeat(64));
  const values = await Promise.all([getDeviceToken(root), getDeviceToken(root + '/')]);
  assert.deepEqual(values, ['b'.repeat(64), 'b'.repeat(64)]);
  assert.equal(env.logins(), 1);
  assert.equal(env.calls[0].url, root + '/api/v1/auth/wechat');
  assert.deepEqual(env.calls[0].data, { code: 'one-time-code', device_token: 'a'.repeat(64) });
  assert.equal(env.storage.has(env.oldKey), false);
  assert.equal(await getDeviceToken(root), 'b'.repeat(64));
  assert.equal(env.logins(), 1);
});

test('expired sessions login again; failure preserves the anonymous migration credential', async () => {
  const root = 'https://expiry.test';
  const env = environment(root);
  env.storage.set(env.key, { token: 'a'.repeat(64), expiresAt: '2000-01-01T00:00:00Z' });
  env.storage.set(env.oldKey, 'c'.repeat(64));
  (globalThis as any).wx.login = (options: any) => options.fail({ errMsg: 'failure' });
  await assert.rejects(getDeviceToken(root));
  assert.equal(env.storage.get(env.oldKey), 'c'.repeat(64));
  (globalThis as any).wx.login = (options: any) => options.success({ code: 'fresh-code' });
  assert.equal(await getDeviceToken(root), 'b'.repeat(64));
});

test('late invalidation cannot delete a newer concurrent session', async () => {
  const root = 'https://invalidation.test';
  const env = environment(root);
  await getDeviceToken(root);
  clearWechatSession(root, 'a'.repeat(64));
  assert.equal(env.storage.get(env.key).token, 'b'.repeat(64));
  clearWechatSession(root, 'b'.repeat(64));
  assert.equal(env.storage.has(env.key), false);
});

test('expired server login returns to login page without replaying a business mutation', async () => {
  const root = 'https://api-retry.test';
  const env = environment(root);
  env.storage.set(env.key, { token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' });
  const destinations: string[] = [];
  (globalThis as any).wx.reLaunch = ({ url, complete }: any) => { destinations.push(url); complete?.(); };
  let business = 0;
  (globalThis as any).wx.request = (options: any) => {
    business++;
    assert.deepEqual(options.data, { expected_version: 2 });
    options.success({ statusCode: 401, data: { code: 'AUTH_INVALID' } });
  };
  await assert.rejects(createApiClient({ baseUrl: root }).request('POST', '/api/v1/game/g/ai-move', { expected_version: 2 }));
  assert.equal(business, 1);
  assert.equal(env.logins(), 0);
  assert.equal(env.storage.has(env.key), false);
  assert.equal(destinations.length, 1);
});

test('403 ownership failures do not login or replay a business mutation', async () => {
  const root = 'https://forbidden.test';
  const env = environment(root);
  env.storage.set(env.key, { token: 'a'.repeat(64), expiresAt: new Date(Date.now() + 3600000).toISOString() });
  let calls = 0;
  (globalThis as any).wx.request = (options: any) => {
    calls++;
    options.success({ statusCode: 403, data: { code: 'AUTH_FORBIDDEN' } });
  };
  await assert.rejects(createApiClient({ baseUrl: root }).request('POST', '/api/v1/game/g/move', {}),
    (error: any) => error.code === 'AUTH_FORBIDDEN');
  assert.equal(calls, 1);
  assert.equal(env.logins(), 0);
});

test('late 401 from an old session does not navigate away from a newer valid session', async () => {
  const root = 'https://late-new-session.test';
  const env = environment(root);
  env.storage.set(env.key, { token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' });
  const destinations: string[] = [];
  (globalThis as any).wx.reLaunch = ({ url, complete }: any) => { destinations.push(url); complete?.(); };
  let finish: ((response: any) => void) | undefined;
  let requests = 0;
  (globalThis as any).wx.request = (options: any) => { requests++; finish = options.success; };
  const oldRequest = createApiClient({ baseUrl: root }).request('GET', '/api/v1/me/profile');
  const outcome = assert.rejects(oldRequest, (error: any) => error.code === 'AUTH_INVALID');
  await new Promise(resolve => setImmediate(resolve));
  env.storage.set(env.key, { token: 'b'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' });
  finish!({ statusCode: 401, data: { code: 'AUTH_INVALID' } });
  await outcome;
  assert.equal(env.storage.get(env.key).token, 'b'.repeat(64));
  assert.deepEqual(destinations, []);
  assert.equal(requests, 1);
});


test('failed storage and malformed server sessions preserve migration data for retry', async () => {
  for (const mode of ['storage', 'invalid']) {
    const root = `https://${mode}.test`;
    const env = environment(root);
    env.storage.set(env.oldKey, 'a'.repeat(64));
    if (mode === 'storage') (globalThis as any).wx.setStorageSync = () => { throw new Error('full'); };
    else (globalThis as any).wx.request = (options: any) => options.success({ statusCode: 200,
      data: { code: 0, data: { token: 'b'.repeat(64), expiresAt: 'invalid-date' } } });
    await assert.rejects(getDeviceToken(root));
    assert.equal(env.storage.get(env.oldKey), 'a'.repeat(64));
    assert.equal(env.storage.has(env.key), false);
  }
});
