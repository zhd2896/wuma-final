import { RuleEngine } from '../domain/index';
import type { GameState, Move, Player } from '../domain/index';
import { DEFAULT_EVALUATION_CONFIG, evaluatePosition } from './evaluation';
import type { EvaluationConfig } from './evaluation';
import { RuleAmbiguityError, scoreTerminalPosition } from './minimax';
import type { MinimaxOptions, SearchResult } from './minimax';
import { orderMoves } from './move-ordering';
import type { MoveChooser } from './random-ai';
import { classifyTTFlag, normalizeScoreForTT, TranspositionTable } from './transposition-table';
import { formatZobristWords, hashGameState, parseZobristHash,
  stateSignature, updateZobristWords } from './zobrist';
import type { ZobristWords } from './zobrist';

interface SearchValue {
  readonly score: number;
  /** Tracks terminal ancestry without guessing from the score's magnitude. */
  readonly isMate: boolean;
}

export interface AlphaBetaOptions extends MinimaxOptions {
  readonly useMoveOrdering?: boolean;
  readonly useTranspositionTable?: boolean;
}

export interface AlphaBetaSearchResult extends Omit<SearchResult, 'algorithm'> {
  readonly algorithm: 'ALPHA_BETA';
  /** Number of times a bound stopped the scan before the final sibling. */
  readonly cutoffs: number;
  readonly thinkingTimeMs: number;
  readonly ttProbes: number;
  readonly ttHits: number;
  readonly ttCutoffs: number;
  readonly ttStores: number;
  readonly ttSize: number;
}

/** Optional controls for a single search. The caller owns an injected table. */
export interface AlphaBetaSearchControl {
  readonly table?: TranspositionTable;
  readonly checkTimeout?: () => void;
  readonly onNodeVisited?: () => void;
  readonly onCutoff?: () => void;
  readonly onFullHashComputed?: () => void;
}

/** Alpha-Beta with exact, independently searched root candidate scores. */
export class AlphaBetaAI implements MoveChooser {
  private readonly depth: number;
  private readonly evaluationConfig: EvaluationConfig;
  private readonly useMoveOrdering: boolean;
  private readonly useTranspositionTable: boolean;

  constructor(options: AlphaBetaOptions) {
    if (!Number.isSafeInteger(options.depth) || options.depth < 0) {
      throw new RangeError('Alpha-Beta depth must be a nonnegative safe integer');
    }
    this.depth = options.depth;
    this.evaluationConfig = options.evaluationConfig ?? DEFAULT_EVALUATION_CONFIG;
    this.useMoveOrdering = options.useMoveOrdering ?? false;
    this.useTranspositionTable = options.useTranspositionTable ?? false;
  }

  chooseMove(state: GameState): Move | null {
    return this.search(state).bestMove;
  }

