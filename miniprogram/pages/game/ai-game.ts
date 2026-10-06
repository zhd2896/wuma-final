import { isAiLevel, type AiLevel } from '../../services/api-contract';
import { NODE_IDS } from '../../domain/index';
import type { CaptureResult, GameState, Move, NodeId, Player } from '../../domain/index';
import { ApiError, messageForApiError } from '../../services/api-client';
import type { CoachHintDto, GameDto, PositionAnalysisDto, SearchResultDto } from '../../services/api-contract';
import { requirePlyCount } from '../../services/game-api';
import type { GameApi } from '../../services/game-api';
import type { GameIdStorage } from './remote-game';

export interface AiGameSnapshot {
  readonly gameId: string | null;
  readonly gameVersion: number | null;
  readonly plyCount: number;
  readonly gameState: GameState | null;
  readonly humanPlayer: Player | null;
  readonly aiPlayer: Player | null;
  readonly aiLevel: AiLevel | null;
  readonly selectedNode: NodeId | null;
  readonly legalTargets: readonly NodeId[];
  readonly lastMove: Move | null;
  readonly lastCapture: CaptureResult | null;
  readonly lastSearch: SearchResultDto | null;
  readonly analysis: PositionAnalysisDto | null;
  readonly isAnalyzing: boolean;
  readonly analysisErrorMessage: string | null;
  readonly coachHint: CoachHintDto | null;
  readonly isCoachLoading: boolean;
  readonly coachErrorMessage: string | null;
  readonly isLoadingGame: boolean;
  readonly isLoadingLegalMoves: boolean;
  readonly isSubmittingMove: boolean;
  readonly isAiThinking: boolean;
  readonly isOperating: boolean;
  readonly needsResync: boolean;
  readonly errorMessage: string | null;
  readonly notice: string | null;
}

const emptySnapshot: AiGameSnapshot = {
  gameId: null, gameVersion: null, plyCount: 0, gameState: null, humanPlayer: null, aiPlayer: null, aiLevel: null,
  selectedNode: null, legalTargets: [], lastMove: null, lastCapture: null, lastSearch: null,
  analysis: null, isAnalyzing: false, analysisErrorMessage: null,
  coachHint: null, isCoachLoading: false, coachErrorMessage: null,
  isLoadingGame: false, isLoadingLegalMoves: false, isSubmittingMove: false,
  isAiThinking: false, isOperating: false, needsResync: false, errorMessage: null, notice: null,
};

export class AiGameController {
  private state: AiGameSnapshot = emptySnapshot;
  private disposed = false;
  private generation = 0;
  private legalGeneration = 0;
  private readonly api: GameApi;
  private readonly storage: GameIdStorage;
  private readonly onChange: (snapshot: AiGameSnapshot) => void;
  private readonly preferredAiPlayer: Player;
  private readonly getAiLevel: () => AiLevel;
  private readonly createOnMissing: boolean;
  private pendingUndo: { readonly id: string; readonly expectedVersion: number } | null = null;
  private pendingResign: { readonly id: string; readonly expectedVersion: number } | null = null;

  constructor(api: GameApi, storage: GameIdStorage,
              onChange: (snapshot: AiGameSnapshot) => void,
              options: { aiPlayer?: Player; createOnMissing?: boolean; getAiLevel?: () => AiLevel } = {}) {
    this.api = api;
    this.storage = storage;
    this.onChange = onChange;
    this.preferredAiPlayer = options.aiPlayer ?? 'B';
    this.getAiLevel = options.getAiLevel ?? (() => 'STANDARD');
    this.createOnMissing = options.createOnMissing ?? true;
  }

  get snapshot(): AiGameSnapshot { return this.state; }

  private get hasPendingOperation(): boolean { return !!(this.pendingUndo || this.pendingResign); }

