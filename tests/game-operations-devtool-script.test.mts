import { API_BASE_URLS } from '../miniprogram/config/api-roots.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { main, requireWechatSession, toggleLegalTargets } = require('../scripts/game-operations-devtool-e2e.cjs');
const automator = require('miniprogram-automator');

test('main default connector invokes the real automator with its instance receiver', async t => {
  const endpoint = 'ws://127.0.0.1:19420';
  const stopAfterConnecting = new Error('stop after verifying the default connection');
  let connectionOptions;
  let evaluateCalls = 0;
  let disconnectCalls = 0;
  const mini = {
    async evaluate() {
      if (++evaluateCalls === 1) throw stopAfterConnecting;
      return 0;
    },
    async callWxMethod() { return undefined; },
    disconnect() { disconnectCalls++; },
  };
  // Keep automator.connect real: only replace its external launcher transport.
  t.mock.method(automator.launcher, 'connect', async function(options) {
    assert.equal(this, automator.launcher);
    connectionOptions = options;
    return mini;
  });
  t.mock.method(console, 'log', () => {});

  await assert.rejects(main({
    env: {
      WUMA_TEST_DATABASE_URL: 'mysql://127.0.0.1/connector_test',
      WUMA_WECHAT_AUTO_ENDPOINT: endpoint,
      WUMA_GAME_OPERATIONS_PROBE_GAME_ID: 'connector-probe',
      WUMA_GAME_OPERATIONS_WECHAT_TOKEN: 'a'.repeat(64),
      WUMA_GAME_OPERATIONS_EXPIRES_AT: '2099-01-01T00:00:00Z',
    },
    readDatabaseProbe: async () => ({ version: 0, current_state: {}, user_id: 'user', owner_kind: 'wechat' }),
    fetch: async url => ({
      status: 200,
      json: async () => ({ code: 0, data: url.endsWith('/me/profile')
        ? { id: 'user' } : { version: 0, state: {} } }),
    }),
    probeEndpoint: async value => { assert.equal(value, endpoint); },
  }), error => error === stopAfterConnecting);

  assert.deepEqual(connectionOptions, { wsEndpoint: endpoint });
  assert.equal(evaluateCalls, 2);
  assert.equal(disconnectCalls, 1);
});

