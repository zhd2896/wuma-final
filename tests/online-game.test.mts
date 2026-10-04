import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
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

test('two devices hold separate seats, synchronize turns, and restore their own credentials', async () => {
  const { OnlineGameController } = await import('../miniprogram/pages/online/online-game.ts');
  let state = createInitialGameState();
  let version = 0;
  const turn = RuleEngine.executeTurn(state, { from: 'P01', to: 'P02' });
  const tokens = { A: 'host-token', B: 'guest-token' };
  const room = (seat: 'A' | 'B', issue = false) => ({
    game_id: 'online-1', seat, room_status: 'PLAYING' as const,
    invite_code: 'ABCDEFGH', public: false, expires_at: new Date().toISOString(),
    version, ply_count: version, pending_undo: null, state, token: issue ? tokens[seat] : null,
  });
  const calls: Array<{ name: string; token?: string; request?: any }> = [];
  const api = {
    create: async () => room('A', true),
    join: async () => room('B', true),
    match: async () => room('A', true),
    get: async (_id: string, token: string) => room(token === tokens.A ? 'A' : 'B'),
    cancel: async () => room('A'),
    legal: async (_id: string, token: string, from: string) => {
      calls.push({ name: 'legal', token });
      return { moves: RuleEngine.getLegalMoves(state).filter(move => move.from === from) };
    },
    move: async (_id: string, token: string, request: any) => {
      calls.push({ name: 'move', token, request });
      assert.equal(token, tokens.A);
      assert.equal(request.expected_version, 0);
      state = turn.state; version = 1;
      return { version, ply_count: version, turn };
    },
  };
  const hostStorage = new Map<string, unknown>();
  const guestStorage = new Map<string, unknown>();
  const storage = (map: Map<string, unknown>) => ({
    read: (key: string) => map.get(key),
    write: (key: string, value: unknown) => { map.set(key, value); },
    remove: (key: string) => { map.delete(key); },
  });
  const host = new OnlineGameController(api as any, storage(hostStorage), () => {});
  const guest = new OnlineGameController(api as any, storage(guestStorage), () => {});
  await host.create(false);
  await guest.join('ABCDEFGH');
  assert.equal(host.snapshot.room?.seat, 'A');
  assert.equal(guest.snapshot.room?.seat, 'B');
  await host.refresh();
  await host.tapNode('P01');
  assert.ok(host.snapshot.legalTargets.includes('P02'));
  await host.tapNode('P02');
  assert.equal(host.snapshot.room?.version, 1);
  await guest.refresh();
  assert.equal(guest.snapshot.room?.state.current_player, 'B');
  await host.tapNode('P05');
  assert.equal(calls.filter(call => call.name === 'move').length, 1);
  assert.equal(calls.find(call => call.name === 'move')?.request.client_request_id.length > 7, true);
  const restored = new OnlineGameController(api as any, storage(hostStorage), () => {});
  await restored.restore('online-1');
  assert.equal(restored.snapshot.room?.seat, 'A');
  assert.equal(restored.snapshot.room?.version, 1);
  assert.equal(hostStorage.get('wuma:online:active'), 'online-1');
});

test('seat token is sent as a request header and lost response retries the same move', async () => {
  const { createApiClient, ApiError } = await import('../miniprogram/services/api-client.ts');
  const { createOnlineApi } = await import('../miniprogram/services/online-api.ts');
  const { OnlineGameController } = await import('../miniprogram/pages/online/online-game.ts');
  const requests: any[] = [];
  const client = createApiClient({ baseUrl: 'http://test', request: options => {
    requests.push(options);
    options.success({ statusCode: 200, data: { code: 0, data: { moves: [] } } });
  } });
  await createOnlineApi(client).legal('g1', 'secret-seat', 'P01');
  assert.equal(requests[0].header['X-Room-Token'], 'secret-seat');
  assert.ok(!requests[0].url.includes('secret-seat'));

  const initial = createInitialGameState();
  const turn = RuleEngine.executeTurn(initial, { from: 'P01', to: 'P02' });
  const room = { game_id: 'g1', seat: 'A' as const, room_status: 'PLAYING' as const,
    invite_code: 'ABCDEFGH', public: false, expires_at: new Date().toISOString(),
    version: 0, ply_count: 0, pending_undo: null, state: initial, token: 'secret-seat' };
  const attempts: any[] = [];
  const storage = new Map<string, unknown>();
  const controller = new OnlineGameController({
    create: async () => room,
    join: async () => room,
    match: async () => room,
    get: async () => room,
    cancel: async () => room,
    legal: async () => ({ moves: [{ from: 'P01', to: 'P02' }] }),
    move: async (_id: string, _token: string, request: any) => {
      attempts.push(request);
      if (attempts.length === 1) throw new ApiError('NETWORK_ERROR', 0);
      return { version: 1, ply_count: 1, turn };
    },
  } as any, {
    read: key => storage.get(key), write: (key, value) => { storage.set(key, value); },
    remove: key => { storage.delete(key); },
  }, () => {});
  await controller.create(false);
  await controller.tapNode('P01');
  await controller.tapNode('P02');
  assert.equal(controller.snapshot.pendingMove, true);
  await controller.retryMove();
  assert.deepEqual(attempts[1], attempts[0]);
  assert.equal(controller.snapshot.room?.version, 1);
  assert.equal(controller.snapshot.pendingMove, false);

  const { homeFeatures } = await import('../miniprogram/mock/game.ts');
  assert.equal(homeFeatures.find(feature => feature.id === 'remote')?.route,
    '/pages/online/online');
  const page = readFileSync(new URL('../miniprogram/pages/online/online.wxml', import.meta.url), 'utf8');
  assert.match(page, /online-create/);
  assert.match(page, /online-join/);
  assert.match(page, /<chess-board/);
});

