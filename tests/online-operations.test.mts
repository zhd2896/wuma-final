import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { RuleEngine, createInitialGameState } from '../miniprogram/domain/index.ts';

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

const initial = createInitialGameState();
const first = RuleEngine.executeTurn(initial, { from: 'P01', to: 'P02' });
const second = RuleEngine.executeTurn(first.state, { from: 'P05', to: 'P04' });
const room = (patch: Record<string, unknown> = {}) => ({
  game_id: 'online-ops', seat: 'A', room_status: 'PLAYING', invite_code: 'ABCDEFGH',
  public: false, expires_at: '2099-01-01T00:00:00Z', version: 2, ply_count: 2,
  pending_undo: null, state: second.state, token: 'host-seat', ...patch,
});
const undo = (patch: Record<string, unknown> = {}) => ({
  id: 'undo-1', requester: 'B', responder: 'A', base_revision: 2,
  anchor_turn: 2, revert_count: 1, status: 'PENDING', ...patch,
});
const storageFor = (values = new Map<string, unknown>()) => ({
  read: (key: string) => values.get(key),
  write: (key: string, value: unknown) => { values.set(key, value); },
  remove: (key: string) => { values.delete(key); },
});

async function fixture(patch: Record<string, unknown> = {}) {
  const { OnlineGameController } = await import('../miniprogram/pages/online/online-game.ts');
  let current = room(patch);
  const calls: any[] = [];
  const api: any = {
    create: async () => current,
    get: async () => { calls.push({ action: 'get' }); return { ...current, token: null }; },
    legal: async () => { calls.push({ action: 'legal' }); return { moves: [{ from: 'P02', to: 'P03' }] }; },
    requestUndo: async (_id: string, token: string, request: any) => {
      calls.push({ action: 'requestUndo', token, request });
      current = room({ pending_undo: undo({ requester: 'A', responder: 'B', anchor_turn: 1, revert_count: 2 }) });
      return current;
    },
    acceptUndo: async (_id: string, token: string, target: string, request: any) => {
      calls.push({ action: 'acceptUndo', token, target, request });
      current = room({ version: 3, ply_count: 1, state: first.state }); return current;
    },
    declineUndo: async (_id: string, token: string, target: string, request: any) => {
      calls.push({ action: 'declineUndo', token, target, request });
      current = room(); return current;
    },
    resign: async (_id: string, token: string, request: any) => {
      calls.push({ action: 'resign', token, request });
      current = room({ version: 3, room_status: 'FINISHED', state: {
        ...second.state, game_status: 'FINISHED', winner: 'B', winner_reason: 'RESIGN' } });
      return current;
    },
  };
  const storage = storageFor();
  const controller = new OnlineGameController(api, storage, () => {});
  await controller.create(false);
  return { controller, api, calls, setRoom: (patch: Record<string, unknown>) => { current = room(patch); } };
}

test('same-version polls publish undo permissions and clear selection while pending', async () => {
  const f = await fixture();
  await f.controller.tapNode('P02');
  assert.deepEqual(f.controller.snapshot.legalTargets, ['P03']);
  f.setRoom({ pending_undo: undo() });
  await f.controller.refresh();
  assert.equal(f.controller.snapshot.canRespondToUndo, true);
  assert.equal(f.controller.snapshot.canRequestUndo, false);
  assert.equal(f.controller.snapshot.selectedNode, null);
  assert.deepEqual(f.controller.snapshot.legalTargets, []);
  await f.controller.tapNode('P02');
  assert.equal(f.calls.filter(call => call.action === 'legal').length, 1);
  f.setRoom({ pending_undo: null });
  await f.controller.refresh();
  assert.equal(f.controller.snapshot.canRespondToUndo, false);
  assert.equal(f.controller.snapshot.canRequestUndo, true);
});