  search(
    state: GameState,
    rootPlayer: Player = state.current_player,
    control: AlphaBetaSearchControl = {},
  ): AlphaBetaSearchResult {
    const started = Date.now();
    let nodesSearched = 0;
    let cutoffs = 0;
    const candidateMoves: { move: Move; score: number }[] = [];
    // A search-local table keeps root perspective and evaluation config fixed.
    const table = this.useTranspositionTable ? control.table ?? new TranspositionTable() : null;
    const rootHashWords = table ? parseZobristHash(hashGameState(state)) : null;
    if (table) control.onFullHashComputed?.();

    const visitNode = (): void => {
      nodesSearched++;
      control.onNodeVisited?.();
      control.checkTimeout?.();
    };

    const visit = (
      position: GameState,
      remainingDepth: number,
      ply: number,
      alpha: number,
      beta: number,
      hashWords: ZobristWords | null,
    ): SearchValue => {
      visitNode();
      const alphaOriginal = alpha;
      const betaOriginal = beta;
      const hash = table && hashWords ? formatZobristWords(hashWords) : null;
      const signature = table ? stateSignature(position) : null;
      if (table && hash !== null && signature !== null) {
        const cached = table.probe(hash, signature, remainingDepth, alpha, beta, ply);
        if (cached.exact || cached.cutoff) {
          control.checkTimeout?.();
          return { score: cached.score!, isMate: cached.isMate };
        }
        alpha = cached.alpha;
        beta = cached.beta;
      }
      const save = (value: SearchValue, bestMove: Move | null): SearchValue => {
        control.checkTimeout?.();
        if (table && hash !== null && signature !== null) {
          table.store({
            hash,
            stateSignature: signature,
            depth: remainingDepth,
            score: normalizeScoreForTT(value.score, ply, value.isMate),
            isMate: value.isMate,
            flag: classifyTTFlag(value.score, alphaOriginal, betaOriginal),
            bestMove,
          });
        }
        return value;
      };
      if (position.game_status === 'FINISHED') {
        return save({
          score: scoreTerminalPosition(position, rootPlayer, this.evaluationConfig, ply),
          isMate: true,
        }, null);
      }
      if (remainingDepth === 0) {
        return save({
          score: evaluatePosition(position, rootPlayer, this.evaluationConfig).score,
          isMate: false,
        }, null);
      }

      control.checkTimeout?.();
      const legalMoves = RuleEngine.getAllLegalMoves(position);
      if (legalMoves.length === 0) throw new RuleAmbiguityError();
      control.checkTimeout?.();
      const ordered = this.useMoveOrdering
        ? orderMoves(position, legalMoves) : null;
      const maximizing = position.current_player === rootPlayer;
      let best: SearchValue | null = null;
      let bestMove: Move | null = null;
      for (let index = 0; index < legalMoves.length; index++) {
        control.checkTimeout?.();
        const move = ordered ? ordered[index].move : legalMoves[index];
        const turn = ordered
          ? ordered[index].turn
          : RuleEngine.executeTurn(position, move);
        const childHashWords = table && hashWords
          ? updateZobristWords(hashWords, turn) : null;
        const value = visit(turn.state, remainingDepth - 1, ply + 1,
          alpha, beta, childHashWords);
        if (best === null || (maximizing ? value.score > best.score : value.score < best.score)) {
          best = value;
          bestMove = move;
        }
        if (maximizing) {
          alpha = Math.max(alpha, best!.score);
        } else {
          beta = Math.min(beta, best!.score);
        }
        if (alpha >= beta && index + 1 < legalMoves.length) {
          cutoffs++;
          control.onCutoff?.();
          break;
        }
      }
      return save(best!, bestMove);
    };

    // Count the root exactly once, matching Minimax's visited-position definition.
    visitNode();
    let bestMove: Move | null = null;
    let evaluationScore: number;
    if (state.game_status === 'FINISHED') {
      evaluationScore = scoreTerminalPosition(state, rootPlayer, this.evaluationConfig, 0);
    } else if (this.depth === 0) {
      evaluationScore = evaluatePosition(state, rootPlayer, this.evaluationConfig).score;
    } else {
      control.checkTimeout?.();
      const legalMoves = RuleEngine.getAllLegalMoves(state);
      if (legalMoves.length === 0) throw new RuleAmbiguityError();
      control.checkTimeout?.();
      const ordered = this.useMoveOrdering ? orderMoves(state, legalMoves) : null;
      const maximizing = state.current_player === rootPlayer;
      evaluationScore = maximizing ? -Infinity : Infinity;
      for (let index = 0; index < legalMoves.length; index++) {
        control.checkTimeout?.();
        const move = ordered ? ordered[index].move : legalMoves[index];
        const turn = ordered
          ? ordered[index].turn
          : RuleEngine.executeTurn(state, move);
        const childHashWords = table && rootHashWords
          ? updateZobristWords(rootHashWords, turn) : null;
        // An independent full window makes each public candidate score exact.
        const score = visit(turn.state, this.depth - 1, 1,
          -Infinity, Infinity, childHashWords).score;
        candidateMoves.push({ move, score });
        if (bestMove === null || (maximizing ? score > evaluationScore : score < evaluationScore)) {
          evaluationScore = score;
          bestMove = move;
        }
      }
    }

    control.checkTimeout?.();
    return {
      bestMove,
      evaluationScore,
      scorePerspective: rootPlayer,
      searchDepth: this.depth,
      nodesSearched,
      algorithm: 'ALPHA_BETA',
      candidateMoves,
      cutoffs,
      thinkingTimeMs: Math.max(0, Date.now() - started),
      ttProbes: table?.probes ?? 0,
      ttHits: table?.hits ?? 0,
      ttCutoffs: table?.cutoffs ?? 0,
      ttStores: table?.stores ?? 0,
      ttSize: table?.size ?? 0,
    };
  }
}
