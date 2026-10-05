import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { main } = require('../scripts/game-operations-devtool-e2e.cjs');
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
      WUMA_GAME_OPERATIONS_DEVICE_TOKEN: 'a'.repeat(64),
    },
    readDatabaseProbe: async () => ({ version: 0, current_state: {} }),
    fetch: async () => ({
      status: 200,
      json: async () => ({ code: 0, data: { version: 0, state: {} } }),
    }),
    probeEndpoint: async value => { assert.equal(value, endpoint); },
  }), error => error === stopAfterConnecting);

  assert.deepEqual(connectionOptions, { wsEndpoint: endpoint });
  assert.equal(evaluateCalls, 2);
  assert.equal(disconnectCalls, 1);
});
