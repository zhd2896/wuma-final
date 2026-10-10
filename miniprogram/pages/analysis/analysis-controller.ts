import { analyzePosition } from '../../ai/position-analysis';
import type { PositionAnalysis } from '../../ai/position-analysis';
import type { GameState } from '../../domain/index';
import type { Player } from '../../domain/index';
import type { OnlineRoom } from '../../services/online-api';
import type { PositionAnalysisDto } from '../../services/api-contract';
import type { DeviceHistoryEntry } from '../../services/device-history';
import type { GameApi } from '../../services/game-api';
import { ApiError, messageForApiError } from '../../services/api-client';
import { mapPositionAnalysis } from './analysis-view-model';
import type { AnalysisViewModel } from './analysis-view-model';

export type AnalysisSource =
  | { readonly mode: 'local'; readonly gameId?: string }
  | { readonly mode: 'remote'; readonly gameId?: string }
  | { readonly mode: 'online'; readonly gameId?: string };

export interface IndependentAnalysisSnapshot {
  readonly state: 'idle' | 'loading' | 'success' | 'empty' | 'error' | 'conflict';
  readonly source: AnalysisSource;
  readonly gameId: string | null;
  readonly gameVersion: number | null;
  readonly seat: Player | null;
  readonly view: AnalysisViewModel | null;
  readonly errorMessage: string;
}

export interface IndependentAnalysisDependencies {
  readonly restoreOnline?: (id: string) => Promise<{ token: string;
    room: Pick<OnlineRoom, 'game_id' | 'seat' | 'version' | 'room_status' | 'state'> }>;
  readonly analyzeOnline?: (id: string, token: string, version: number) => Promise<PositionAnalysisDto>;
  readonly readIdentity?: () => unknown;
  readonly readOnlineToken?: (id: string) => string | null;
  readonly api: Pick<GameApi, 'getGame' | 'analyzeGame'>;
  readonly readLocalGame: (id: string) => DeviceHistoryEntry | null;
  readonly readActiveLocalId: () => string | null;
  readonly analyzeLocal?: (state: GameState) => PositionAnalysis;
  readonly onChange: (snapshot: IndependentAnalysisSnapshot) => void;
}

const initialSnapshot: IndependentAnalysisSnapshot = {
  state: 'idle', source: { mode: 'local' }, gameId: null, gameVersion: null,
  view: null, seat: null, errorMessage: '',
};

export class IndependentAnalysisController {
  private readonly dependencies: IndependentAnalysisDependencies;
  private readonly api: IndependentAnalysisDependencies['api'];
  private readonly readLocalGame: IndependentAnalysisDependencies['readLocalGame'];
  private readonly readActiveLocalId: IndependentAnalysisDependencies['readActiveLocalId'];
  private readonly analyzeLocal: (state: GameState) => PositionAnalysis;
  private readonly onChange: IndependentAnalysisDependencies['onChange'];
  private currentSnapshot = initialSnapshot;
  private generation = 0;
  private disposed = false;

  constructor(dependencies: IndependentAnalysisDependencies) {
    this.dependencies = dependencies;
    this.api = dependencies.api;
    this.readLocalGame = dependencies.readLocalGame;
    this.readActiveLocalId = dependencies.readActiveLocalId;
    this.analyzeLocal = dependencies.analyzeLocal ?? (state => analyzePosition(state));
    this.onChange = dependencies.onChange;
  }

  get snapshot(): IndependentAnalysisSnapshot { return this.currentSnapshot; }

  private current(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }

  private publish(patch: Partial<IndependentAnalysisSnapshot>): void {
    if (this.disposed) return;
    this.currentSnapshot = { ...this.currentSnapshot, ...patch };
    this.onChange(this.currentSnapshot);
  }

