const assert = require('node:assert/strict');
const { test } = require('node:test');
const { requireTestDatabase, timed } = require('./game-operations-devtool-e2e.cjs');
test('requires an explicit isolated MySQL test database', () => {
  for (const value of [undefined, '', 'mysql+pymysql://u:p@localhost/wuma',
    'sqlite:///wuma_test', 'mysql://u:p@localhost/wuma_test?database=production']) {
    assert.throws(() => requireTestDatabase(value), /isolated MySQL/);
  }
  assert.equal(requireTestDatabase('mysql+pymysql://u:p@127.0.0.1/wuma_test'), 'wuma_test');
});
test('accepts common connection charset and timeouts', () => {
  assert.equal(requireTestDatabase('mysql+pymysql://u:p@localhost/wuma_test?charset=utf8mb4&connect_timeout=5'), 'wuma_test');
});
test('invalid database errors do not disclose credentials', () => {
  assert.throws(() => requireTestDatabase('mysql://secret:password@localhost/prod'), error =>
    !error.message.includes('secret') && !error.message.includes('password'));
});
test('timeout rejects with the blocked operation and duration', async () => {
  await assert.rejects(timed(new Promise(() => {}), 'IDE connection', 10), /IDE connection timed out after 10 ms/);
});
test('an assertion failure survives the timeout wrapper', async () => {
  const failure = new Error('authority differs');
  await assert.rejects(timed(Promise.reject(failure), 'API read', 50), error => error === failure);
});
const vm = require('node:vm');
const { main } = require('./game-operations-devtool-e2e.cjs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

async function failingLocalHarness(options = {}) {
  const originalSettings = Object.hasOwn(options, 'originalSettings') ? options.originalSettings : true;
  const { destination, writeDefaults = false, lockRequest = false } = options;
  // Exercise the real settings repair, within the actual E2E main/finally flow.
  const { createGameSettingsStore } = await import(pathToFileURL(path.resolve(__dirname, '../miniprogram/services/game-settings.ts')).href);
  const settingsKey = 'wuma:game-settings:v1';
  const entries = new Map([['activeLocalGameId', 'user-local'], ['activeAiGameId', 'user-ai'],
    ['wuma:online:active', 'user-room'], ['wuma:history:v1', { version: 1, records: [{ id: 'user-history' }] }]]);
  if (originalSettings !== undefined) entries.set(settingsKey, originalSettings);
  const before = structuredClone(entries);
  const sent = [];
  const nodeRequests = [];
  const app = {};
  const wx = { request(options) {
    sent.push({ url: options.url, method: options.method });
    options.success?.({ statusCode: 200, data: { code: 0, data: { token: 'b'.repeat(64) } } });
    return { abort() {} };
  } };
  const originalRequest = wx.request;
  if (lockRequest) Object.defineProperty(wx, 'request', { value: originalRequest, writable: false });
  let pageLoads = 0;
  let disconnected = false;
  const settingsStore = createGameSettingsStore({ get: key => entries.get(key),
    set: (key, value) => entries.set(key, value) });
  const mini = {
    async evaluate(fn, ...args) {
      return vm.runInNewContext(`(${fn.toString()})`, { wx, getApp: () => app })(...args);
    },
    async callWxMethod(method, key, value) {
      if (method === 'getStorageInfoSync') return { keys: [...entries.keys()] };
      if (method === 'getStorageSync') return entries.has(key) ? structuredClone(entries.get(key)) : '';
      if (method === 'setStorageSync') { entries.set(key, structuredClone(value)); return; }
      if (method === 'removeStorageSync') { entries.delete(key); return; }
      throw new Error(`Unexpected mocked Wx method ${method}`);
    },
    async reLaunch(route) {
      pageLoads++;
      if (route.includes('mode=local')) {
        const repaired = settingsStore.read();
        if (writeDefaults) settingsStore.write(repaired);
        let localErrorMessage = 'simulated local page load failure';
        if (destination) {
          try {
            wx.request({ url: destination, method: 'POST', success(response) {
              const root = destination.replace(/\/api\/v1\/auth\/device$/, '');
              if (destination.endsWith('/auth/device')) entries.set(`wuma:device-account-token:v1:${root}`, response.data.data.token);
            } });
          } catch (error) { localErrorMessage = error.message; }
        }
        return { async data() { return { localErrorMessage }; }, async waitFor() {} };
      }
      return { async data() { return {}; } };
    },
    disconnect() { disconnected = true; },
  };
  const state = { version: 0, state: { test: 'isolated fixture' } };
  const dependencies = {
    env: { WUMA_TEST_DATABASE_URL: 'mysql+pymysql://unused:unused@127.0.0.1/wuma_test',
      WUMA_GAME_OPERATIONS_API: 'http://127.0.0.1:8001',
      WUMA_GAME_OPERATIONS_PROBE_GAME_ID: 'isolated-fixture',
      WUMA_GAME_OPERATIONS_DEVICE_TOKEN: 'a'.repeat(64) },
    readDatabaseProbe: async () => ({ version: state.version, current_state: state.state }),
    probeEndpoint: async () => {}, connect: async () => mini,
    fetch: async (url, options) => {
      nodeRequests.push({ url, method: options.method });
      return { status: 200, async json() { return { code: 0, data: state }; } };
    },
  };
  return { run: () => main(dependencies), entries, before, sent, nodeRequests, app, wx, originalRequest,
    isDisconnected: () => disconnected, pageLoads: () => pageLoads };
}

test('main prevents IDE auth writes to an API outside the verified test destination', async () => {
  const h = await failingLocalHarness({ destination: 'http://127.0.0.1:8000/api/v1/auth/device' });
  const error = await h.run().catch(error => error);
  assert.deepEqual(h.sent, [], 'no request may reach the unverified IDE API');
  assert.match(error.message, /verified test API/);
  assert.deepEqual(h.entries, h.before, 'unverified account keys and original storage must remain intact');
  assert.equal(h.wx.request, h.originalRequest, 'restore the real request function');
  assert.equal(h.isDisconnected(), true);
  assert.deepEqual(h.nodeRequests.map(request => request.method), ['GET'], 'preflight is read-only');
});

test('main restores corrupt original settings when local onLoad repair precedes page failure', async () => {
  for (const originalSettings of [true, null, '']) {
    const h = await failingLocalHarness({ originalSettings, writeDefaults: true });
    await assert.rejects(h.run(), /simulated local page load failure/);
    assert.equal(h.entries.has('wuma:game-settings:v1'), true, 'retain an originally present key');
    assert.equal(h.entries.get('wuma:game-settings:v1'), originalSettings, 'restore the exact value that existed before the test');
    assert.deepEqual(h.entries, h.before);
    assert.equal(h.isDisconnected(), true);
  }
});

test('main restores missing settings when a page writes defaults and then fails', async () => {
  const h = await failingLocalHarness({ originalSettings: undefined, writeDefaults: true });
  await assert.rejects(h.run(), /simulated local page load failure/);
  assert.equal(h.entries.has('wuma:game-settings:v1'), false);
  assert.deepEqual(h.entries, h.before);
});


test('main forwards verified requests through the original function and restores it after page failure', async () => {
  const destination = 'http://127.0.0.1:8001/api/v1/auth/device';
  const h = await failingLocalHarness({ destination });
  await assert.rejects(h.run(), /simulated local page load failure/);
  assert.deepEqual(h.sent, [{ url: destination, method: 'POST' }]);
  assert.equal(h.wx.request, h.originalRequest);
  assert.deepEqual(h.entries, h.before);
  assert.deepEqual(h.app, {}, 'no request guard may remain installed');
});

test('main fails closed before loading any page if the real request function cannot be guarded', async () => {
  const h = await failingLocalHarness({ lockRequest: true });
  await assert.rejects(h.run(), /request guard/);
  assert.equal(h.pageLoads(), 0);
  assert.deepEqual(h.sent, []);
  assert.deepEqual(h.entries, h.before);
  assert.equal(h.wx.request, h.originalRequest);
  assert.equal(h.isDisconnected(), true);
});