test('operation APIs use encoded paths, seat headers and original request bodies', async () => {
  const { createOnlineApi } = await import('../miniprogram/services/online-api.ts');
  const calls: any[] = [];
  const api: any = createOnlineApi({ request: async (...args: any[]) => { calls.push(args); return room(); } });
  const request = { expected_version: 2, client_request_id: 'stable-request' };
  await api.requestUndo('game/a', 'seat-token', request);
  await api.acceptUndo('game/a', 'seat-token', 'undo/b', request);
  await api.declineUndo('game/a', 'seat-token', 'undo/b', request);
  await api.resign('game/a', 'seat-token', request);
  assert.deepEqual(calls.map(call => call[1]), [
    '/api/v1/remote/rooms/game%2Fa/undo-requests',
    '/api/v1/remote/rooms/game%2Fa/undo-requests/undo%2Fb/accept',
    '/api/v1/remote/rooms/game%2Fa/undo-requests/undo%2Fb/decline',
    '/api/v1/remote/rooms/game%2Fa/resign',
  ]);
  for (const call of calls) {
    assert.equal(call[0], 'POST'); assert.deepEqual(call[2], request);
    assert.equal(call[4]['X-Room-Token'], 'seat-token');
  }
});

test('request undo freezes play, uses server two-ply authority, and rejects duplicate requests', async () => {
  const f = await fixture();
  await f.controller.requestUndo();
  assert.equal(f.controller.snapshot.room?.pending_undo?.revert_count, 2);
  assert.equal(f.controller.snapshot.canRequestUndo, false);
  await f.controller.requestUndo();
  await f.controller.acceptUndo();
  await f.controller.declineUndo();
  await f.controller.tapNode('P02');
  assert.equal(f.calls.filter(call => call.action === 'requestUndo').length, 1);
  assert.equal(f.calls.some(call => ['legal', 'acceptUndo', 'declineUndo'].includes(call.action)), false);
  assert.equal(f.controller.snapshot.operationNotice.includes('等待'), true);
  assert.equal(f.calls.filter(call => call.action === 'get').length, 1);
});

for (const revertCount of [1, 2]) {
  for (const action of ['acceptUndo', 'declineUndo']) {
    test(`only the responder may ${action} a ${revertCount}-ply undo`, async () => {
      const f = await fixture({ pending_undo: undo({ revert_count: revertCount }) });
      await f.controller[action]();
      assert.equal(f.calls.find(call => call.action === action)?.target, 'undo-1');
      assert.equal(f.calls.find(call => call.action === action)?.token, 'host-seat');
      assert.equal(f.controller.snapshot.room?.pending_undo, null);
      assert.equal(f.controller.snapshot.room?.ply_count, action === 'acceptUndo' ? 1 : 2);
      assert.equal(f.controller.snapshot.successfulAction, 1);
    });
  }
}

test('uncertain operation keeps its id, version and target through refresh and forbids other actions', async () => {
  const { ApiError } = await import('../miniprogram/services/api-client.ts');
  const f = await fixture({ pending_undo: undo() });
  const attempts: any[] = [];
  f.api.acceptUndo = async (_id: string, _token: string, target: string, request: any) => {
    attempts.push({ target, request: { ...request } });
    if (attempts.length === 1) throw new ApiError('NETWORK_ERROR', 0);
    return room({ version: 3, ply_count: 1, state: first.state });
  };
  f.setRoom({ version: 4, ply_count: 2, pending_undo: undo({ id: 'new-undo', base_revision: 4 }) });
  await f.controller.acceptUndo();
  assert.equal(f.controller.snapshot.room?.version, 4);
  assert.equal(f.controller.snapshot.pendingOperation, true);
  assert.ok(f.controller.snapshot.error);
  await f.controller.resign(); await f.controller.declineUndo(); await f.controller.requestUndo();
  await f.controller.tapNode('P02'); f.controller.leave(); await f.controller.create(false);
  assert.equal(f.calls.some(call => ['resign', 'declineUndo', 'requestUndo', 'legal'].includes(call.action)), false);
  assert.equal(f.controller.snapshot.room?.game_id, 'online-ops');
  await f.controller.retry();
  assert.deepEqual(attempts[1], attempts[0]);
  assert.equal(attempts[1].request.expected_version, 2);
  assert.equal(f.controller.snapshot.room?.version, 4);
  assert.equal(f.controller.snapshot.pendingOperation, false);
  assert.equal(f.controller.snapshot.successfulAction, 1);
});