  async enter(source: AnalysisSource): Promise<void> {
    if (this.disposed || (this.currentSnapshot.state === 'loading' &&
        source.mode === this.currentSnapshot.source.mode && source.gameId === this.currentSnapshot.source.gameId)) return;
    const generation = ++this.generation;
    let gameId: string | null;
    try {
      gameId = source.gameId ||
        (source.mode === 'local' ? this.readActiveLocalId() : null);
    } catch {
      this.publish({ state: 'error', source, gameId: null, gameVersion: null,
        view: null, errorMessage: '本地棋局读取或分析失败，请重试' });
      return;
    }
    this.publish({ state: 'loading', source, gameId, gameVersion: null,
      view: null, seat: null, errorMessage: '' });
    if (!gameId) {
      if (this.current(generation)) this.publish({ state: 'empty' });
      return;
    }
    let requestCurrent = () => this.current(generation);
    try {
      if (source.mode === 'online') {
        const identity = this.dependencies.readIdentity?.();
        let token: string | undefined;
        const current = () => {
          if (!this.current(generation)) return false;
          if (this.dependencies.readIdentity?.() !== identity ||
              (token !== undefined && this.dependencies.readOnlineToken &&
               this.dependencies.readOnlineToken(gameId!) !== token)) {
            this.publish({ state: 'conflict', view: null, errorMessage: '账号或席位已变化，请重新分析' });
            return false;
          }
          return true;
        };
        requestCurrent = current;
        if (!this.dependencies.restoreOnline || !this.dependencies.analyzeOnline) throw new Error('Missing online API');
        const restored = await this.dependencies.restoreOnline(gameId);
        token = restored.token;
        if (!current()) return;
        const room = restored.room;
        if (room.game_id !== gameId) throw new ApiError('INVALID_GAME_RESPONSE', 502);
        if (room.room_status !== 'PLAYING' && room.room_status !== 'FINISHED')
          throw new ApiError('REMOTE_ROOM_UNAVAILABLE', 409);
        this.publish({ seat: room.seat, gameVersion: room.version });
        const result = await this.dependencies.analyzeOnline(gameId, token, room.version);
        if (!current()) return;
        if (result.game_id !== gameId || result.game_version !== room.version) {
          this.publish({ state: 'conflict', view: null, errorMessage: '棋局已变化，请重新分析' }); return;
        }
        this.publish({ state: 'success', gameVersion: room.version,
          view: mapPositionAnalysis(room.state, result), errorMessage: '' }); return;
      }
      if (source.mode === 'local') {
        const entry = this.readLocalGame(gameId);
        if (!entry || entry.mode !== 'local' || !entry.localState) {
          if (this.current(generation)) this.publish({ state: 'empty' });
          return;
        }
        await Promise.resolve();
        const analysis = this.analyzeLocal(entry.localState);
        if (!this.current(generation)) return;
        this.publish({ state: 'success', gameId, gameVersion: entry.turns,
          view: mapPositionAnalysis(entry.localState, analysis), errorMessage: '' });
        return;
      }

      const game = await this.api.getGame(gameId);
      if (!this.current(generation)) return;
      if (typeof game.version !== 'number') throw new Error('Missing game version');
      const result = await this.api.analyzeGame(gameId, game.version);
      if (!this.current(generation)) return;
      if (result.game_id !== gameId || result.game_version !== game.version) {
        this.publish({ state: 'conflict', gameVersion: game.version, view: null,
          errorMessage: '棋局已变化，请重新分析' });
        return;
      }
      this.publish({ state: 'success', gameId, gameVersion: game.version,
        view: mapPositionAnalysis(game.state, result,
          game.mode === 'AI' ? game.human_player ?? undefined : undefined), errorMessage: '' });
    } catch (error) {
      if (!requestCurrent()) return;
      if (error instanceof ApiError && error.code === 'GAME_STATE_CONFLICT') {
        this.publish({ state: 'conflict', view: null,
          errorMessage: '棋局已变化，请重新分析' });
      } else {
        this.publish({ state: 'error', view: null,
          errorMessage: source.mode === 'local'
            ? '本地棋局读取或分析失败，请重试' : messageForApiError(error) });
      }
    }
  }

  retry(): Promise<void> {
    return this.enter(this.currentSnapshot.source);
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
  }

  suspend(): void {
    this.generation++;
    this.publish({ state: 'idle', view: null, errorMessage: '' });
  }
}