test('operation fixtures reject anonymous, expired and malformed login sessions before connection', () => {
  for (const env of [
    { WUMA_GAME_OPERATIONS_DEVICE_TOKEN: 'a'.repeat(64) },
    { WUMA_GAME_OPERATIONS_WECHAT_TOKEN: 'a'.repeat(64), WUMA_GAME_OPERATIONS_EXPIRES_AT: 'invalid' },
    { WUMA_GAME_OPERATIONS_WECHAT_TOKEN: 'a'.repeat(64), WUMA_GAME_OPERATIONS_EXPIRES_AT: '2000-01-01T00:00:00Z' },
    { WUMA_GAME_OPERATIONS_WECHAT_TOKEN: 'bad-token', WUMA_GAME_OPERATIONS_EXPIRES_AT: '2099-01-01T00:00:00Z' },
  ]) assert.throws(() => requireWechatSession(env), /valid WeChat session/);
  assert.deepEqual(requireWechatSession({ WUMA_GAME_OPERATIONS_WECHAT_TOKEN: 'a'.repeat(64),
    WUMA_GAME_OPERATIONS_EXPIRES_AT: '2099-01-01T00:00:00Z' }),
    { token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' });
});

test('legal-target setting is selected independently of other switches and their order', async () => {
  const template = readFileSync(new URL('../miniprogram/components/game-settings/game-settings.wxml', import.meta.url), 'utf8');
  const switchTag = template.match(/<switch\b[^>]*id="setting-legal-targets"[^>]*\/>/)?.[0];
  assert.ok(switchTag, 'the legal-target switch needs a stable identifier');
  assert.match(switchTag, /checked="{{settings.showLegalTargets}}"/);
  let legalTargets = true;
  let labels = false;
  const component = {
    async $$(selector) { return [{ tap() { labels = !labels; } }, { tap() { legalTargets = !legalTargets; } }]; },
    async $(selector) {
      assert.equal(selector, '#setting-legal-targets');
      return { async tap() { legalTargets = !legalTargets; } };
    },
  };
  await toggleLegalTargets(component);
  assert.equal(legalTargets, false);
  assert.equal(labels, false);
  await toggleLegalTargets(component);
  assert.equal(legalTargets, true);
  assert.equal(labels, false);
});

test('operation fixtures verify WeChat ownership before connecting or writing', async t => {
  t.mock.method(console, 'log', () => {});
  for (const [kind, owner] of [['device', 'user'], ['wechat', 'different-user']]) {
    let connects = 0;
    const methods: string[] = [];
    await assert.rejects(main({ env: {
      WUMA_TEST_DATABASE_URL: 'mysql://127.0.0.1/identity_test',
      WUMA_GAME_OPERATIONS_PROBE_GAME_ID: 'probe',
      WUMA_GAME_OPERATIONS_WECHAT_TOKEN: 'a'.repeat(64),
      WUMA_GAME_OPERATIONS_EXPIRES_AT: '2099-01-01T00:00:00Z',
    }, readDatabaseProbe: async () => ({ version: 0, current_state: {}, user_id: owner, owner_kind: kind }),
    fetch: async (url, options) => { methods.push(options.method); return { status: 200,
      json: async () => ({ code: 0, data: url.endsWith('/me/profile') ? { id: 'user' } : { version: 0, state: {} } }) }; },
    connect: async () => { connects++; throw new Error('should not connect'); },
    probeEndpoint: async () => {},
    }), /WeChat|ownership/);
    assert.equal(connects, 0);
    assert.ok(methods.every(method => method === 'GET'));
  }
});

test('operation script seeds the verified WeChat session and restores it after a failed page load', async t => {
  t.mock.method(console, 'log', () => {});
  const sessionKey = `wuma:wechat-session:v1:${API_BASE_URLS.development}`;
  const legacyKey = `wuma:device-account-token:v1:${API_BASE_URLS.development}`;
  const original = { token: 'b'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' };
  const storage = new Map<string, any>([[sessionKey, original], [legacyKey, 'legacy'], ['activeAiGameId', 'original-ai']]);
  const app = {};
  const wx = { request() {} };
  const initialRequest = wx.request;
  const stop = new Error('stop after checking injected session');
  let disconnected = 0;
  const mini = {
    async evaluate(fn, ...args) { return vm.runInNewContext(`(${fn.toString()})(...args)`, { getApp: () => app, wx, args }); },
    async callWxMethod(method, key, value) {
      if (method === 'getStorageInfoSync') return { keys: [...storage.keys()] };
      if (method === 'getStorageSync') return storage.get(key);
      if (method === 'setStorageSync') { storage.set(key, value); return; }
      if (method === 'removeStorageSync') { storage.delete(key); return; }
      throw new Error(`unexpected storage method ${method}`);
    },
    async reLaunch(route) {
      if (route.startsWith('/pages/game/')) {
        assert.equal(storage.get(sessionKey).token, 'a'.repeat(64));
        assert.equal(storage.get(sessionKey).expiresAt, '2099-01-01T00:00:00Z');
        assert.equal(storage.get(legacyKey), 'legacy');
        throw stop;
      }
    },
    disconnect() { disconnected++; },
  };
  await assert.rejects(main({ env: {
    WUMA_TEST_DATABASE_URL: 'mysql://127.0.0.1/storage_test',
    WUMA_GAME_OPERATIONS_API: API_BASE_URLS.development,
    WUMA_GAME_OPERATIONS_PROBE_GAME_ID: 'probe',
    WUMA_GAME_OPERATIONS_WECHAT_TOKEN: 'a'.repeat(64),
    WUMA_GAME_OPERATIONS_EXPIRES_AT: '2099-01-01T00:00:00Z',
  }, readDatabaseProbe: async () => ({ version: 0, current_state: {}, user_id: 'user', owner_kind: 'wechat' }),
  fetch: async url => ({ status: 200, json: async () => ({ code: 0,
    data: url.endsWith('/me/profile') ? { id: 'user' } : { version: 0, state: {} } }) }),
  probeEndpoint: async () => {}, connect: async () => mini,
  }), error => error === stop);
  assert.equal(storage.get(sessionKey), original);
  assert.equal(storage.get(legacyKey), 'legacy');
  assert.equal(storage.get('activeAiGameId'), 'original-ai');
  assert.equal(wx.request, initialRequest);
  assert.equal(disconnected, 1);
});