  private publish(patch: Partial<AiGameSnapshot>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  private current(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }

  private accept(game: GameDto): void {
    const plyCount = requirePlyCount(game);
    if (game.mode !== 'AI' || !game.ai_player || !game.human_player || !isAiLevel(game.ai_level)) {
      throw new ApiError('AI_MODE_REQUIRED', 409);
    }
    this.storage.write(game.game_id);
    this.legalGeneration++;
    this.publish({ gameId: game.game_id, gameVersion: game.version ?? null,
      plyCount,
      gameState: game.state,
      humanPlayer: game.human_player, aiPlayer: game.ai_player, aiLevel: game.ai_level,
      selectedNode: null, legalTargets: [], lastMove: null, lastCapture: null,
      lastSearch: null, analysis: null, analysisErrorMessage: null, isAnalyzing: false,
      coachHint: null, isCoachLoading: false, coachErrorMessage: null,
      isLoadingGame: false, isLoadingLegalMoves: false,
      needsResync: false, errorMessage: null, notice: null });
  }

  private async create(firstPlayer: Player): Promise<GameDto> {
    return this.api.createGame({ first_player: firstPlayer, mode: 'AI',
      ai_player: this.preferredAiPlayer, ai_level: this.getAiLevel() });
  }

  async enter(firstPlayer: Player = 'A'): Promise<void> {
    if (this.disposed || this.state.isOperating || this.state.isAnalyzing || this.state.isCoachLoading || this.state.isLoadingGame || this.state.isSubmittingMove ||
        this.state.isAiThinking) return;
    const generation = ++this.generation;
    const pendingError = this.hasPendingOperation ? this.state.errorMessage : null;
    this.legalGeneration++;
    this.publish({ isLoadingGame: true, needsResync: true, errorMessage: null,
      selectedNode: null, legalTargets: [], isLoadingLegalMoves: false });
    try {
      const saved = this.hasPendingOperation ? this.state.gameId : this.storage.read();
      let game: GameDto;
      if (saved) {
        try { game = await this.api.getGame(saved); }
        catch (error) {
          const canReplaceSavedGame = !this.hasPendingOperation && error instanceof ApiError &&
            (error.code === 'GAME_NOT_FOUND' ||
              (this.createOnMissing && error.code === 'AUTH_FORBIDDEN'));
          if (!canReplaceSavedGame) throw error;
          if (!this.current(generation)) return;
          this.storage.clear();
          if (!this.createOnMissing) throw error;
          game = await this.create(firstPlayer);
        }
      } else {
        if (!this.createOnMissing) throw new ApiError('GAME_NOT_FOUND', 404);
        game = await this.create(firstPlayer);
      }
      if (!this.current(generation)) return;
      this.accept(game);
      if (this.hasPendingOperation) this.publish({ errorMessage: pendingError });
      await this.maybePlayAi(generation);
    } catch (error) {
      if (this.current(generation)) this.publish({ isLoadingGame: false,
        errorMessage: messageForApiError(error) });
    }
  }

  async restart(firstPlayer: Player = 'A'): Promise<void> {
    if (this.disposed || this.hasPendingOperation || this.state.isOperating || this.state.isAnalyzing || this.state.isCoachLoading || this.state.isLoadingGame || this.state.isSubmittingMove ||
        this.state.isAiThinking) return;
    const generation = ++this.generation;
    this.legalGeneration++;
    this.publish({ isLoadingGame: true, errorMessage: null, selectedNode: null,
      legalTargets: [], isLoadingLegalMoves: false });
    try {
      const game = await this.create(firstPlayer);
      if (!this.current(generation)) return;
      this.accept(game);
      await this.maybePlayAi(generation);
    } catch (error) {
      if (this.current(generation)) this.publish({ isLoadingGame: false,
        errorMessage: messageForApiError(error) });
    }
  }

  private canHumanInteract(): boolean {
    return !this.disposed && !this.hasPendingOperation && !this.state.isOperating && !this.state.isAnalyzing && !this.state.isCoachLoading && !this.state.isLoadingGame && !this.state.isSubmittingMove &&
      !this.state.isAiThinking && !this.state.needsResync && !!this.state.gameId &&
      this.state.gameState?.game_status === 'PLAYING' &&
      this.state.gameState.current_player === this.state.humanPlayer;
  }

  async tapNode(id: string): Promise<void> {
    if (!this.canHumanInteract() || !NODE_IDS.includes(id as NodeId)) return;
    const node = id as NodeId;
    if (this.state.gameState!.board.occupancy[node] === this.state.humanPlayer) {
      await this.selectNode(node);
    } else if (this.state.selectedNode && this.state.legalTargets.includes(node)) {
      await this.submitHumanMove(this.state.selectedNode, node);
    }
  }

  private async selectNode(node: NodeId): Promise<void> {
    const legalGeneration = ++this.legalGeneration;
    const gameId = this.state.gameId!;
    this.publish({ selectedNode: node, legalTargets: [], isLoadingLegalMoves: true,
      errorMessage: null });
    try {
      const result = await this.api.getLegalMoves(gameId, node);
      if (this.disposed || legalGeneration !== this.legalGeneration ||
          this.state.gameId !== gameId || !this.canHumanInteract()) return;
      this.publish({ legalTargets: result.moves.filter(move => move.from === node).map(move => move.to),
        isLoadingLegalMoves: false });
    } catch (error) {
      if (this.disposed || legalGeneration !== this.legalGeneration) return;
      this.publish({ selectedNode: null, legalTargets: [], isLoadingLegalMoves: false,
        errorMessage: messageForApiError(error) });
    }
  }

  private async submitHumanMove(from: NodeId, to: NodeId): Promise<void> {
    const gameId = this.state.gameId!;
    const generation = this.generation;
    this.legalGeneration++;
    this.publish({ isSubmittingMove: true, isLoadingLegalMoves: false,
      errorMessage: null, selectedNode: null, legalTargets: [] });
    try {
      const { turn } = await this.api.move(gameId, { from_node: from, to_node: to });
      if (!this.current(generation) || this.state.gameId !== gameId) return;
      this.publish({ gameState: turn.state,
        gameVersion: this.state.gameVersion === null ? null : this.state.gameVersion + 1,
        plyCount: this.state.plyCount + 1,
        lastMove: turn.move, lastCapture: turn.capture,
        analysis: null, analysisErrorMessage: null,
        coachHint: null, coachErrorMessage: null,
        isSubmittingMove: false,
        notice: turn.capture.failure_reason === 'INSUFFICIENT_RESERVE'
          ? '备用棋不足，本次吃子未生效' : null });
      await this.maybePlayAi(generation);
    } catch (error) {
      if (!this.current(generation)) return;
      this.publish({ needsResync: true, errorMessage: messageForApiError(error) });
      await this.syncAfterUnknown(gameId, generation, true, error);
    } finally {
      if (this.current(generation)) this.publish({ isSubmittingMove: false });
    }
  }

  private async maybePlayAi(generation: number): Promise<void> {
    if (!this.current(generation) || this.hasPendingOperation || this.state.isAnalyzing || this.state.isCoachLoading || this.state.isAiThinking || this.state.needsResync ||
        this.state.gameState?.game_status !== 'PLAYING' ||
        this.state.gameState.current_player !== this.state.aiPlayer || !this.state.gameId) return;
    const gameId = this.state.gameId;
    this.publish({ isAiThinking: true, errorMessage: null, selectedNode: null,
      legalTargets: [], isLoadingLegalMoves: false });
    try {
      const { search, turn } = await this.api.aiMove(gameId, {});
      if (!this.current(generation) || this.state.gameId !== gameId) return;
      this.publish({ gameState: turn.state,
        gameVersion: this.state.gameVersion === null ? null : this.state.gameVersion + 1,
        plyCount: this.state.plyCount + 1,
        lastMove: turn.move, lastCapture: turn.capture,
        analysis: null, analysisErrorMessage: null,
        coachHint: null, coachErrorMessage: null,
        lastSearch: search, errorMessage: null,
        notice: turn.capture.failure_reason === 'INSUFFICIENT_RESERVE'
          ? '备用棋不足，本次吃子未生效' : null });
    } catch (error) {
      if (!this.current(generation)) return;
      this.publish({ needsResync: true, errorMessage: messageForApiError(error) });
      await this.syncAfterUnknown(gameId, generation, false, error);
    } finally {
      if (this.current(generation)) this.publish({ isAiThinking: false });
    }
  }

  private async syncAfterUnknown(gameId: string, generation: number,
                                 resumeAi: boolean, originalError: unknown): Promise<void> {
    try {
      const game = await this.api.getGame(gameId);
      if (!this.current(generation) || this.state.gameId !== gameId) return;
      this.accept(game);
      if (game.state.current_player === game.ai_player && game.state.game_status === 'PLAYING') {
        this.publish({ errorMessage: messageForApiError(originalError) });
        if (resumeAi) await this.maybePlayAi(generation);
      }
    } catch (error) {
      if (!this.current(generation)) return;
      if (error instanceof ApiError && error.code === 'GAME_NOT_FOUND') {
        this.storage.clear();
        this.publish({ gameId: null, gameState: null, needsResync: false,
          errorMessage: messageForApiError(error) });
      } else this.publish({ needsResync: true, errorMessage: messageForApiError(error) });
    }
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.legalGeneration++;
  }

  private requestId(kind: 'undo' | 'resign'): string {
    return `game-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  private async operate(kind: 'undo' | 'resign'): Promise<boolean> {
    const field = kind === 'undo' ? 'pendingUndo' : 'pendingResign';
    const retrying = this[field] !== null;
    if (this.disposed || this.state.isOperating || this.state.isLoadingGame ||
        this.state.isSubmittingMove || this.state.isAiThinking || this.state.isAnalyzing ||
        this.state.isCoachLoading || !this.state.gameId ||
        (!retrying && (this.hasPendingOperation || this.state.needsResync ||
          this.state.gameVersion === null || this.state.gameState?.game_status !== 'PLAYING'))) return false;
    const gameId = this.state.gameId;
    const generation = this.generation;
    const pending = this[field] ?? {
      id: this.requestId(kind), expectedVersion: this.state.gameVersion!,
    };
    this[field] = pending;
    this.legalGeneration++;
    this.publish({ isOperating: true, selectedNode: null, legalTargets: [],
      isLoadingLegalMoves: false, errorMessage: null, notice: null });
    try {
      const result = await this.api[kind](gameId, {
        expected_version: pending.expectedVersion, client_request_id: pending.id,
      });
      if (!this.current(generation) || this.state.gameId !== gameId) return false;
      const plyCount = requirePlyCount(result);
      this[field] = null;
      this.publish({ gameVersion: result.version, plyCount,
        gameState: result.state, selectedNode: null, legalTargets: [],
        lastMove: null, lastCapture: null, lastSearch: null,
        analysis: null, analysisErrorMessage: null, isAnalyzing: false,
        coachHint: null, coachErrorMessage: null, isCoachLoading: false,
        needsResync: false, errorMessage: null,
        notice: kind === 'undo' ? `已悔棋 ${result.reverted_turns} 手` : '已认输' });
      return true;
    } catch (error) {
      if (!this.current(generation)) return false;
      const uncertain = !(error instanceof ApiError) || error.code === 'NETWORK_ERROR' ||
        error.code === 'SERVER_UNAVAILABLE' || error.code === 'DATABASE_UNAVAILABLE' ||
        error.code === 'INVALID_GAME_RESPONSE';
      const conflict = error instanceof ApiError &&
        ['GAME_STATE_CONFLICT', 'OPERATION_REQUEST_CONFLICT', 'GAME_ALREADY_FINISHED'].includes(error.code);
      if (!uncertain) this[field] = null;
      this.publish({ needsResync: uncertain || conflict, errorMessage: messageForApiError(error) });
      if (uncertain || conflict) {
        try {
          const game = await this.api.getGame(gameId);
          if (this.current(generation) && this.state.gameId === gameId) {
            this.accept(game);
            this.publish({ errorMessage: messageForApiError(error) });
          }
        } catch (reloadError) {
          if (this.current(generation)) this.publish({ needsResync: true,
            errorMessage: messageForApiError(reloadError) });
        }
      }
      return false;
    } finally {
      if (this.current(generation)) this.publish({ isOperating: false });
    }
  }

  undo(): Promise<boolean> { return this.operate('undo'); }
  resign(): Promise<boolean> { return this.operate('resign'); }

  async retry(firstPlayer: Player = 'A'): Promise<void> {
    if (this.pendingUndo) await this.undo();
    else if (this.pendingResign) await this.resign();
    else await this.enter(firstPlayer);
  }

  async analyze(): Promise<void> {
    if (this.disposed || this.hasPendingOperation || !this.state.gameId || !this.state.gameState ||
        this.state.isOperating || this.state.isLoadingGame || this.state.isSubmittingMove ||
        this.state.isAiThinking || this.state.isAnalyzing || this.state.isCoachLoading || this.state.needsResync) return;
    const gameId = this.state.gameId;
    const generation = this.generation;
    const stateKey = JSON.stringify(this.state.gameState);
    this.publish({ isAnalyzing: true, analysis: null, analysisErrorMessage: null });
    try {
      const analysis = await this.api.analyzeGame(gameId, this.state.gameVersion ?? undefined);
      if (!this.current(generation) || this.state.gameId !== gameId ||
          JSON.stringify(this.state.gameState) !== stateKey ||
          analysis.game_id !== gameId ||
          (this.state.gameVersion !== null && analysis.game_version !== this.state.gameVersion) ||
          analysis.analyzedPlayer !== this.state.gameState?.current_player) return;
      this.publish({ analysis });
    } catch (error) {
      if (!this.current(generation)) return;
      this.publish({ analysisErrorMessage: messageForApiError(error), analysis: null });
      if (error instanceof ApiError && error.code === 'GAME_STATE_CONFLICT') {
        this.publish({ isAnalyzing: false });
        await this.enter();
        if (!this.disposed) this.publish({ analysisErrorMessage: '棋局状态已更新，请重新分析' });
      }
    } finally {
      if (this.current(generation)) this.publish({ isAnalyzing: false });
    }
  }

  async requestCoachHint(): Promise<void> {
    if (!this.canHumanInteract() || this.state.isLoadingLegalMoves ||
        this.state.gameVersion === null) return;
    const level = (this.state.coachHint?.level ?? 0) + 1 as 1 | 2 | 3;
    if (level > 3) return;
    const gameId = this.state.gameId!;
    const version = this.state.gameVersion;
    const player = this.state.gameState!.current_player;
    const generation = this.generation;
    this.legalGeneration++;
    this.publish({ isCoachLoading: true, coachErrorMessage: null,
      analysis: null, selectedNode: null, legalTargets: [], isLoadingLegalMoves: false });
    try {
      const hint = await this.api.getCoachHint(gameId, level, version);
      if (!this.current(generation) || this.state.gameId !== gameId ||
          this.state.gameVersion !== version || this.state.gameState?.current_player !== player ||
          hint.gameId !== gameId || hint.gameVersion !== version ||
          hint.analyzedPlayer !== player || hint.level !== level) return;
      this.publish({ coachHint: hint });
    } catch (error) {
      if (!this.current(generation)) return;
      this.publish({ coachErrorMessage: '提示暂时不可用' });
      if (error instanceof ApiError && error.code === 'GAME_STATE_CONFLICT') {
        this.publish({ isCoachLoading: false });
        await this.enter();
        if (!this.disposed) this.publish({ coachErrorMessage: '棋局已更新，请重新请求提示' });
      }
    } finally {
      if (this.current(generation)) this.publish({ isCoachLoading: false });
    }
  }
}
