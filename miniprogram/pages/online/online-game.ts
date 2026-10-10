import { NODE_IDS } from '../../domain/index';
import type { CaptureResult, Move, NodeId } from '../../domain/index';
import { ApiError, messageForApiError } from '../../services/api-client';
import { requirePlyCount } from '../../services/game-api';
import { requireOnlineRoom } from '../../services/online-api';
import type { OnlineApi, OnlineMoveRequest, OnlineOperationRequest, OnlineRoom } from '../../services/online-api';
import { ACTIVE_ONLINE_KEY, DEVICE_ONLINE_KEY, restoreOnlineSeat, writeOnlineSeat } from '../../services/online-credentials';
import type { OnlineStorage } from '../../services/online-credentials';
export type { OnlineStorage } from '../../services/online-credentials';

export interface OnlineSnapshot {
  readonly connection: 'connected' | 'reconnecting' | 'offline';
  readonly lastSyncedAt: number | null;
  readonly skippedTurns: number;
  readonly resumeGameId: string | null;
  readonly room: OnlineRoom | null;
  readonly selectedNode: NodeId | null;
  readonly legalTargets: readonly NodeId[];
  readonly lastMove: Move | null;
  readonly lastCapture: CaptureResult | null;
  readonly busy: boolean;
  readonly error: string;
  readonly pendingMove: boolean;
  readonly pendingOperation: boolean;
  readonly isOperating: boolean;
  readonly canRequestUndo: boolean;
  readonly canRespondToUndo: boolean;
  readonly canResign: boolean;
  readonly operationNotice: string;
  readonly successfulAction: number;
}

type OperationAction = 'requestUndo' | 'acceptUndo' | 'declineUndo' | 'resign';
interface PendingOperation {
  readonly gameId: string;
  readonly action: OperationAction;
  readonly target: string | null;
  readonly request: OnlineOperationRequest;
}

