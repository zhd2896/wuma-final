import { ApiError } from './api-client';

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
