import { NODE_IDS } from '../domain/index';
import type { GameState, Move, Player } from '../domain/index';
import type { LocalUndoFrame } from '../pages/game/local-game';

export const HISTORY_STORAGE_KEY = 'wuma:history:v1';

export type HistoryMode = 'local' | 'remote' | 'ai' | 'online';

export interface DeviceHistoryEntry {
  readonly id: string;
  readonly mode: HistoryMode;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly turns: number;
  readonly status: GameState['game_status'];
  readonly winner: Player | null;
  readonly winnerReason: GameState['winner_reason'];
  readonly localState?: GameState;
  readonly lastMove?: Move | null;
  readonly localUndoFrame?: LocalUndoFrame | null;
}

export interface DeviceHistoryStorage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  remove(key: string): void;
}

export interface RecordDeviceGame {
  readonly id: string;
  readonly mode: HistoryMode;
  readonly state: GameState;
  readonly turns: number;
  readonly lastMove?: Move | null;
  readonly localUndoFrame?: LocalUndoFrame | null;
}

export interface DeviceHistoryStore {
  list(): DeviceHistoryEntry[];
  get(id: string): DeviceHistoryEntry | null;
  record(game: RecordDeviceGame): DeviceHistoryEntry;
  remove(id: string): void;
}

function validMove(value: unknown): value is Move | null | undefined {
  if (value === undefined || value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const move = value as Partial<Move>;
  return NODE_IDS.includes(move.from as typeof NODE_IDS[number]) &&
    NODE_IDS.includes(move.to as typeof NODE_IDS[number]);
}

function validGameState(value: unknown): value is GameState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<GameState>;
  const occupancy = state.board?.occupancy;
  if (!occupancy || typeof occupancy !== 'object' ||
      !NODE_IDS.every(id => occupancy[id] === null || occupancy[id] === 'A' || occupancy[id] === 'B')) {
    return false;
  }
  const validPlayer = (player: Player): boolean => Number.isInteger(state.players?.[player]?.reserve_count) &&
    (state.players?.[player]?.reserve_count ?? -1) >= 0;
  const validWinner = state.winner === null || state.winner === 'A' || state.winner === 'B';
  const validReason = state.winner_reason === null || state.winner_reason === 'CAPTURE_ALL' ||
    state.winner_reason === 'TEMPLE_TRAP' || state.winner_reason === 'LONE_PIECE_IMMOBILIZED' ||
    state.winner_reason === 'RESIGN';
  const validOutcome = state.game_status === 'PLAYING'
    ? state.winner === null && state.winner_reason === null
    : state.game_status === 'FINISHED' && state.winner !== null && state.winner_reason !== null;
  return (state.first_player === 'A' || state.first_player === 'B') &&
    (state.current_player === 'A' || state.current_player === 'B') &&
    validPlayer('A') && validPlayer('B') && validWinner && validReason && validOutcome;
}

function validUndoFrame(value: unknown): value is LocalUndoFrame | null | undefined {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'object') return false;
  const frame = value as Partial<LocalUndoFrame>;
  return validGameState(frame.gameState) && frame.gameState.game_status === 'PLAYING' &&
    Object.prototype.hasOwnProperty.call(frame, 'lastMove') && validMove(frame.lastMove);
}

function copyMove(move: Move | null | undefined): Move | null {
  return move ? { from: move.from, to: move.to } : null;
}

function copyGameState(state: GameState): GameState {
  return {
    ...state,
    board: { occupancy: { ...state.board.occupancy } },
    players: {
      A: { reserve_count: state.players.A.reserve_count },
      B: { reserve_count: state.players.B.reserve_count },
    },
  };
}

function copyUndoFrame(frame: LocalUndoFrame | null | undefined): LocalUndoFrame | null {
  return frame ? { gameState: copyGameState(frame.gameState), lastMove: copyMove(frame.lastMove) } : null;
}

function copyEntry(row: DeviceHistoryEntry): DeviceHistoryEntry {
  return {
    ...row,
    ...(row.mode === 'local' && row.localState ? {
      localState: copyGameState(row.localState),
      lastMove: copyMove(row.lastMove),
      localUndoFrame: copyUndoFrame(row.localUndoFrame),
    } : {}),
  };
}

