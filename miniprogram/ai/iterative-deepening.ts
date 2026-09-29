import { RuleEngine } from '../domain/index';
import type { GameState, Move, Player } from '../domain/index';
import { AlphaBetaAI } from './alpha-beta';
import type { AlphaBetaOptions, AlphaBetaSearchResult } from './alpha-beta';
import { DEFAULT_EVALUATION_CONFIG, evaluatePosition } from './evaluation';
import { RuleAmbiguityError, scoreTerminalPosition } from './minimax';
import type { MoveChooser } from './random-ai';
import { TranspositionTable } from './transposition-table';

export class SearchTimeoutError extends Error {
  constructor() {
    super('Search time budget exhausted');
    this.name = 'SearchTimeoutError';
  }
}

export interface IterativeDeepeningOptions extends Omit<AlphaBetaOptions, 'depth'> {
  readonly maxDepth: number;
  readonly timeLimitMs: number;
  readonly now?: () => number;
}

export interface IterativeDeepeningSearchResult extends Omit<AlphaBetaSearchResult,
  'algorithm' | 'searchDepth' | 'nodesSearched' | 'thinkingTimeMs' | 'ttProbes' |
  'ttHits' | 'ttCutoffs' | 'ttStores' | 'ttSize'> {
  readonly algorithm: 'ITERATIVE_DEEPENING_ALPHA_BETA';
  /** Last fully completed depth, or zero when only the fallback is available. */
  readonly searchDepth: number;
  /** All positions visited, including work in an interrupted iteration. */
  readonly nodesSearched: number;
  /** All completed alpha-beta cutoffs, including those before an interrupted iteration. */
  readonly cutoffs: number;
  /** TT counters cover the whole call, including completed nodes in an interrupted iteration. */
  readonly ttProbes: number;
  readonly ttHits: number;
  readonly ttCutoffs: number;
  readonly ttStores: number;
  readonly ttSize: number;
  readonly thinkingTimeMs: number;
  readonly timedOut: boolean;
}

/** Repeated full-window Alpha-Beta searches with one table per search call. */
export class IterativeDeepeningAI implements MoveChooser {
  private readonly options: IterativeDeepeningOptions;
  private readonly now: () => number;

  constructor(options: IterativeDeepeningOptions) {
    if (!Number.isSafeInteger(options.maxDepth) || options.maxDepth < 1) {
      throw new RangeError('Iterative Deepening maxDepth must be a positive safe integer');
    }
    if (!Number.isFinite(options.timeLimitMs)) {
      throw new RangeError('Iterative Deepening timeLimitMs must be finite');
    }
    this.options = options;
    this.now = options.now ?? (() => globalThis.performance?.now() ?? Date.now());
  }

  chooseMove(state: GameState): Move | null {
    return this.search(state).bestMove;
  }

  search(state: GameState, rootPlayer: Player = state.current_player): IterativeDeepeningSearchResult {
    const started = this.now();
    const deadline = started + this.options.timeLimitMs;
    const config = this.options.evaluationConfig ?? DEFAULT_EVALUATION_CONFIG;
    const table = this.options.useTranspositionTable === false ? null : new TranspositionTable();
    let nodesSearched = 0;
    let cutoffs = 0;
    let completed: AlphaBetaSearchResult | null = null;
    let timedOut = false;

    // This check precedes the budget check so a rules ambiguity never becomes a fallback.
    const legalMoves = state.game_status === 'FINISHED' ? [] : RuleEngine.getAllLegalMoves(state);
    if (state.game_status !== 'FINISHED' && legalMoves.length === 0) {
      throw new RuleAmbiguityError();
    }

    if (state.game_status !== 'FINISHED') {
      const checkTimeout = (): void => {
        if (this.now() >= deadline) throw new SearchTimeoutError();
      };
      for (let depth = 1; depth <= this.options.maxDepth; depth++) {
        try {
          checkTimeout();
          completed = new AlphaBetaAI({
            depth,
            evaluationConfig: config,
            useMoveOrdering: this.options.useMoveOrdering ?? true,
            useTranspositionTable: table !== null,
          }).search(state, rootPlayer, {
            ...(table ? { table } : {}),
            checkTimeout,
            onNodeVisited: () => { nodesSearched++; },
            onCutoff: () => { cutoffs++; },
          });
        } catch (error) {
          if (!(error instanceof SearchTimeoutError)) throw error;
          timedOut = true;
          break;
        }
      }
    }

    const fallbackScore = state.game_status === 'FINISHED'
      ? scoreTerminalPosition(state, rootPlayer, config, 0)
      : completed === null ? evaluatePosition(state, rootPlayer, config).score : 0;
    const elapsed = Math.max(0, this.now() - started);
    return {
      bestMove: completed?.bestMove ?? legalMoves[0] ?? null,
      evaluationScore: completed?.evaluationScore ?? fallbackScore,
      scorePerspective: rootPlayer,
      searchDepth: completed?.searchDepth ?? 0,
      nodesSearched,
      algorithm: 'ITERATIVE_DEEPENING_ALPHA_BETA',
      candidateMoves: completed?.candidateMoves ?? [],
      cutoffs,
      thinkingTimeMs: elapsed,
      ttProbes: table?.probes ?? 0,
      ttHits: table?.hits ?? 0,
      ttCutoffs: table?.cutoffs ?? 0,
      ttStores: table?.stores ?? 0,
      ttSize: table?.size ?? 0,
      timedOut,
    };
  }
}
