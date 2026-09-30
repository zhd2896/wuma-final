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

const { createDeviceHistoryStore, HISTORY_STORAGE_KEY } =
  await import('../miniprogram/services/device-history.ts');

test('records actual games once, keeps creation time, and sorts recent moves first', () => {
  const values = new Map<string, unknown>();
  let now = 1000;
  const storage = { get: (key: string) => values.get(key),
    set: (key: string, value: unknown) => { values.set(key, value); },
    remove: (key: string) => { values.delete(key); } };
  const history = createDeviceHistoryStore(storage, () => now);
  const initial = createInitialGameState();
  assert.deepEqual(history.list(), []);
  history.record({ id: 'ai-1', mode: 'ai', state: initial, turns: 0 });
  now = 2000;
  history.record({ id: 'remote-1', mode: 'remote', state: initial, turns: 0 });
  now = 3000;
  const turn = RuleEngine.executeTurn(initial, { from: 'P01', to: 'P02' });
  history.record({ id: 'ai-1', mode: 'ai', state: turn.state, turns: 1 });
  const rows = history.list();
  assert.deepEqual(rows.map((row: any) => row.id), ['ai-1', 'remote-1']);
  assert.equal(rows[0].startedAt, 1000);
  assert.equal(rows[0].updatedAt, 3000);
  assert.equal(rows[0].turns, 1);
  assert.equal(rows[0].status, 'PLAYING');
  assert.equal(rows[0].localState, undefined);
  assert.equal((values.get(HISTORY_STORAGE_KEY) as any).version, 1);
});

test('restores the real local position after a new store instance opens it', () => {
  const values = new Map<string, unknown>();
  const storage = { get: (key: string) => values.get(key),
    set: (key: string, value: unknown) => { values.set(key, structuredClone(value)); },
    remove: (key: string) => { values.delete(key); } };
  const initial = createInitialGameState();
  const turn = RuleEngine.executeTurn(initial, { from: 'P01', to: 'P02' });
  createDeviceHistoryStore(storage, () => 10).record({ id: 'local-1', mode: 'local',
    state: initial, turns: 0 });
  createDeviceHistoryStore(storage, () => 20).record({ id: 'local-1', mode: 'local',
    state: turn.state, turns: 1, lastMove: turn.move });
  const saved = createDeviceHistoryStore(storage, () => 30).get('local-1');
  assert.equal(saved?.mode, 'local');
  assert.equal(saved?.localState?.board.occupancy.P02, 'A');
  assert.equal(saved?.localState?.current_player, 'B');
  assert.equal(saved?.lastMove?.to, 'P02');
  assert.equal(saved?.turns, 1);
});

test('restores a local game finished by resignation', () => {
  const values = new Map<string, unknown>();
  const storage = { get: (key: string) => values.get(key),
    set: (key: string, value: unknown) => { values.set(key, structuredClone(value)); },
    remove: (key: string) => { values.delete(key); } };
  const resigned = { ...createInitialGameState(), game_status: 'FINISHED' as const,
    winner: 'A' as const, winner_reason: 'RESIGN' as const };
  createDeviceHistoryStore(storage, () => 10).record({ id: 'local-resign', mode: 'local',
    state: resigned, turns: 3 });

  const saved = createDeviceHistoryStore(storage, () => 20).get('local-resign');

  assert.equal(saved?.status, 'FINISHED');
  assert.equal(saved?.winner, 'A');
  assert.equal(saved?.winnerReason, 'RESIGN');
  assert.equal(saved?.localState?.winner_reason, 'RESIGN');
});

test('rejects a damaged history index instead of displaying invented empty history', () => {
  const storage = { get: () => ({ version: 1, records: [{ id: 'bad' }] }),
    set: () => {}, remove: () => {} };
  assert.throws(() => createDeviceHistoryStore(storage).list(), /history/i);
});

