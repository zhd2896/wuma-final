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
