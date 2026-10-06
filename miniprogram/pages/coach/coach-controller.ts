import { isAiLevel, type AiLevel } from '../../services/api-contract';
import type { GameState, Player } from '../../domain/index';
import { ApiError, messageForApiError } from '../../services/api-client';
import type { CoachHintDto, GameDto } from '../../services/api-contract';
import type { GameApi } from '../../services/game-api';

export interface IndependentCoachSource { readonly gameId?: string }

export interface IndependentCoachSnapshot {
  readonly state: 'idle' | 'loading' | 'ready' | 'empty' | 'unavailable' | 'error' | 'conflict';
  readonly gameId: string | null;
  readonly gameVersion: number | null;
  readonly gameState: GameState | null;
  readonly humanPlayer: Player | null;
  readonly aiPlayer: Player | null;
  readonly hints: readonly CoachHintDto[];
  readonly loadingLevel: 1 | 2 | 3 | null;
  readonly errorMessage: string;
  readonly notice: string;
}

export interface IndependentCoachDependencies {
  readonly api: Pick<GameApi, 'getGame' | 'getCoachHint'>;
  readonly readActiveAiId: () => string | null;
  readonly writeActiveAiId: (id: string) => void;
  readonly onChange: (snapshot: IndependentCoachSnapshot) => void;
}

const initialSnapshot: IndependentCoachSnapshot = {
  state: 'idle', gameId: null, gameVersion: null, gameState: null,
  humanPlayer: null, aiPlayer: null, hints: [], loadingLevel: null,
  errorMessage: '', notice: '',
};

function validAiGame(game: GameDto): game is GameDto & {
  readonly version: number;
  readonly human_player: Player;
  readonly ai_player: Player;
  readonly ai_level: AiLevel;
} {
  return game.mode === 'AI' && typeof game.version === 'number' &&
    Number.isInteger(game.version) && game.version >= 0 &&
    (game.human_player === 'A' || game.human_player === 'B') &&
    (game.ai_player === 'A' || game.ai_player === 'B') &&
    game.human_player !== game.ai_player && isAiLevel(game.ai_level);
}

function unavailableNotice(game: GameDto): string {
  if (game.state.game_status === 'FINISHED') {
    return game.state.winner ? `本局已结束，胜方 ${game.state.winner} 方` : '本局已结束';
  }
  return '当前轮到 AI，请先返回 AI 对弈等待本回合完成';
}

export class IndependentCoachController {
  private readonly api: IndependentCoachDependencies['api'];
  private readonly readActiveAiId: IndependentCoachDependencies['readActiveAiId'];
  private readonly writeActiveAiId: IndependentCoachDependencies['writeActiveAiId'];
  private readonly onChange: IndependentCoachDependencies['onChange'];
  private currentSnapshot = initialSnapshot;
  private source: IndependentCoachSource = {};
  private generation = 0;
  private disposed = false;

  constructor(dependencies: IndependentCoachDependencies) {
    this.api = dependencies.api;
    this.readActiveAiId = dependencies.readActiveAiId;
    this.writeActiveAiId = dependencies.writeActiveAiId;
    this.onChange = dependencies.onChange;
  }

  get snapshot(): IndependentCoachSnapshot { return this.currentSnapshot; }

  private current(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }

  private publish(patch: Partial<IndependentCoachSnapshot>): void {
    if (this.disposed) return;
    this.currentSnapshot = { ...this.currentSnapshot, ...patch };
    this.onChange(this.currentSnapshot);
  }

  enter(source: IndependentCoachSource = this.source): Promise<void> {
    return this.load(source, false);
  }

  refresh(): Promise<void> {
    return this.load(this.source, true);
  }

