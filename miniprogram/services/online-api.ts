import type { GameState, Move, NodeId, Player, TurnResult } from '../domain/index';
import type { ApiClient } from './api-client';

export interface OnlineRoom {
  readonly game_id: string;
  readonly seat: Player;
  readonly room_status: 'WAITING' | 'PLAYING' | 'FINISHED' | 'CANCELLED' | 'EXPIRED';
  readonly invite_code: string;
  readonly public: boolean;
  readonly expires_at: string;
  readonly version: number;
  readonly state: GameState;
  readonly token: string | null;
}

export interface OnlineMoveRequest {
  readonly from_node: NodeId;
  readonly to_node: NodeId;
  readonly expected_version: number;
  readonly client_request_id: string;
}

export interface OnlineApi {
  create(deviceId: string, publicRoom: boolean): Promise<OnlineRoom>;
  join(deviceId: string, inviteCode: string): Promise<OnlineRoom>;
  match(deviceId: string): Promise<OnlineRoom>;
  get(id: string, token: string): Promise<OnlineRoom>;
  cancel(id: string, token: string): Promise<OnlineRoom>;
  legal(id: string, token: string, from: NodeId): Promise<{ moves: Move[] }>;
  move(id: string, token: string, request: OnlineMoveRequest): Promise<{ version: number; turn: TurnResult }>;
}

export function createOnlineApi(client: ApiClient): OnlineApi {
  const base = (id: string) => `/api/v1/remote/rooms/${encodeURIComponent(id)}`;
  const auth = (token: string) => ({ 'X-Room-Token': token,
    'content-type': 'application/json' });
  return {
    create: (deviceId, publicRoom) => client.request('POST', '/api/v1/remote/rooms',
      { device_id: deviceId, public: publicRoom }),
    join: (deviceId, inviteCode) => client.request('POST', '/api/v1/remote/join',
      { device_id: deviceId, invite_code: inviteCode }),
    match: deviceId => client.request('POST', '/api/v1/remote/match', { device_id: deviceId }),
    get: (id, token) => client.request('GET', base(id), undefined, 10000, auth(token)),
    cancel: (id, token) => client.request('POST', `${base(id)}/cancel`, {}, 10000, auth(token)),
    legal: (id, token, from) => client.request('GET',
      `${base(id)}/legal-moves?from_node=${encodeURIComponent(from)}`,
      undefined, 10000, auth(token)),
    move: (id, token, request) => client.request('POST', `${base(id)}/move`,
      request, 15000, auth(token)),
  };
}