for (const invalid of [undefined, -1, 0.5, '2']) {
  test(`invalid operation ply_count ${String(invalid)} resyncs and preserves retry context`, async () => {
    const f = await fixture();
    const attempts: any[] = [];
    f.api.requestUndo = async (_id: string, _token: string, request: any) => {
      attempts.push({ ...request });
      return attempts.length === 1 ? room({ ply_count: invalid }) : room({ pending_undo: undo({ requester: 'A', responder: 'B' }) });
    };
    await f.controller.requestUndo();
    assert.equal(f.controller.snapshot.pendingOperation, true);
    assert.ok(f.controller.snapshot.error);
    assert.equal(f.controller.snapshot.room?.ply_count, 2);
    assert.equal(f.calls.filter(call => call.action === 'get').length, 1);
    await f.controller.retry();
    assert.deepEqual(attempts[1], attempts[0]);
    assert.equal(f.controller.snapshot.pendingOperation, false);
  });
}

test('a malformed operation response cannot clear the request or issue another action', async () => {
  const f = await fixture();
  f.api.resign = async () => ({ ...room(), state: null });
  await f.controller.resign();
  assert.equal(f.controller.snapshot.pendingOperation, true);
  assert.ok(f.controller.snapshot.error);
  assert.equal(f.controller.snapshot.room?.state.game_status, 'PLAYING');
  await f.controller.requestUndo();
  assert.equal(f.calls.some(call => call.action === 'requestUndo'), false);
});

test('explicit business conflict refreshes and releases the original operation', async () => {
  const { ApiError } = await import('../miniprogram/services/api-client.ts');
  const f = await fixture();
  f.api.requestUndo = async () => { throw new ApiError('GAME_STATE_CONFLICT', 409); };
  f.setRoom({ version: 3, ply_count: 1, state: first.state });
  await f.controller.requestUndo();
  assert.equal(f.controller.snapshot.pendingOperation, false);
  assert.equal(f.controller.snapshot.room?.version, 3);
  assert.equal(f.controller.snapshot.canRequestUndo, true);
});

for (const seat of ['A', 'B']) {
  test(`${seat} can resign while an undo is pending and terminal retry preserves the same request`, async () => {
    const { ApiError } = await import('../miniprogram/services/api-client.ts');
    const f = await fixture({ seat, pending_undo: undo() });
    const terminal = room({ seat, version: 3, pending_undo: null, room_status: 'FINISHED', state: {
      ...second.state, game_status: 'FINISHED', winner: seat === 'A' ? 'B' : 'A', winner_reason: 'RESIGN' } });
    const attempts: any[] = [];
    f.api.resign = async (_id: string, _token: string, request: any) => {
      attempts.push({ ...request });
      if (attempts.length === 1) throw new ApiError('NETWORK_ERROR', 0);
      return terminal;
    };
    f.setRoom(terminal);
    await f.controller.resign();
    assert.equal(f.controller.snapshot.room?.room_status, 'FINISHED');
    assert.equal(f.controller.snapshot.pendingOperation, true);
    await f.controller.retry();
    assert.deepEqual(attempts[1], attempts[0]);
    assert.equal(f.controller.snapshot.pendingOperation, false);
    assert.equal(f.controller.snapshot.canRequestUndo, false);
    assert.equal(f.controller.snapshot.canRespondToUndo, false);
    assert.equal(f.controller.snapshot.successfulAction, 1);
  });
}

test('restore reads legacy seat keys and restores an outstanding server undo', async () => {
  const { OnlineGameController } = await import('../miniprogram/pages/online/online-game.ts');
  const values = new Map<string, unknown>([['wuma:online:active', 'online-ops'], ['wuma:online:seat:online-ops', 'legacy-seat']]);
  const controller = new OnlineGameController({ get: async (_id: string, token: string) => {
    assert.equal(token, 'legacy-seat'); return room({ pending_undo: undo(), token: null });
  } } as any, storageFor(values), () => {});
  await controller.restore();
  assert.equal(controller.snapshot.canRespondToUndo, true);
  await controller.tapNode('P02');
  assert.equal(controller.snapshot.selectedNode, null);
});

