import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { RuleEngine, createInitialGameState } from '../miniprogram/domain/index.ts';
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); } catch (error) {
    if (specifier.startsWith('.') && context.parentURL && (error as any).code === 'ERR_MODULE_NOT_FOUND') {
      const url = new URL(specifier + '.ts', context.parentURL);
      if (existsSync(url)) return next(url.href, context);
    }
    throw error;
  }
} });
const { OnlineGameController } = await import('../miniprogram/pages/online/online-game.ts');
const { requireOnlineRoom } = await import('../miniprogram/services/online-api.ts');
const { roomCountdown } = await import('../miniprogram/pages/online/online-presentation.ts');
function setup() {
  const initial = createInitialGameState();
  let current: any = { game_id: 'room-ux', seat: 'A', room_status: 'PLAYING', invite_code: 'ABCDEFGH',
    public: false, expires_at: '2026-10-09T08:30:00', version: 0, ply_count: 0,
    pending_undo: null, state: initial, token: 'host-ux' };
  let fails = false, legalCalls = 0, operations = 0;
  const map = new Map<string, unknown>();
  const api: any = { create: async () => current, get: async () => { if (fails) throw Error('offline'); return current; },
    legal: async () => { legalCalls++; return { moves: RuleEngine.getLegalMoves(current.state) }; },
    requestUndo: async () => { operations++; return current; }, resign: async () => { operations++; return current; } };
  const controller = new OnlineGameController(api, { read: key => map.get(key),
    write: (key, value) => { map.set(key, value); }, remove: key => { map.delete(key); } }, () => {});
  return { controller, initial, map, set: (room: any) => { current = room; }, room: () => current,
    offline: (value: boolean) => { fails = value; }, calls: () => ({ legalCalls, operations }) };
}
test('refresh shows the authoritative last turn, reports skipped moves, and clears it after undo', async () => {
  const x = setup(); await x.controller.create(false);
  const a = RuleEngine.executeTurn(x.initial, { from: 'P01', to: 'P02' });
  const b = RuleEngine.executeTurn(a.state, { from: 'P05', to: 'P04' });
  x.set({ ...x.room(), version: 2, ply_count: 2, state: b.state,
    last_turn: { version: 2, ply: 2, move: b.move, captures: b.captures } });
  await x.controller.refresh();
  assert.deepEqual(x.controller.snapshot.lastMove, b.move);
  assert.deepEqual(x.controller.snapshot.lastCapture, b.captures);
  assert.equal(x.controller.snapshot.skippedTurns, 1);
  await x.controller.refresh();
  assert.equal(x.controller.snapshot.skippedTurns, 1, 'background polling retains the recovery explanation');
  x.set({ ...x.room(), version: 3, ply_count: 0, state: x.initial, last_turn: null });
  await x.controller.refresh();
  assert.equal(x.controller.snapshot.lastMove, null);
  assert.equal(x.controller.snapshot.skippedTurns, 0);
});
test('failed synchronization prevents new moves and operations, recovery re-enables them', async () => {
  const x = setup(); await x.controller.create(false);
  x.offline(true); await x.controller.refresh();
  assert.equal(x.controller.snapshot.connection, 'offline');
  await x.controller.tapNode('P01'); await x.controller.resign();
  assert.deepEqual(x.calls(), { legalCalls: 0, operations: 0 });
  assert.equal(x.controller.snapshot.canResign, false);
  x.offline(false); await x.controller.refresh();
  assert.equal(x.controller.snapshot.connection, 'connected');
  assert.ok(x.controller.snapshot.lastSyncedAt);
  await x.controller.tapNode('P01'); assert.equal(x.calls().legalCalls, 1);
});
test('temporarily leaving keeps the active resume key; finished rooms clear it', async () => {
  const x = setup(); await x.controller.create(false); x.controller.leave();
  assert.equal(x.map.get('wuma:online:active'), 'room-ux');
  assert.equal(x.controller.snapshot.resumeGameId, 'room-ux');
  assert.equal(x.controller.snapshot.room, null);
});
test('a last-turn hint with an unrelated version cannot be displayed', () => {
  const x = setup(); const a = RuleEngine.executeTurn(x.initial, { from: 'P01', to: 'P02' });
  assert.throws(() => requireOnlineRoom({ ...x.room(), last_turn: {
    version: 7, ply: 1, move: a.move, captures: a.captures } }));
});
test('waiting countdown uses the actual UTC deadline including legacy timezone-less values', () => {
  const now = Date.parse('2026-10-09T08:28:30Z');
  assert.equal(roomCountdown('2026-10-09T08:30:00', now), '剩余 1 分 30 秒');
  assert.equal(roomCountdown('2026-10-09T16:30:00+08:00', now), '剩余 1 分 30 秒');
  assert.match(roomCountdown('invalid', now), /无法确认/);
  assert.match(roomCountdown('2026-10-09T08:28:00Z', now), /期限已到/);
});
