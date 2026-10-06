import { ApiError } from './api-client';
import { requireOnlineRoom } from './online-api';
import type { OnlineApi, OnlineRoom } from './online-api';

export const ACTIVE_ONLINE_KEY = 'wuma:online:active';
export const DEVICE_ONLINE_KEY = 'wuma:online:device';

export interface OnlineStorage {
  read(key: string): unknown;
  write(key: string, value: unknown): void;
  remove(key: string): void;
}

const seatKey = (gameId: string) => `wuma:online:seat:${gameId}`;
const nonemptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export function readOnlineSeat(storage: OnlineStorage, gameId: string): string | null {
  if (!nonemptyString(gameId)) return null;
  const token = storage.read(seatKey(gameId));
  return nonemptyString(token) ? token : null;
}

export function writeOnlineSeat(storage: OnlineStorage, gameId: string, token: string): void {
  if (!nonemptyString(gameId) || !nonemptyString(token)) throw new Error('Invalid online seat credential');
  storage.write(seatKey(gameId), token);
}

export function removeOnlineSeat(storage: OnlineStorage, gameId: string): void {
  if (nonemptyString(gameId)) storage.remove(seatKey(gameId));
}

export function requireOnlineSeat(storage: OnlineStorage, gameId: string): string {
  const token = readOnlineSeat(storage, gameId);
  if (!token) throw new ApiError('REMOTE_ACCESS_DENIED', 403);
  return token;
}

export async function restoreOnlineSeat(api: OnlineApi, storage: OnlineStorage, gameId: string):
    Promise<{ room: OnlineRoom; token: string }> {
  const saved = readOnlineSeat(storage, gameId);
  let room: OnlineRoom;
  let token = saved;
  if (saved) {
    try {
      room = requireOnlineRoom(await api.get(gameId, saved), { game_id: gameId });
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'REMOTE_ACCESS_DENIED') throw error;
      room = requireOnlineRoom(await api.recover(gameId), { game_id: gameId });
      token = room.token;
    }
    if (room.account_bound === false) {
      room = requireOnlineRoom(await api.claim(gameId, saved), { game_id: gameId, seat: room.seat });
      token = room.token;
    }
  } else {
    room = requireOnlineRoom(await api.recover(gameId), { game_id: gameId });
    token = room.token;
  }
  if (typeof token !== 'string' || !token.trim()) throw new ApiError('INVALID_GAME_RESPONSE', 502);
  if (token !== saved) writeOnlineSeat(storage, gameId, token);
  return { room, token };
}
