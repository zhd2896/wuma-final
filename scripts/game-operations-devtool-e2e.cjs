/** DevTools -> real page/controller -> isolated FastAPI/MySQL. Online uses one simulator,
 * two test seat tokens: this is a simulation, never evidence of two-device acceptance. */
const assert = require('node:assert/strict');
const path = require('node:path');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');

function requireTestDatabase(value) {
  let parsed;
  try { parsed = new URL(value); } catch { /* generic message avoids leaking secrets */ }
  if (!parsed || !['mysql:', 'mysql+pymysql:'].includes(parsed.protocol) ||
      !/^\/[A-Za-z0-9_]+_test$/.test(parsed.pathname) || [...parsed.searchParams.keys()].some(key => !['charset', 'connect_timeout', 'read_timeout', 'write_timeout'].includes(key)) || parsed.hash) {
    throw new Error('WUMA_TEST_DATABASE_URL must point to an isolated MySQL *_test database (only charset and timeout query options are allowed)');
  }
  return parsed.pathname.slice(1);
}
function timed(promise, label, ms = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); });
  });
}
async function until(page, predicate, label, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const data = await timed(page.data(), `${label}: page data`, Math.min(5000, end - Date.now()));
    const error = data.localErrorMessage || data.aiState?.errorMessage || data.snapshot?.error;
    if (error) throw new Error(`${label}: ${error}`);
    if (predicate(data)) return data;
    await timed(page.waitFor(200), `${label}: polling wait`, 2000);
  }
  throw new Error(`${label} timed out after ${ms} ms`);
}
async function tap(page, selector) {
  const element = await timed(page.$(selector), `find ${selector}`);
  assert.ok(element, `Missing visible operation ${selector}; open/compile this implementation worktree in DevTools`);
  await timed(element.tap(), `tap ${selector}`);
}
async function confirm(page, field) {
  await until(page, data => data[field], `visible ${field} dialog`);
  const dialogs = await timed(page.$$('confirm-dialog'), 'find confirmation dialogs');
  for (const dialog of dialogs) {
    const button = await timed(dialog.$('.confirm'), 'find visible dialog confirmation');
    if (button) { await timed(button.tap(), 'confirm operation', 20000); return; }
  }
  throw new Error(`No rendered confirmation button for ${field}`);
}
async function move(page, from, to) {
  const board = await timed(page.$('chess-board'), 'find real chess board');
  assert.ok(board, 'chess-board is missing');
  const piece = await timed(board.$(`.piece-position[data-id="${from}"]`), `find ${from}`);
  assert.ok(piece, `piece ${from} is missing`);
  await timed(piece.tap(), `select ${from}`);
  await until(page, data => (data.aiState?.legalTargets || data.snapshot?.legalTargets ||
    data.localSession?.legalDestinations || []).includes(to), `legal ${from}->${to}`);
  const target = await timed(board.$(`.node-hit[data-id="${to}"]`), `find ${to}`);
  assert.ok(target, `target ${to} is missing`);
  await timed(target.tap(), `move ${from}->${to}`);
}
async function probeEndpoint(endpoint) {
  const url = new URL(endpoint);
  assert.ok(['ws:', 'wss:'].includes(url.protocol), 'automation endpoint must be ws/wss');
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: url.hostname,
      port: Number(url.port || (url.protocol === 'wss:' ? 443 : 80)) });
    socket.setTimeout(2000);
    socket.once('connect', () => { socket.destroy(); resolve(); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error(`DevTools automation port unavailable: ${url.hostname}:${url.port} (2000 ms timeout)`)); });
    socket.once('error', error => { socket.destroy(); reject(new Error(`DevTools automation port unavailable: ${url.hostname}:${url.port} (${error.code})`)); });
  });
}