test('stores the terminal result of an actual legal game without inventing a winner', () => {
  const values = new Map<string, unknown>();
  const storage = { get: (key: string) => values.get(key),
    set: (key: string, value: unknown) => { values.set(key, value); },
    remove: (key: string) => { values.delete(key); } };
  const sequence = [
    ['P01', 'P19'], ['P05', 'P01'], ['P16', 'P18'], ['P01', 'P07'],
    ['P18', 'P13'], ['P07', 'P03'], ['P11', 'P17'], ['P10', 'P07'],
    ['P06', 'P11'], ['P15', 'P14'], ['P17', 'P22'], ['P14', 'P04'],
    ['P19', 'P23'], ['P20', 'P17'],
  ] as const;
  let state = createInitialGameState();
  for (const [from, to] of sequence) state = RuleEngine.executeTurn(state, { from, to }).state;
  assert.equal(state.game_status, 'FINISHED');
  createDeviceHistoryStore(storage).record({ id: 'finished-1', mode: 'remote',
    state, turns: sequence.length });
  const saved = createDeviceHistoryStore(storage).get('finished-1');
  assert.equal(saved?.winner, 'B');
  assert.equal(saved?.winnerReason, 'LONE_PIECE_IMMOBILIZED');
  assert.equal(saved?.status, 'FINISHED');
  assert.equal(saved?.turns, sequence.length);
});

test('local undo frames survive storage with defensive copies and old records default to no frame', () => {
  const values = new Map<string, unknown>();
  const storage = { get: (key: string) => values.get(key),
    set: (key: string, value: unknown) => { values.set(key, structuredClone(value)); },
    remove: (key: string) => { values.delete(key); } };
  const initial = createInitialGameState();
  const turn = RuleEngine.executeTurn(initial, { from: 'P01', to: 'P02' });
  const frame = { gameState: initial, lastMove: null };
  const store = createDeviceHistoryStore(storage, () => 10);

  store.record({ id: 'local-frame', mode: 'local', state: turn.state, turns: 1,
    lastMove: turn.move, localUndoFrame: frame });
  const first = store.get('local-frame')!;
  assert.deepEqual(first.localUndoFrame, frame);
  assert.notEqual(first.localUndoFrame, frame);
  (first.localUndoFrame!.gameState.board.occupancy as any).P01 = null;
  assert.equal(store.get('local-frame')?.localUndoFrame?.gameState.board.occupancy.P01, 'A');

  const envelope = values.get(HISTORY_STORAGE_KEY) as any;
  delete envelope.records[0].localUndoFrame;
  delete envelope.records[0].lastMove;
  values.set(HISTORY_STORAGE_KEY, envelope);
  const legacy = createDeviceHistoryStore(storage).get('local-frame');
  assert.equal(legacy?.localUndoFrame, null);
  assert.equal(legacy?.lastMove, null);
});

test('damaged local undo frames are rejected instead of poisoning a resumed game', () => {
  const initial = createInitialGameState();
  const invalid = {
    version: 1,
    records: [{
      id: 'bad-frame', mode: 'local', startedAt: 1, updatedAt: 1, turns: 1,
      status: 'PLAYING', winner: null, winnerReason: null,
      localState: initial, lastMove: { from: 'P01', to: 'P02' },
      localUndoFrame: { gameState: { ...initial, current_player: 'C' }, lastMove: null },
    }],
  };
  const storage = { get: () => invalid, set: () => {}, remove: () => {} };
  assert.throws(() => createDeviceHistoryStore(storage).list(), /history/i);
});

test('undo frames must describe a playable pre-move position', () => {
  const initial = createInitialGameState();
  const terminal = { ...initial, game_status: 'FINISHED' as const,
    winner: 'B' as const, winner_reason: 'RESIGN' as const };
  const invalid = {
    version: 1,
    records: [{
      id: 'terminal-frame', mode: 'local', startedAt: 1, updatedAt: 1, turns: 1,
      status: 'PLAYING', winner: null, winnerReason: null,
      localState: initial, lastMove: null,
      localUndoFrame: { gameState: terminal, lastMove: null },
    }],
  };
  const storage = { get: () => invalid, set: () => {}, remove: () => {} };
  assert.throws(() => createDeviceHistoryStore(storage).list(), /history/i);
});
