import { NODE_IDS } from '../../domain/index';
import type { CaptureResult, Move, NodeId } from '../../domain/index';
import { ApiError, messageForApiError } from '../../services/api-client';
import type { OnlineApi, OnlineMoveRequest, OnlineRoom } from '../../services/online-api';

export const ACTIVE_ONLINE_KEY = 'wuma:online:active';
const DEVICE_KEY = 'wuma:online:device';
const seatKey = (id: string) => `wuma:online:seat:${id}`;

export interface OnlineStorage {
  read(key: string): unknown;
  write(key: string, value: unknown): void;
  remove(key: string): void;
}

export interface OnlineSnapshot {
  readonly room: OnlineRoom | null;
  readonly selectedNode: NodeId | null;
  readonly legalTargets: readonly NodeId[];
  readonly lastMove: Move | null;
  readonly lastCapture: CaptureResult | null;
  readonly busy: boolean;
  readonly error: string;
  readonly pendingMove: boolean;
}

function identifier(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

export class OnlineGameController {
  private readonly api: OnlineApi;
  private readonly storage: OnlineStorage;
  private readonly onChange: (snapshot: OnlineSnapshot) => void;
  private state: OnlineSnapshot = {
    room: null, selectedNode: null, legalTargets: [], lastMove: null,
    lastCapture: null, busy: false, error: '', pendingMove: false,
  };
  private token = '';
  private pending: OnlineMoveRequest | null = null;
  private refreshing = false;
  private generation = 0;
  private disposed = false;

  constructor(api: OnlineApi, storage: OnlineStorage,
              onChange: (snapshot: OnlineSnapshot) => void) {
    this.api = api; this.storage = storage; this.onChange = onChange;
  }

  get snapshot(): OnlineSnapshot { return this.state; }

  private publish(patch: Partial<OnlineSnapshot>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  private deviceId(): string {
    const stored = this.storage.read(DEVICE_KEY);
    if (typeof stored === 'string' && stored.length >= 8) return stored;
    const id = identifier();
    this.storage.write(DEVICE_KEY, id);
    return id;
  }

  private saveRoom(room: OnlineRoom): void {
    if (!room.token) throw new Error('Room did not issue a seat token');
    this.token = room.token;
    this.pending = null;
    this.publish({ room, selectedNode: null, legalTargets: [], lastMove: null,
      lastCapture: null, pendingMove: false, error: '' });
    try {
      this.storage.write(seatKey(room.game_id), room.token);
      this.storage.write(ACTIVE_ONLINE_KEY, room.game_id);
    } catch {
      this.publish({ error: '本机无法保存席位凭证，退出后可能无法重连' });
    }
  }

  private async begin(action: () => Promise<OnlineRoom>): Promise<void> {
    if (this.state.busy) return;
    this.publish({ busy: true, error: '' });
    try { this.saveRoom(await action()); }
    catch (error) { this.publish({ error: messageForApiError(error) }); }
    finally { this.publish({ busy: false }); }
  }

  create(publicRoom: boolean): Promise<void> {
    return this.begin(() => this.api.create(this.deviceId(), publicRoom));
  }

  match(): Promise<void> {
    return this.begin(() => this.api.match(this.deviceId()));
  }

  join(code: string): Promise<void> {
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(normalized)) {
      this.publish({ error: '请输入 8 位房间码' });
      return Promise.resolve();
    }
    return this.begin(() => this.api.join(this.deviceId(), normalized));
  }

  async restore(id?: string): Promise<void> {
    const gameId = id ?? this.storage.read(ACTIVE_ONLINE_KEY);
    if (typeof gameId !== 'string' || !gameId) return;
    const token = this.storage.read(seatKey(gameId));
    if (typeof token !== 'string' || !token) {
      this.publish({ error: '本机没有这个房间的席位凭证' });
      return;
    }
    this.token = token;
    this.storage.write(ACTIVE_ONLINE_KEY, gameId);
    await this.refresh(gameId);
  }

  async refresh(requestedId?: string): Promise<void> {
    const current = this.state.room;
    const id = requestedId ?? current?.game_id;
    if (!id || !this.token || this.state.busy || this.refreshing || this.disposed) return;
    const generation = ++this.generation;
    this.refreshing = true;
    try {
      const room = await this.api.get(id, this.token);
      if (this.disposed || generation !== this.generation) return;
      const latest = this.state.room;
      if (latest && (latest.game_id !== room.game_id || room.version < latest.version)) return;
      const changed = latest?.version !== room.version;
      this.publish({ room, error: '',
        ...(changed ? { selectedNode: null, legalTargets: [] } : {}) });
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.publish({ error: messageForApiError(error) });
    } finally {
      this.refreshing = false;
    }
  }

  async cancel(): Promise<void> {
    const room = this.state.room;
    if (!room || room.room_status !== 'WAITING' || room.seat !== 'A' || this.state.busy) return;
    this.publish({ busy: true, error: '' });
    try {
      const cancelled = await this.api.cancel(room.game_id, this.token);
      this.generation++;
      this.publish({ room: cancelled });
      this.storage.remove(ACTIVE_ONLINE_KEY);
      this.publish({ room: null, selectedNode: null, legalTargets: [] });
    } catch (error) { this.publish({ error: messageForApiError(error) }); }
    finally { this.publish({ busy: false }); }
  }

  leave(): void {
    if (this.state.busy) return;
    this.storage.remove(ACTIVE_ONLINE_KEY);
    this.token = '';
    this.pending = null;
    this.generation++;
    this.publish({ room: null, selectedNode: null, legalTargets: [],
      pendingMove: false, error: '' });
  }

  async tapNode(id: string): Promise<void> {
    const room = this.state.room;
    if (!room || !NODE_IDS.includes(id as NodeId) || this.state.busy || this.pending ||
        room.room_status !== 'PLAYING' || room.state.current_player !== room.seat) return;
    const node = id as NodeId;
    if (this.state.selectedNode && this.state.legalTargets.includes(node)) {
      this.pending = { from_node: this.state.selectedNode, to_node: node,
        expected_version: room.version, client_request_id: identifier() };
      await this.submitPending();
      return;
    }
    if (room.state.board.occupancy[node] !== room.seat) {
      this.publish({ selectedNode: null, legalTargets: [] });
      return;
    }
    this.publish({ busy: true, selectedNode: node, legalTargets: [], error: '' });
    try {
      const legal = await this.api.legal(room.game_id, this.token, node);
      if (this.state.room?.version === room.version && this.state.selectedNode === node)
        this.publish({ legalTargets: legal.moves.map(move => move.to) });
    } catch (error) {
      this.publish({ selectedNode: null, error: messageForApiError(error) });
      if (error instanceof ApiError && (error.code === 'GAME_STATE_CONFLICT' ||
          error.code === 'NOT_YOUR_TURN')) await this.refresh();
    } finally { this.publish({ busy: false }); }
  }

  async retryMove(): Promise<void> { if (this.pending) await this.submitPending(); }

  private async submitPending(): Promise<void> {
    const room = this.state.room;
    const request = this.pending;
    if (!room || !request || this.state.busy) return;
    this.publish({ busy: true, pendingMove: true, error: '' });
    let resync = false;
    try {
      const result = await this.api.move(room.game_id, this.token, request);
      this.pending = null;
      const latest = this.state.room;
      if (latest && latest.game_id === room.game_id && latest.version > result.version) {
        this.publish({ pendingMove: false, selectedNode: null, legalTargets: [] });
        return;
      }
      this.publish({ room: { ...room, version: result.version, state: result.turn.state,
        room_status: result.turn.state.game_status === 'FINISHED' ? 'FINISHED' : 'PLAYING' },
        selectedNode: null, legalTargets: [], lastMove: result.turn.move,
        lastCapture: result.turn.capture, pendingMove: false });
    } catch (error) {
      if (error instanceof ApiError && error.code !== 'NETWORK_ERROR' &&
          error.code !== 'SERVER_UNAVAILABLE' && error.code !== 'DATABASE_UNAVAILABLE') {
        this.pending = null;
        this.publish({ pendingMove: false });
      }
      this.publish({ error: messageForApiError(error) });
      resync = !this.pending;
    } finally { this.publish({ busy: false }); }
    if (resync) await this.refresh();
  }

  dispose(): void { this.disposed = true; this.generation++; }
}
