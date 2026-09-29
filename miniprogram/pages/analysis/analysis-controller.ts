import { analyzePosition } from '../../ai/position-analysis';
import type { PositionAnalysis } from '../../ai/position-analysis';
import type { GameState } from '../../domain/index';
import type { DeviceHistoryEntry } from '../../services/device-history';
import type { GameApi } from '../../services/game-api';
import { ApiError, messageForApiError } from '../../services/api-client';
import { mapPositionAnalysis } from './analysis-view-model';
import type { AnalysisViewModel } from './analysis-view-model';

export type AnalysisSource =
  | { readonly mode: 'local'; readonly gameId?: string }
  | { readonly mode: 'remote'; readonly gameId?: string };

export interface IndependentAnalysisSnapshot {
  readonly state: 'idle' | 'loading' | 'success' | 'empty' | 'error' | 'conflict';
  readonly source: AnalysisSource;
  readonly gameId: string | null;
  readonly gameVersion: number | null;
  readonly view: AnalysisViewModel | null;
  readonly errorMessage: string;
}

export interface IndependentAnalysisDependencies {
  readonly api: Pick<GameApi, 'getGame' | 'analyzeGame'>;
  readonly readLocalGame: (id: string) => DeviceHistoryEntry | null;
  readonly readActiveLocalId: () => string | null;
  readonly analyzeLocal?: (state: GameState) => PositionAnalysis;
  readonly onChange: (snapshot: IndependentAnalysisSnapshot) => void;
}

const initialSnapshot: IndependentAnalysisSnapshot = {
  state: 'idle', source: { mode: 'local' }, gameId: null, gameVersion: null,
  view: null, errorMessage: '',
};

export class IndependentAnalysisController {
  private readonly api: IndependentAnalysisDependencies['api'];
  private readonly readLocalGame: IndependentAnalysisDependencies['readLocalGame'];
  private readonly readActiveLocalId: IndependentAnalysisDependencies['readActiveLocalId'];
  private readonly analyzeLocal: (state: GameState) => PositionAnalysis;
  private readonly onChange: IndependentAnalysisDependencies['onChange'];
  private currentSnapshot = initialSnapshot;
  private generation = 0;
  private disposed = false;

  constructor(dependencies: IndependentAnalysisDependencies) {
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
    if (this.disposed || this.currentSnapshot.state === 'loading') return;
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
      view: null, errorMessage: '' });
    if (!gameId) {
      if (this.current(generation)) this.publish({ state: 'empty' });
      return;
    }
    try {
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
        view: mapPositionAnalysis(game.state, result), errorMessage: '' });
    } catch (error) {
      if (!this.current(generation)) return;
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
}
