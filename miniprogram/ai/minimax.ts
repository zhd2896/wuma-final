import { RuleEngine } from '../domain/index';
import type { GameState, Move, Player } from '../domain/index';
import { DEFAULT_EVALUATION_CONFIG, evaluatePosition } from './evaluation';
import type { EvaluationConfig } from './evaluation';
import type { MoveChooser } from './random-ai';

export interface MinimaxOptions {
  readonly depth: number;
  readonly evaluationConfig?: EvaluationConfig;
}

export interface CandidateMoveScore {
  readonly move: Move;
  readonly score: number;
}

export interface SearchResult {
  readonly bestMove: Move | null;
  readonly evaluationScore: number;
  /** Every score in this result is from this player's perspective. */
  readonly scorePerspective: Player;
  readonly searchDepth: number;
  /** Number of visited positions, including the root. */
  readonly nodesSearched: number;
  readonly algorithm: 'MINIMAX';
  readonly candidateMoves: readonly CandidateMoveScore[];
}

/** The rules currently leave this nonterminal position without a defined outcome. */
export class RuleAmbiguityError extends Error {
  readonly code = 'RULE_AMBIGUITY' as const;

  constructor() {
    super('Nonterminal player has no legal moves; the rules do not define an outcome');
    this.name = 'RuleAmbiguityError';
  }
}

/** Shared terminal score for full Minimax and Alpha-Beta, including mate distance. */
export function scoreTerminalPosition(
  state: GameState,
  rootPlayer: Player,
  config: EvaluationConfig,
  ply: number,
): number {
  const score = evaluatePosition(state, rootPlayer, config).score;
  return state.winner === rootPlayer ? score - ply : score + ply;
}

/** Complete, unpruned Minimax over the RuleEngine's real legal turns. */
export class MinimaxAI implements MoveChooser {
  private readonly depth: number;
  private readonly evaluationConfig: EvaluationConfig;

  constructor(options: MinimaxOptions) {
    if (!Number.isSafeInteger(options.depth) || options.depth < 0) {
      throw new RangeError('Minimax depth must be a nonnegative safe integer');
    }
    this.depth = options.depth;
    this.evaluationConfig = options.evaluationConfig ?? DEFAULT_EVALUATION_CONFIG;
  }

  chooseMove(state: GameState): Move | null {
    return this.search(state).bestMove;
  }

  search(state: GameState, rootPlayer: Player = state.current_player): SearchResult {
    let nodesSearched = 0;
    let rootBestMove: Move | null = null;
    const candidateMoves: CandidateMoveScore[] = [];

    const visit = (position: GameState, remainingDepth: number, ply: number, isRoot: boolean): number => {
      nodesSearched++;

      if (position.game_status === 'FINISHED') {
        return scoreTerminalPosition(position, rootPlayer, this.evaluationConfig, ply);
      }
      if (remainingDepth === 0) {
        return evaluatePosition(position, rootPlayer, this.evaluationConfig).score;
      }

      const legalMoves = RuleEngine.getAllLegalMoves(position);
      if (legalMoves.length === 0) throw new RuleAmbiguityError();

      const maximizing = position.current_player === rootPlayer;
      let bestScore = maximizing ? -Infinity : Infinity;
      let hasBest = false;
      for (const move of legalMoves) {
        const child = RuleEngine.executeTurn(position, move).state;
        const score = visit(child, remainingDepth - 1, ply + 1, false);
        if (isRoot) candidateMoves.push({ move, score });
        if (!hasBest || (maximizing ? score > bestScore : score < bestScore)) {
          bestScore = score;
          hasBest = true;
          if (isRoot) rootBestMove = move;
        }
      }
      return bestScore;
    };

    const evaluationScore = visit(state, this.depth, 0, true);
    return {
      bestMove: rootBestMove,
      evaluationScore,
      scorePerspective: rootPlayer,
      searchDepth: this.depth,
      nodesSearched,
      algorithm: 'MINIMAX',
      candidateMoves,
    };
  }
}