async function main(dependencies = {}) {
  const env = dependencies.env || process.env;
  const fetchApi = dependencies.fetch || fetch;
  const root = path.resolve(__dirname, '..');
  const database = requireTestDatabase(env.WUMA_TEST_DATABASE_URL);
  const endpoint = env.WUMA_WECHAT_AUTO_ENDPOINT || 'ws://127.0.0.1:9420';
  // A pre-existing test fixture proves API and DB agreement before any API writes.
  const probeId = env.WUMA_GAME_OPERATIONS_PROBE_GAME_ID;
  const accountToken = env.WUMA_GAME_OPERATIONS_DEVICE_TOKEN;
  if (!probeId || !/^[0-9a-f]{64}$/.test(accountToken || '')) {
    throw new Error('Set WUMA_GAME_OPERATIONS_PROBE_GAME_ID and WUMA_GAME_OPERATIONS_DEVICE_TOKEN to an isolated test-account fixture owned by that token');
  }
  const apiBase = (env.WUMA_GAME_OPERATIONS_API || 'http://127.0.0.1:8000').replace(/\/$/, '');
  const python = env.WUMA_PYTHON || path.join(root, 'backend/.venv/Scripts/python.exe');
  let assertRequestGuard = null;
  async function api(method, route, body, seatToken) {
    if (method !== 'GET') {
      assert.ok(assertRequestGuard, 'IDE request guard must be installed before API writes');
      await assertRequestGuard();
    }
    const response = await fetchApi(`${apiBase}/api/v1${route}`, {
      method, headers: { Authorization: `Bearer ${accountToken}`, 'content-type': 'application/json',
        ...(seatToken ? { 'X-Room-Token': seatToken } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000),
    });
    const envelope = await response.json();
    assert.equal(response.status, 200, `${method} ${route}: HTTP ${response.status}, code=${envelope.code}`);
    assert.equal(envelope.code, 0, `${method} ${route} failed`);
    return envelope.data;
  }
  let probe;
  try {
    probe = dependencies.readDatabaseProbe ? await dependencies.readDatabaseProbe(probeId) : JSON.parse(execFileSync(python, [path.join(root, 'scripts/phase21_review_db_probe.py'), probeId],
      { cwd: root, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch {
    throw new Error('Read-only isolated database fixture probe failed; check WUMA_PYTHON, test database migration/access and fixture ID');
  }
  const fixture = await api('GET', `/game/${encodeURIComponent(probeId)}`);
  assert.equal(fixture.version, probe.version, 'API is not serving the supplied test database fixture');
  assert.deepEqual(fixture.state, probe.current_state, 'API/test database fixture mismatch');
  console.log(`ISOLATION verified database=${database}; project=${root}`);
  await (dependencies.probeEndpoint || probeEndpoint)(endpoint);
  const connect = dependencies.connect || require('miniprogram-automator').connect;
  const mini = await timed(connect({ wsEndpoint: endpoint }), 'DevTools connection', 5000);
  const accountKey = `wuma:device-account-token:v1:${apiBase}`;
  const keys = ['activeLocalGameId', 'activeAiGameId', 'wuma:online:active', accountKey,
    'wuma:game-settings:v1'];
  const saved = new Map();
  let originallyPresent = new Set();
  const ownedIds = new Set();
  const testSeatKeys = new Set();
  let settingsNeedRestore = false;
  let pagesStarted = false;
  let guardAttempted = false;
  const guardKey = `__wumaGameOperationsRequestGuard_${randomUUID()}`;
  let failure;
  const storage = (method, key, ...args) => timed(mini.callWxMethod(method, key, ...args), `${method} ${key}`);
  const navigate = route => timed(mini.reLaunch(route), `open ${route}`, 15000);
  const open = async route => {
    await assertRequestGuard();
    // onLoad may repair damaged settings before returning data or throwing.
    settingsNeedRestore = true;
    pagesStarted = true;
    const page = await navigate(route);
    await assertRequestGuard();
    return page;
  };
  try {
    // This wrapper intercepts the real IDE wx.request before any page/storage/API
    // writes. It does not substitute responses: allowed calls use the original API.
    guardAttempted = true;
    await timed(mini.evaluate((key, base) => {
      const app = getApp();
      if (!app || app[key] || typeof wx.request !== 'function') throw new Error('Cannot install IDE request guard');
      const original = wx.request;
      const state = { original, wrapper: null, blocked: 0 };
      const prefix = `${base}/api/v1/`;
      state.wrapper = function(options) {
        if (typeof options?.url !== 'string' || !options.url.startsWith(prefix)) {
          state.blocked++;
          throw new Error('IDE request destination differs from the verified test API');
        }
        return original.call(wx, options);
      };
      app[key] = state;
      try {
        wx.request = state.wrapper;
        if (wx.request !== state.wrapper) throw new Error('Cannot install IDE request guard');
      } catch (error) {
        wx.request = original;
        delete app[key];
        throw error;
      }
    }, guardKey, apiBase), 'install IDE request guard');
    assertRequestGuard = async () => {
      const state = await timed(mini.evaluate(key => {
        const guard = getApp()?.[key];
        return { installed: !!guard && wx.request === guard.wrapper, blocked: guard?.blocked || 0 };
      }, guardKey), 'verify IDE request guard');
      assert.equal(state.installed, true, 'IDE request guard changed; refusing further operations');
      assert.equal(state.blocked, 0, 'IDE request destination differs from the verified test API; compile this worktree with the matching API config');
    };
    await assertRequestGuard();
    const storageInfo = await timed(mini.callWxMethod('getStorageInfoSync'), 'snapshot storage key presence');
    assert.ok(Array.isArray(storageInfo?.keys), 'Cannot snapshot original storage key presence');
    originallyPresent = new Set(storageInfo.keys);
    for (const key of keys) saved.set(key, await storage('getStorageSync', key));
    const history = await storage('getStorageSync', 'wuma:history:v1');
    assert.ok(!history || (history.version === 1 && Array.isArray(history.records)),
      'Existing local history is invalid; no test storage has been changed');
    await storage('setStorageSync', accountKey, accountToken);
    await storage('removeStorageSync', 'activeLocalGameId');
    let page = await open('/pages/game/game?mode=local');
    let data = await until(page, value => value.localGameId && value.localSession, 'fresh local game');
    const localId = data.localGameId; ownedIds.add(localId);
    const initial = data.localSession.gameState;
    await move(page, 'P01', 'P02');
    await until(page, value => value.localTurns === 1, 'one local move');
    await tap(page, '#action-undo'); await confirm(page, 'showUndoConfirm');
    data = await until(page, value => value.localTurns === 0 && !value.operationBusy, 'local undo');
    assert.deepEqual(data.localSession.gameState, initial);
    page = await open(`/pages/game/game?mode=local&gameId=${encodeURIComponent(localId)}`);
    data = await until(page, value => value.localGameId === localId && value.localSession, 'local undo reload');
    assert.equal(data.localTurns, 0); assert.deepEqual(data.localSession.gameState, initial);
    await tap(page, '#action-resign'); await confirm(page, 'showResign');
    data = await until(page, value => value.localSession.gameState.game_status === 'FINISHED', 'local resign');
    assert.equal(data.localSession.gameState.winner_reason, 'RESIGN');
    assert.equal(data.localSession.gameState.winner, 'B');
    console.log(`PASS local move/undo/reload/resign id=${localId}`);

    // The visible switch runs the component event and real settings store.
    await tap(page, '#action-settings');
    const component = await timed(page.$('game-settings'), 'settings component');
    assert.ok(component, 'game-settings component is missing');
    const switches = await timed(component.$$('switch'), 'settings switches');
    assert.equal(switches.length, 3);
    const beforeSettings = data.settings;
    await timed(switches[0].tap(), 'toggle legal-target setting');
    data = await until(page, value => value.settings.showLegalTargets !== beforeSettings.showLegalTargets, 'settings save');
    page = await open(`/pages/game/game?mode=local&gameId=${encodeURIComponent(localId)}`);
    data = await until(page, value => value.localSession, 'settings reload');
    assert.equal(data.settings.showLegalTargets, !beforeSettings.showLegalTargets);
    await tap(page, '#action-settings');
    const settings = await timed(page.$('game-settings'), 'settings after reload');
    await timed((await settings.$$('switch'))[0].tap(), 'restore legal targets for board checks');
    await until(page, value => value.settings.showLegalTargets === beforeSettings.showLegalTargets, 'restore test setting');
    console.log('PASS settings switch/store/reload');

    const ai = await api('POST', '/game', { mode: 'AI', first_player: 'A', ai_player: 'B', ai_level: 'STANDARD' });
    ownedIds.add(ai.game_id);
    page = await open(`/pages/game/game?mode=ai&gameId=${encodeURIComponent(ai.game_id)}`);
    await until(page, value => value.aiReady && value.aiState.gameId === ai.game_id, 'isolated AI page');
    await move(page, 'P01', 'P02');
    await until(page, value => value.aiState.plyCount === 2 && !value.aiState.isAiThinking &&
      value.aiState.gameState.current_player === 'A', 'human move and real AI reply', 60000);
    await tap(page, '#action-undo'); await confirm(page, 'showUndoConfirm');
    data = await until(page, value => value.aiState.plyCount === 0 && !value.operationBusy, 'AI undo');
    let authority = await api('GET', `/game/${ai.game_id}`);
    assert.deepEqual(authority.state, ai.state); assert.equal(authority.ply_count, 0);
    assert.deepEqual(data.aiState.gameState, authority.state);
    await tap(page, '#action-resign'); await confirm(page, 'showResign');
    data = await until(page, value => value.aiState.gameState.game_status === 'FINISHED', 'AI resign');
    authority = await api('GET', `/game/${ai.game_id}`);
    assert.equal(authority.state.winner_reason, 'RESIGN'); assert.equal(authority.state.winner, 'B');
    assert.deepEqual(data.aiState.gameState, authority.state);
    console.log(`PASS real AI API undo/resign id=${ai.game_id}`);

    // New isolated seats, no mutation of an existing room/device credential.
    const roomA = await api('POST', '/remote/rooms', { device_id: `e2e_A_${randomUUID()}`, public: false });
    ownedIds.add(roomA.game_id);
    const roomB = await api('POST', '/remote/join', { device_id: `e2e_B_${randomUUID()}`, invite_code: roomA.invite_code });
    const roomPath = `/remote/rooms/${roomA.game_id}`;
    const seatKey = `wuma:online:seat:${roomA.game_id}`;
    testSeatKeys.add(seatKey);
    await storage('setStorageSync', seatKey, roomA.token);
    await storage('setStorageSync', 'wuma:online:active', roomA.game_id);
    page = await open('/pages/online/online');
    await until(page, value => value.snapshot?.room?.game_id === roomA.game_id && !value.snapshot.busy, 'online A restore');
    for (const selector of ['#online-request-undo', '#online-resign', '#online-settings']) {
      assert.ok(await timed(page.$(selector), `online operation ${selector}`), `Missing ${selector}`);
    }
    await move(page, 'P01', 'P02');
    await until(page, value => value.snapshot.room.ply_count === 1 && !value.snapshot.busy, 'online A move');
    await tap(page, '#online-request-undo'); await confirm(page, 'showUndoConfirm');
    data = await until(page, value => value.snapshot.room.pending_undo && !value.snapshot.busy, 'A pending request');
    const pending = data.snapshot.room.pending_undo;
    assert.equal(pending.requester, 'A'); assert.equal(pending.responder, 'B'); assert.equal(pending.revert_count, 1);
    assert.equal(data.snapshot.canRespondToUndo, false);
    await open('/pages/index/index');
    await storage('setStorageSync', seatKey, roomB.token);
    page = await open(`/pages/online/online?gameId=${roomA.game_id}`);
    data = await until(page, value => value.snapshot.canRespondToUndo, 'simulated B pending restore');
    assert.equal(data.snapshot.room.seat, 'B'); assert.equal(data.snapshot.room.pending_undo.id, pending.id);
    await tap(page, '#online-undo-accept');
    data = await until(page, value => value.snapshot.room.ply_count === 0 &&
      !value.snapshot.room.pending_undo && !value.snapshot.busy, 'B accepts undo');
    const seenA = await api('GET', roomPath, undefined, roomA.token);
    const seenB = await api('GET', roomPath, undefined, roomB.token);
    assert.equal(seenA.version, seenB.version); assert.deepEqual(seenA.state, seenB.state);
    assert.deepEqual(data.snapshot.room.state, seenA.state); assert.equal(seenA.ply_count, 0);
    await open('/pages/index/index');
    await storage('setStorageSync', seatKey, roomA.token);
    page = await open(`/pages/online/online?gameId=${roomA.game_id}`);
    data = await until(page, value => value.snapshot.room?.seat === 'A' &&
      value.snapshot.room.version === seenA.version, 'A sees accepted undo');
    assert.equal(data.snapshot.room.pending_undo, null); assert.equal(data.snapshot.room.ply_count, 0);
    console.log(`PASS SIMULATED online A/B request/reconnect/accept id=${roomA.game_id}; two-device acceptance NOT performed`);
    console.log('RESULT game-operations devtool=PASS (live MySQL and two-device acceptance remain separate gates)');
  } catch (error) { failure = error; }
  finally {
    // Attempt every restoration even when an earlier cleanup operation fails.
    const cleanupErrors = [];
    async function cleanup(label, action) {
      try { await action(); }
      catch (error) { cleanupErrors.push(error); console.error(`CLEANUP FAILED ${label}: ${error.message}`); }
    }
    try {
      if (pagesStarted) await cleanup('stop page controllers', () => navigate('/pages/index/index'));
      await cleanup('remove only test history records', async () => {
        const history = await storage('getStorageSync', 'wuma:history:v1');
        if (history?.version === 1 && Array.isArray(history.records)) {
          const records = history.records.filter(record => !ownedIds.has(record.id));
          if (records.length !== history.records.length) {
            await storage('setStorageSync', 'wuma:history:v1', { ...history, records });
          }
        }
      });
      for (const key of testSeatKeys) await cleanup(key, () => storage('removeStorageSync', key));
      for (const [key, value] of saved) await cleanup(key, async () => {
        if (key === 'wuma:game-settings:v1' && !settingsNeedRestore) return;
        if (!originallyPresent.has(key)) await storage('removeStorageSync', key);
        else await storage('setStorageSync', key, value);
      });
      if (guardAttempted) await cleanup('restore real IDE request function', async () => {
        const blocked = await timed(mini.evaluate(key => {
          const app = getApp();
          const guard = app?.[key];
          if (!guard) return 0;
          wx.request = guard.original;
          if (wx.request !== guard.original) throw new Error('Cannot restore IDE request guard original');
          delete app[key];
          return guard.blocked;
        }, guardKey), 'restore IDE request guard');
        if (blocked && !failure) throw new Error('IDE request destination differs from the verified test API');
      });
      if (cleanupErrors.length) failure ||= new AggregateError(cleanupErrors, 'Test storage cleanup failed; see operation errors above');
    } finally { mini.disconnect(); }
  }
  if (failure) throw failure;
}
module.exports = { requireTestDatabase, timed, main };
if (require.main === module) main().catch(error => {
  console.error(`FAIL game-operations: ${error.message}`);
  process.exit(1); // also terminates an uncancellable automator connection after timeout
});