function identifier(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

function definitiveRejection(error: unknown): boolean {
  return error instanceof ApiError && [
    'GAME_STATE_CONFLICT', 'GAME_ALREADY_FINISHED', 'UNDO_NOT_AVAILABLE',
    'OPERATION_REQUEST_CONFLICT', 'OPERATION_ALREADY_PENDING', 'REMOTE_UNDO_PENDING',
    'OPERATION_NOT_ALLOWED', 'REMOTE_REQUEST_CONFLICT', 'NOT_YOUR_TURN',
    'REMOTE_UNDO_NOT_FOUND', 'REMOTE_UNDO_UNAVAILABLE',
    'REMOTE_ROOM_NOT_FOUND', 'REMOTE_ACCESS_DENIED', 'REMOTE_ROOM_UNAVAILABLE',
    'INVALID_MOVE', 'PATH_BLOCKED', 'TARGET_OCCUPIED', 'NODE_NOT_FOUND',
  ].includes(error.code);
}

export class OnlineGameController {
  private readonly api: OnlineApi;
  private readonly storage: OnlineStorage;
  private readonly onChange: (snapshot: OnlineSnapshot) => void;
  private state: OnlineSnapshot = {
    connection: 'reconnecting', lastSyncedAt: null, skippedTurns: 0, resumeGameId: null,
    room: null, selectedNode: null, legalTargets: [], lastMove: null,
    lastCapture: null, busy: false, error: '', pendingMove: false,
    pendingOperation: false, isOperating: false, canRequestUndo: false,
    canRespondToUndo: false, canResign: false, operationNotice: '', successfulAction: 0,
  };
  private token = '';
  private restoreGameId: string | null = null;
  private pending: OnlineMoveRequest | null = null;
  private operation: PendingOperation | null = null;
  private refreshing = false;
  private generation = 0;
  private disposed = false;

  constructor(api: OnlineApi, storage: OnlineStorage,
              onChange: (snapshot: OnlineSnapshot) => void) {
    this.api = api; this.storage = storage; this.onChange = onChange;
  }

  get snapshot(): OnlineSnapshot { return this.state; }
  pause(): void {
    this.invalidateRefresh();
    this.publish({ connection: 'reconnecting', selectedNode: null, legalTargets: [] });
  }
  private get hasPending(): boolean { return !!(this.pending || this.operation); }

  private publish(patch: Partial<OnlineSnapshot>): void {
    if (this.disposed) return;
    const next = { ...this.state, ...patch };
    const playable = next.room?.room_status === 'PLAYING' && next.room.state.game_status === 'PLAYING';
    const available = !!playable && next.connection === 'connected' && !next.busy && !this.hasPending;
    this.state = { ...next,
      pendingOperation: !!this.operation,
      canRequestUndo: available && !next.room?.pending_undo && (next.room?.ply_count ?? 0) > 0,
      canRespondToUndo: available && !!next.room?.pending_undo &&
        next.room.pending_undo.responder === next.room.seat,
      canResign: available,
    };
    this.onChange(this.state);
  }

  private invalidateRefresh(): void { this.generation++; this.refreshing = false; }

  private deviceId(): string {
    const stored = this.storage.read(DEVICE_ONLINE_KEY);
    if (typeof stored === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(stored)) return stored;
    const id = identifier();
    this.storage.write(DEVICE_ONLINE_KEY, id);
    return id;
  }

  private saveRoom(value: OnlineRoom): void {
    const room = requireOnlineRoom(value);
    if (typeof room.token !== 'string' || !room.token.trim()) throw new ApiError('INVALID_GAME_RESPONSE', 502);
    this.token = room.token;
    this.restoreGameId = null;
    this.invalidateRefresh();
    this.publish({ room, connection: 'connected', lastSyncedAt: Date.now(), skippedTurns: 0, resumeGameId: null,
      selectedNode: null, legalTargets: [], lastMove: room.last_turn?.move ?? null,
      lastCapture: room.last_turn?.captures ?? null, pendingMove: false, error: '', operationNotice: '' });
    try {
      writeOnlineSeat(this.storage, room.game_id, room.token);
      this.storage.write(ACTIVE_ONLINE_KEY, room.game_id);
    } catch {
      this.publish({ error: '本机无法保存席位凭证，退出后可能无法重连' });
    }
  }

  private async begin(action: () => Promise<OnlineRoom>): Promise<void> {
    if (this.disposed || this.state.busy || this.hasPending) return;
    this.publish({ busy: true, error: '' });
    try { this.saveRoom(await action()); }
    catch (error) { this.publish({ error: messageForApiError(error) }); }
    finally { this.publish({ busy: false }); }
  }

  create(publicRoom: boolean): Promise<void> {
    return this.begin(() => this.api.create(this.deviceId(), publicRoom));
  }
  match(): Promise<void> { return this.begin(() => this.api.match(this.deviceId())); }
  join(code: string): Promise<void> {
    if (this.disposed || this.hasPending || this.state.busy) return Promise.resolve();
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(normalized)) {
      this.publish({ error: '请输入 8 位房间码' }); return Promise.resolve();
    }
    return this.begin(() => this.api.join(this.deviceId(), normalized));
  }

  async restore(id?: string): Promise<void> {
    if (this.disposed || this.state.busy || this.hasPending) return;
    try {
      const gameId = id ?? this.storage.read(ACTIVE_ONLINE_KEY);
      if (typeof gameId !== 'string' || !gameId.trim()) return;
      this.restoreGameId = gameId;
      this.publish({ resumeGameId: gameId, connection: 'reconnecting' });
      await this.begin(async () => {
        const restored = await restoreOnlineSeat(this.api, this.storage, gameId);
        return { ...restored.room, token: restored.token };
      });
    } catch (error) { this.publish({ error: messageForApiError(error), connection: 'offline' }); }
  }

  async refresh(requestedId?: string, foreground = false): Promise<void> {
    const current = this.state.room;
    const id = requestedId ?? current?.game_id;
    if (!id || !this.token || this.state.busy || this.refreshing || this.disposed) return;
    const generation = ++this.generation;
    this.refreshing = true;
    if (foreground || this.state.connection !== 'connected')
      this.publish({ connection: 'reconnecting', selectedNode: null, legalTargets: [] });
    try {
      const room = requireOnlineRoom(await this.api.get(id, this.token), { game_id: id, seat: current?.seat });
      if (this.disposed || generation !== this.generation) return;
      const latest = this.state.room;
      if (latest && (latest.game_id !== room.game_id || room.version < latest.version)) return;
      const changed = latest?.version !== room.version;
      this.publish({ room, connection: 'connected', lastSyncedAt: Date.now(), error: this.hasPending ? this.state.error : '',
        ...(changed ? { skippedTurns: Math.max(0, room.ply_count - (latest?.ply_count ?? room.ply_count) - 1) } : {}),
        ...(changed || room.pending_undo || room.room_status !== 'PLAYING' || room.state.game_status === 'FINISHED'
          ? { selectedNode: null, legalTargets: [], lastMove: room.last_turn?.move ?? null,
              lastCapture: room.last_turn?.captures ?? null } : {}) });
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.publish({ connection: 'offline', selectedNode: null, legalTargets: [],
        error: this.hasPending && this.state.error ? this.state.error : messageForApiError(error) });
    } finally {
      if (generation === this.generation) this.refreshing = false;
    }
  }

  async cancel(): Promise<void> {
    const room = this.state.room;
    if (!room || room.room_status !== 'WAITING' || room.seat !== 'A' || this.state.busy || this.hasPending || this.disposed) return;
    this.invalidateRefresh();
    this.publish({ busy: true, error: '' });
    try {
      requireOnlineRoom(await this.api.cancel(room.game_id, this.token), room);
      this.storage.remove(ACTIVE_ONLINE_KEY);
      this.restoreGameId = null;
      this.publish({ room: null, resumeGameId: null, selectedNode: null, legalTargets: [] });
    } catch (error) { this.publish({ error: messageForApiError(error) }); }
    finally { this.publish({ busy: false }); }
  }

  leave(): void {
    if (this.disposed || this.state.busy || this.hasPending) return;
    const room = this.state.room;
    const resumable = room && (room.room_status === 'PLAYING' || room.room_status === 'WAITING');
    if (!resumable) this.storage.remove(ACTIVE_ONLINE_KEY);
    this.restoreGameId = null;
    this.token = '';
    this.invalidateRefresh();
    this.publish({ room: null, resumeGameId: resumable ? room.game_id : null,
      selectedNode: null, legalTargets: [], lastMove: null, lastCapture: null,
      pendingMove: false, error: '', operationNotice: '' });
  }

  async tapNode(id: string): Promise<void> {
    const room = this.state.room;
    if (!room || this.state.connection !== 'connected' || !NODE_IDS.includes(id as NodeId) || this.state.busy || this.hasPending || this.disposed ||
        room.pending_undo || room.room_status !== 'PLAYING' || room.state.game_status !== 'PLAYING' ||
        room.state.current_player !== room.seat) return;
    const node = id as NodeId;
    if (this.state.selectedNode && this.state.legalTargets.includes(node)) {
      this.pending = { from_node: this.state.selectedNode, to_node: node,
        expected_version: room.version, client_request_id: identifier() };
      await this.submitPending(); return;
    }
    if (room.state.board.occupancy[node] !== room.seat) {
      this.publish({ selectedNode: null, legalTargets: [] }); return;
    }
    this.publish({ busy: true, selectedNode: node, legalTargets: [], error: '' });
    let resync = false;
    try {
      const legal = await this.api.legal(room.game_id, this.token, node);
      if (this.state.room?.version === room.version && this.state.selectedNode === node && !this.state.room.pending_undo)
        this.publish({ legalTargets: legal.moves.filter(move => move.from === node).map(move => move.to) });
    } catch (error) {
      this.publish({ connection: definitiveRejection(error) ? this.state.connection : 'offline',
        selectedNode: null, legalTargets: [], error: messageForApiError(error) });
      resync = definitiveRejection(error);
    } finally { this.publish({ busy: false }); }
    if (resync) await this.refresh();
  }

  async retryMove(): Promise<void> { if (this.pending) await this.submitPending(); }
  async retry(): Promise<void> {
    if (this.operation) await this.submitOperation();
    else if (this.pending) await this.submitPending();
    else if (!this.state.room && this.restoreGameId) await this.restore(this.restoreGameId);
    else await this.refresh();
  }

  requestUndo(): Promise<boolean> { return this.startOperation('requestUndo'); }
  acceptUndo(): Promise<boolean> { return this.startOperation('acceptUndo'); }
  declineUndo(): Promise<boolean> { return this.startOperation('declineUndo'); }
  resign(): Promise<boolean> { return this.startOperation('resign'); }

  private async startOperation(action: OperationAction): Promise<boolean> {
    const room = this.state.room;
    if (!room || this.disposed || this.state.busy || this.hasPending) return false;
    if (action === 'requestUndo' ? !this.state.canRequestUndo :
        action === 'resign' ? !this.state.canResign : !this.state.canRespondToUndo) return false;
    this.operation = { gameId: room.game_id, action,
      target: action === 'acceptUndo' || action === 'declineUndo' ? room.pending_undo!.id : null,
      request: { expected_version: room.version, client_request_id: identifier() } };
    return this.submitOperation();
  }

  private async submitOperation(): Promise<boolean> {
    const pending = this.operation;
    const before = this.state.room;
    if (!pending || !before || this.state.busy || this.disposed) return false;
    this.invalidateRefresh();
    this.publish({ busy: true, isOperating: true, error: '', selectedNode: null,
      legalTargets: [], lastMove: null, lastCapture: null, operationNotice: '' });
    let success = false;
    try {
      const result = pending.action === 'acceptUndo' || pending.action === 'declineUndo'
        ? await this.api[pending.action](pending.gameId, this.token, pending.target!, pending.request)
        : await this.api[pending.action](pending.gameId, this.token, pending.request);
      const room = requireOnlineRoom(result, before);
      if (room.version < pending.request.expected_version ||
          (pending.action === 'resign' && (room.version <= pending.request.expected_version ||
            room.room_status !== 'FINISHED' || room.state.winner_reason !== 'RESIGN' || room.state.winner === before.seat))) {
        throw new ApiError('INVALID_GAME_RESPONSE', 502);
      }
      this.operation = null;
      success = true;
      const latest = this.state.room;
      this.publish({ ...(latest && latest.version > room.version ? {} : { room }),
        connection: 'connected', lastSyncedAt: Date.now(),
        successfulAction: this.state.successfulAction + 1,
        operationNotice: pending.action === 'requestUndo' ? '悔棋申请已发送，等待对方处理' :
          pending.action === 'acceptUndo' ? '已同意悔棋' : pending.action === 'declineUndo' ? '已拒绝悔棋' : '已认输' });
    } catch (error) {
      if (definitiveRejection(error)) this.operation = null;
      this.publish({ error: messageForApiError(error),
        connection: definitiveRejection(error) ? this.state.connection : 'offline',
        operationNotice: this.operation ? '操作结果尚未确认，请点恢复操作，避免重复发起' : '' });
    } finally { this.publish({ busy: false, isOperating: false }); }
    await this.refresh();
    return success;
  }

  private async submitPending(): Promise<void> {
    const room = this.state.room;
    const request = this.pending;
    if (!room || !request || this.state.busy || this.disposed) return;
    this.invalidateRefresh();
    this.publish({ busy: true, pendingMove: true, error: '' });
    let resync = false;
    try {
      const result = await this.api.move(room.game_id, this.token, request);
      const plyCount = requirePlyCount(result);
      const capture = result.turn?.capture;
      if (!Number.isInteger(result.version) || result.version <= request.expected_version ||
          result.turn?.move?.from !== request.from_node || result.turn?.move?.to !== request.to_node || !capture ||
          typeof capture.was_applied !== 'boolean' || !Number.isInteger(capture.reserve_used) || capture.reserve_used < 0 ||
          !Array.isArray(capture.captured_nodes) || !capture.captured_nodes.every(node => NODE_IDS.includes(node)) ||
          !Array.isArray(capture.replacement_nodes) || !capture.replacement_nodes.every(node => NODE_IDS.includes(node))) {
        throw new ApiError('INVALID_GAME_RESPONSE', 502);
      }
      const updated = requireOnlineRoom({ ...room, version: result.version, ply_count: plyCount,
        last_turn: { version: result.version, ply: plyCount, move: result.turn.move, captures: result.turn.capture },
        pending_undo: null, state: result.turn.state,
        room_status: result.turn.state.game_status === 'FINISHED' ? 'FINISHED' : 'PLAYING' }, room);
      this.pending = null;
      const latest = this.state.room;
      this.publish({ ...(latest && latest.version > result.version ? {} : { room: updated,
        lastMove: result.turn.move, lastCapture: result.turn.capture }),
        connection: 'connected', lastSyncedAt: Date.now(), skippedTurns: 0,
        pendingMove: false, selectedNode: null, legalTargets: [],
        successfulAction: this.state.successfulAction + 1, operationNotice: '' });
    } catch (error) {
      if (definitiveRejection(error)) this.pending = null;
      this.publish({ connection: definitiveRejection(error) ? this.state.connection : 'offline',
        pendingMove: !!this.pending, error: messageForApiError(error) });
      resync = true;
    } finally { this.publish({ busy: false }); }
    if (resync) await this.refresh();
  }

  dispose(): void { this.disposed = true; this.invalidateRefresh(); }
}