test('credential helpers validate types and retain the existing key format', async () => {
  const credentials = await import('../miniprogram/services/online-credentials.ts');
  const values = new Map<string, unknown>([['wuma:online:seat:old', 'legacy-secret']]);
  const storage = storageFor(values);
  assert.equal(credentials.ACTIVE_ONLINE_KEY, 'wuma:online:active');
  assert.equal(credentials.DEVICE_ONLINE_KEY, 'wuma:online:device');
  assert.equal(credentials.readOnlineSeat(storage, 'old'), 'legacy-secret');
  for (const invalid of [null, {}, [], 123, '', '   ']) {
    values.set('wuma:online:seat:invalid', invalid);
    assert.equal(credentials.readOnlineSeat(storage, 'invalid'), null);
  }
  credentials.writeOnlineSeat(storage, 'new', 'new-secret');
  assert.equal(values.get('wuma:online:seat:new'), 'new-secret');
  assert.throws(() => credentials.writeOnlineSeat(storage, 'new', ''), /seat/i);
  credentials.removeOnlineSeat(storage, 'new');
  assert.equal(credentials.readOnlineSeat(storage, 'new'), null);
  assert.equal(credentials.readOnlineSeat(storage, 'old'), 'legacy-secret');
});

test('invalid room ply_count is rejected on entry and same-version refresh without a version fallback', async () => {
  const f = await fixture({ ply_count: undefined });
  assert.equal(f.controller.snapshot.room, null);
  assert.ok(f.controller.snapshot.error);
  const good = await fixture();
  good.setRoom({ ply_count: -1 });
  await good.controller.refresh();
  assert.equal(good.controller.snapshot.room?.ply_count, 2);
  assert.ok(good.controller.snapshot.error);
});

test('a pre-operation same-version poll cannot restore an undo after decline', async () => {
  const f = await fixture({ pending_undo: undo() });
  let resolveOld!: (value: any) => void;
  let gets = 0;
  f.api.get = () => ++gets === 1 ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve(room());
  const poll = f.controller.refresh();
  await f.controller.declineUndo();
  assert.equal(gets, 2, 'successful operation starts a fresh GET despite an earlier poll');
  assert.equal(f.controller.snapshot.room?.pending_undo, null);
  resolveOld(room({ pending_undo: undo() }));
  await poll;
  assert.equal(f.controller.snapshot.room?.pending_undo, null);
  assert.equal(f.controller.snapshot.canRespondToUndo, false);
});

for (const invalidState of [
  { ...second.state, board: { occupancy: {} } },
  { ...second.state, players: { A: { reserve_count: -1 }, B: second.state.players.B } },
  { ...second.state, winner: 'B' },
]) {
  test('partial or contradictory game state cannot complete an uncertain operation', async () => {
    const f = await fixture();
    f.api.requestUndo = async () => room({ state: invalidState });
    await f.controller.requestUndo();
    assert.equal(f.controller.snapshot.pendingOperation, true);
    assert.equal(f.controller.snapshot.room?.state, second.state);
    assert.equal(f.controller.snapshot.successfulAction, 0);
  });
}

test('an unchanged playing room is not a valid resignation response', async () => {
  const f = await fixture();
  f.api.resign = async () => room();
  await f.controller.resign();
  assert.equal(f.controller.snapshot.pendingOperation, true);
  assert.equal(f.controller.snapshot.successfulAction, 0);
});

test('malformed capture data keeps the original move retry and refreshes safely', async () => {
  const f = await fixture();
  const moved = RuleEngine.executeTurn(second.state, { from: 'P02', to: 'P03' });
  const attempts: any[] = [];
  f.api.move = async (_id: string, _token: string, request: any) => {
    attempts.push({ ...request });
    return { version: 3, ply_count: 3, turn: { ...moved,
      capture: attempts.length === 1 ? {} : moved.capture } };
  };
  await f.controller.tapNode('P02'); await f.controller.tapNode('P03');
  assert.equal(f.controller.snapshot.pendingMove, true);
  assert.equal(f.controller.snapshot.successfulAction, 0);
  await f.controller.requestUndo();
  assert.equal(f.calls.some(call => call.action === 'requestUndo'), false);
  await f.controller.retry();
  assert.deepEqual(attempts[1], attempts[0]);
  assert.equal(f.controller.snapshot.pendingMove, false);
});