function validEntry(value: unknown): value is DeviceHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<DeviceHistoryEntry>;
  const validMode = row.mode === 'local' || row.mode === 'remote' ||
    row.mode === 'ai' || row.mode === 'online';
  const validWinner = row.winner === null || row.winner === 'A' || row.winner === 'B';
  const validReason = row.winnerReason === null || row.winnerReason === 'CAPTURE_ALL' ||
    row.winnerReason === 'TEMPLE_TRAP' || row.winnerReason === 'LONE_PIECE_IMMOBILIZED' ||
    row.winnerReason === 'RESIGN';
  const validState = row.mode !== 'local' || (!!row.localState &&
    validGameState(row.localState) && row.localState.game_status === row.status &&
    row.localState.winner === row.winner && row.localState.winner_reason === row.winnerReason &&
    validMove(row.lastMove) && validUndoFrame(row.localUndoFrame));
  return typeof row.id === 'string' && row.id.length > 0 && validMode &&
    typeof row.startedAt === 'number' && Number.isFinite(row.startedAt) &&
    typeof row.updatedAt === 'number' && Number.isFinite(row.updatedAt) &&
    typeof row.turns === 'number' && Number.isInteger(row.turns) && row.turns >= 0 &&
    (row.status === 'PLAYING' || row.status === 'FINISHED') &&
    validWinner && validReason && validState &&
    (row.localUndoFrame == null || row.turns > 0);
}

export function createDeviceHistoryStore(storage: DeviceHistoryStorage,
                                         now: () => number = Date.now): DeviceHistoryStore {
  function read(): DeviceHistoryEntry[] {
    const data = storage.get(HISTORY_STORAGE_KEY);
    if (data === undefined || data === null || data === '') return [];
    if (!data || typeof data !== 'object') throw new Error('Device history is damaged');
    const parsed = data as { version?: unknown; records?: unknown };
    if (parsed.version !== 1 || !Array.isArray(parsed.records) ||
        !parsed.records.every(validEntry)) throw new Error('Device history is damaged');
    const ids = new Set(parsed.records.map((row: DeviceHistoryEntry) => row.id));
    if (ids.size !== parsed.records.length) throw new Error('Device history has duplicate IDs');
    return parsed.records.map((row: DeviceHistoryEntry) => copyEntry(row));
  }
  function write(records: DeviceHistoryEntry[]): void {
    if (records.length) storage.set(HISTORY_STORAGE_KEY,
      { version: 1, records: records.map(copyEntry) });
    else storage.remove(HISTORY_STORAGE_KEY);
  }
  return {
    list: () => read().slice().sort((a, b) =>
      b.updatedAt - a.updatedAt || b.startedAt - a.startedAt || a.id.localeCompare(b.id)),
    get: id => read().find(row => row.id === id) ?? null,
    record: game => {
      if (!game.id || !Number.isInteger(game.turns) || game.turns < 0) {
        throw new Error('Invalid device game record');
      }
      if (!validGameState(game.state) || !validMove(game.lastMove) ||
          (game.mode === 'local' && (!validUndoFrame(game.localUndoFrame) ||
            (game.localUndoFrame != null && game.turns === 0)))) {
        throw new Error('Invalid device game record');
      }
      const records = read();
      const index = records.findIndex(row => row.id === game.id);
      const previous = index < 0 ? null : records[index];
      if (previous && previous.mode !== game.mode) throw new Error('Device game mode changed');
      if (previous && previous.turns === game.turns &&
          previous.status === game.state.game_status &&
          previous.winner === game.state.winner &&
          previous.winnerReason === game.state.winner_reason) return previous;
      const timestamp = now();
      const row: DeviceHistoryEntry = {
        id: game.id, mode: game.mode, startedAt: previous?.startedAt ?? timestamp,
        updatedAt: timestamp, turns: game.turns,
        status: game.state.game_status, winner: game.state.winner,
        winnerReason: game.state.winner_reason,
        ...(game.mode === 'local' ? {
          localState: copyGameState(game.state), lastMove: copyMove(game.lastMove),
          localUndoFrame: copyUndoFrame(game.localUndoFrame),
        } : {}),
      };
      if (index < 0) records.push(row);
      else records[index] = row;
      write(records);
      return copyEntry(row);
    },
    remove: id => write(read().filter(row => row.id !== id)),
  };
}

export function createWxDeviceHistoryStore(): DeviceHistoryStore {
  return createDeviceHistoryStore({
    get: key => wx.getStorageSync(key),
    set: (key, value) => { wx.setStorageSync(key, value); },
    remove: key => { wx.removeStorageSync(key); },
  });
}