  private async load(source: IndependentCoachSource, force: boolean): Promise<void> {
    if (this.disposed || (!force && (this.currentSnapshot.state === 'loading' ||
        this.currentSnapshot.loadingLevel !== null))) return;
    this.source = source;
    const generation = ++this.generation;
    let gameId: string | null;
    try {
      gameId = source.gameId || this.readActiveAiId();
    } catch {
      this.publish({ state: 'error', gameId: null, gameVersion: null, gameState: null,
        humanPlayer: null, aiPlayer: null, hints: [], loadingLevel: null,
        errorMessage: '当前 AI 棋局读取失败，请重试', notice: '' });
      return;
    }
    this.publish({ state: 'loading', gameId, gameVersion: null, gameState: null,
      humanPlayer: null, aiPlayer: null, hints: [], loadingLevel: null,
      errorMessage: '', notice: '' });
    if (!gameId) {
      if (this.current(generation)) this.publish({ state: 'empty' });
      return;
    }
    try {
      const game = await this.api.getGame(gameId);
      if (!this.current(generation)) return;
      if (game.game_id !== gameId) {
        this.publish({ state: 'error', errorMessage: '棋局响应与当前请求不一致' });
        return;
      }
      if (game.mode !== 'AI') {
        this.publish({ state: 'error', errorMessage: '该棋局不支持 AI 教练' });
        return;
      }
      if (!validAiGame(game)) throw new Error('Incomplete AI game metadata');
      try { this.writeActiveAiId(game.game_id); } catch { /* the loaded game remains usable */ }
      const playable = game.state.game_status === 'PLAYING' &&
        game.state.current_player === game.human_player;
      this.publish({
        state: playable ? 'ready' : 'unavailable',
        gameId: game.game_id,
        gameVersion: game.version,
        gameState: game.state,
        humanPlayer: game.human_player,
        aiPlayer: game.ai_player,
        hints: [], loadingLevel: null, errorMessage: '',
        notice: playable ? '' : unavailableNotice(game),
      });
    } catch (error) {
      if (!this.current(generation)) return;
      this.publish({ state: 'error', gameState: null, humanPlayer: null, aiPlayer: null,
        hints: [], loadingLevel: null, errorMessage: messageForApiError(error), notice: '' });
    }
  }

  async requestLevel(level: 1 | 2 | 3): Promise<void> {
    const snapshot = this.currentSnapshot;
    if (this.disposed || snapshot.state !== 'ready' || snapshot.loadingLevel !== null ||
        !snapshot.gameId || snapshot.gameVersion === null || !snapshot.gameState ||
        !snapshot.humanPlayer) return;
    const nextLevel = snapshot.hints.length + 1;
    if (level !== nextLevel || level > 3) return;
    const generation = this.generation;
    const gameId = snapshot.gameId;
    const version = snapshot.gameVersion;
    const player = snapshot.gameState.current_player;
    this.publish({ loadingLevel: level, errorMessage: '' });
    try {
      const result = await this.api.getCoachHint(gameId, level, version);
      if (!this.current(generation)) return;
      if (this.currentSnapshot.gameId !== gameId ||
          this.currentSnapshot.gameVersion !== version ||
          this.currentSnapshot.gameState?.current_player !== player ||
          result.gameId !== gameId || result.gameVersion !== version ||
          result.analyzedPlayer !== player || result.level !== level) {
        this.publish({ loadingLevel: null,
          errorMessage: '提示响应与当前棋局不一致，请重新请求' });
        return;
      }
      this.publish({ hints: [...this.currentSnapshot.hints, result],
        loadingLevel: null, errorMessage: '' });
    } catch (error) {
      if (!this.current(generation)) return;
      if (error instanceof ApiError && error.code === 'GAME_STATE_CONFLICT') {
        this.publish({ loadingLevel: null, hints: [] });
        await this.load(this.source, true);
        if (!this.disposed && (this.currentSnapshot.state === 'ready' ||
            this.currentSnapshot.state === 'unavailable')) {
          this.publish({ state: 'conflict', hints: [], loadingLevel: null,
            errorMessage: '', notice: '棋局已更新，请从一级提示重新开始' });
        }
        return;
      }
      this.publish({ loadingLevel: null, errorMessage: messageForApiError(error) });
    }
  }

  retry(): Promise<void> { return this.enter(this.source); }

  dispose(): void {
    this.disposed = true;
    this.generation++;
  }
}