test('a slow room refresh never rewinds a confirmed local turn', async () => {
  const { OnlineGameController } = await import('../miniprogram/pages/online/online-game.ts');
  const initial = createInitialGameState();
  const turn = RuleEngine.executeTurn(initial, { from: 'P01', to: 'P02' });
  const room = { game_id: 'slow-room', seat: 'A' as const,
    room_status: 'PLAYING' as const, invite_code: 'ABCDEFGH', public: false,
    expires_at: new Date().toISOString(), version: 0, ply_count: 0, pending_undo: null, state: initial, token: 'secret' };
  let resolveRefresh!: (value: any) => void;
  const api = {
    create: async () => room,
    get: () => new Promise(resolve => { resolveRefresh = resolve; }),
    legal: async () => ({ moves: [{ from: 'P01', to: 'P02' }] }),
    move: async () => ({ version: 1, ply_count: 1, turn }),
  };
  const values = new Map<string, unknown>();
  const controller = new OnlineGameController(api as any, {
    read: key => values.get(key), write: (key, value) => { values.set(key, value); },
    remove: key => { values.delete(key); },
  }, () => {});
  await controller.create(false);
  const slow = controller.refresh();
  await controller.tapNode('P01');
  await controller.tapNode('P02');
  assert.equal(controller.snapshot.room?.version, 1);
  resolveRefresh({ ...room, token: null });
  await slow;
  assert.equal(controller.snapshot.room?.version, 1);
});

test('idempotent retry response does not rewind a newer opponent position', async () => {
  const { OnlineGameController } = await import('../miniprogram/pages/online/online-game.ts');
  const { ApiError } = await import('../miniprogram/services/api-client.ts');
  const initial = createInitialGameState();
  const first = RuleEngine.executeTurn(initial, { from: 'P01', to: 'P02' });
  const second = RuleEngine.executeTurn(first.state, { from: 'P05', to: 'P04' });
  const room = { game_id: 'retry-room', seat: 'A' as const,
    room_status: 'PLAYING' as const, invite_code: 'ABCDEFGH', public: false,
    expires_at: new Date().toISOString(), version: 0, ply_count: 0, pending_undo: null, state: initial, token: 'secret' };
  let moves = 0;
  const values = new Map<string, unknown>();
  const controller = new OnlineGameController({
    create: async () => room,
    get: async () => ({ ...room, version: 2, ply_count: 2, state: second.state, token: null }),
    legal: async () => ({ moves: [{ from: 'P01', to: 'P02' }] }),
    move: async () => {
      moves++;
      if (moves === 1) throw new ApiError('NETWORK_ERROR', 0);
      return { version: 1, ply_count: 1, turn: first };
    },
  } as any, {
    read: key => values.get(key), write: (key, value) => { values.set(key, value); },
    remove: key => { values.delete(key); },
  }, () => {});
  await controller.create(false);
  await controller.tapNode('P01');
  await controller.tapNode('P02');
  await controller.refresh();
  assert.equal(controller.snapshot.room?.version, 2);
  await controller.retryMove();
  assert.equal(controller.snapshot.room?.version, 2);
  assert.equal(controller.snapshot.room?.state.board.occupancy.P04, 'B');
});

test('a cancelled waiting room stays closed when an older poll returns late', async () => {
  const { OnlineGameController } = await import('../miniprogram/pages/online/online-game.ts');
  const initial = createInitialGameState();
  const waiting = { game_id: 'cancel-room', seat: 'A' as const,
    room_status: 'WAITING' as const, invite_code: 'ABCDEFGH', public: false,
    expires_at: new Date().toISOString(), version: 0, ply_count: 0, pending_undo: null, state: initial, token: 'host-seat' };
  let resolvePoll!: (value: any) => void;
  const values = new Map<string, unknown>();
  const controller = new OnlineGameController({
    create: async () => waiting,
    get: () => new Promise(resolve => { resolvePoll = resolve; }),
    cancel: async () => ({ ...waiting, room_status: 'CANCELLED', token: null }),
  } as any, {
    read: key => values.get(key), write: (key, value) => { values.set(key, value); },
    remove: key => { values.delete(key); },
  }, () => {});
  await controller.create(false);
  const poll = controller.refresh();
  await controller.cancel();
  resolvePoll({ ...waiting, token: null });
  await poll;
  assert.equal(controller.snapshot.room, null);
  assert.equal(values.has('wuma:online:active'), false);
});
