import { NODE_IDS } from '../domain/index';
import type { GameState, Move, NodeId, Player, TurnResult } from '../domain/index';
import { ApiError } from './api-client';
import type { ApiClient } from './api-client';
import { requirePlyCount } from './game-api';
import { requireReplay } from './replay-contract';
import type { GameReviewDto, GameReplayDto } from './api-contract';

export interface PendingOnlineUndo {
  readonly id: string;
  readonly requester: Player;
  readonly responder: Player;
  readonly base_revision: number;
  readonly anchor_turn: number;
  readonly revert_count: number;
  readonly status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'STALE';
}

export interface OnlineOperationRequest {
  readonly expected_version: number;
  readonly client_request_id: string;
}

export interface OnlineRoom {
  readonly account_bound?: boolean;
  readonly game_id: string;
  readonly seat: Player;
  readonly room_status: 'WAITING' | 'PLAYING' | 'FINISHED' | 'CANCELLED' | 'EXPIRED';
  readonly invite_code: string;
  readonly public: boolean;
  readonly expires_at: string;
  readonly version: number;
  readonly ply_count: number;
  readonly pending_undo: PendingOnlineUndo | null;
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
  recover(id: string): Promise<OnlineRoom>;
  claim(id: string, token: string): Promise<OnlineRoom>;
  getReview(id: string, token: string): Promise<GameReviewDto>;
  getReplay(id: string, token: string): Promise<GameReplayDto>;
  createReview(id: string, token: string): Promise<GameReviewDto>;
  create(deviceId: string, publicRoom: boolean): Promise<OnlineRoom>;
  join(deviceId: string, inviteCode: string): Promise<OnlineRoom>;
  match(deviceId: string): Promise<OnlineRoom>;
  get(id: string, token: string): Promise<OnlineRoom>;
  cancel(id: string, token: string): Promise<OnlineRoom>;
  legal(id: string, token: string, from: NodeId): Promise<{ moves: Move[] }>;
  requestUndo(id: string, token: string, request: OnlineOperationRequest): Promise<OnlineRoom>;
  acceptUndo(id: string, token: string, undoId: string, request: OnlineOperationRequest): Promise<OnlineRoom>;
  declineUndo(id: string, token: string, undoId: string, request: OnlineOperationRequest): Promise<OnlineRoom>;
  resign(id: string, token: string, request: OnlineOperationRequest): Promise<OnlineRoom>;
  move(id: string, token: string, request: OnlineMoveRequest): Promise<{ version: number; ply_count: number; turn: TurnResult }>;
}

export function requireOnlineRoom(value: OnlineRoom, expected?: { game_id: string; seat?: Player }): OnlineRoom {
  const validPlayer = (player: unknown) => player === 'A' || player === 'B';
  const integer = (number: unknown) => Number.isInteger(number) && (number as number) >= 0;
  if (!value || typeof value !== 'object' || typeof value.game_id !== 'string' || !value.game_id || !validPlayer(value.seat) ||
      !integer(value.version) || !['WAITING', 'PLAYING', 'FINISHED', 'CANCELLED', 'EXPIRED'].includes(value.room_status) ||
      !value.state || !value.state.board?.occupancy || !value.state.players?.A || !value.state.players?.B ||
      !validPlayer(value.state.current_player) || !['PLAYING', 'FINISHED'].includes(value.state.game_status) ||
      (expected && (value.game_id !== expected.game_id || (expected.seat && value.seat !== expected.seat)))) {
    throw new ApiError('INVALID_GAME_RESPONSE', 502);
  }
  requirePlyCount(value);
  const state = value.state;
  if (!NODE_IDS.every(id => state.board.occupancy[id] === null || validPlayer(state.board.occupancy[id])) ||
      !integer(state.players.A.reserve_count) || !integer(state.players.B.reserve_count) ||
      !validPlayer(state.first_player) ||
      (state.game_status === 'PLAYING'
        ? state.winner !== null || state.winner_reason !== null
        : !validPlayer(state.winner) || !['CAPTURE_ALL', 'TEMPLE_TRAP', 'LONE_PIECE_IMMOBILIZED', 'RESIGN'].includes(state.winner_reason ?? '')) ||
      (value.room_status === 'FINISHED') !== (state.game_status === 'FINISHED')) {
    throw new ApiError('INVALID_GAME_RESPONSE', 502);
  }
  const undo = value.pending_undo;
  if (undo !== null && (!undo || typeof undo.id !== 'string' || !undo.id ||
      !validPlayer(undo.requester) || !validPlayer(undo.responder) || undo.requester === undo.responder ||
      !integer(undo.base_revision) || !integer(undo.anchor_turn) || undo.anchor_turn < 1 ||
      (undo.revert_count !== 1 && undo.revert_count !== 2) || undo.status !== 'PENDING')) {
    throw new ApiError('INVALID_GAME_RESPONSE', 502);
  }
  return value;
}

export function createOnlineApi(client: ApiClient): OnlineApi {
  const base = (id: string) => `/api/v1/remote/rooms/${encodeURIComponent(id)}`;
  const auth = (token: string) => ({ 'X-Room-Token': token,
    'content-type': 'application/json' });
  return {
    recover: id => client.request('POST', `${base(id)}/recover`, {}),
    claim: (id, token) => client.request('POST', `${base(id)}/claim`, {}, 10000, auth(token)),
    getReview: (id, token) => client.request('GET', `${base(id)}/review`, undefined, 10000, auth(token)),
    getReplay: async (id, token) => requireReplay(await client.request<GameReplayDto>('GET',
      `${base(id)}/replay`, undefined, 10000, auth(token)), id),
    createReview: (id, token) => client.request('POST', `${base(id)}/review`, {}, 120000, auth(token)),
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
    requestUndo: (id, token, request) => client.request('POST', `${base(id)}/undo-requests`,
      request, 15000, auth(token)),
    acceptUndo: (id, token, undoId, request) => client.request('POST',
      `${base(id)}/undo-requests/${encodeURIComponent(undoId)}/accept`, request, 15000, auth(token)),
    declineUndo: (id, token, undoId, request) => client.request('POST',
      `${base(id)}/undo-requests/${encodeURIComponent(undoId)}/decline`, request, 15000, auth(token)),
    resign: (id, token, request) => client.request('POST', `${base(id)}/resign`,
      request, 15000, auth(token)),
    move: (id, token, request) => client.request('POST', `${base(id)}/move`,
      request, 15000, auth(token)),
  };
}
