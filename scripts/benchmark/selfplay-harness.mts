import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { RuleEngine, createInitialGameState } from '../../miniprogram/domain/index.ts';
import type { GameState, Move, Player, WinnerReason } from '../../miniprogram/domain/index.ts';
import { AlphaBetaAI } from '../../miniprogram/ai/alpha-beta.ts';
import { DEFAULT_EVALUATION_CONFIG } from '../../miniprogram/ai/evaluation.ts';
import type { EvaluationConfig } from '../../miniprogram/ai/evaluation.ts';
import { IterativeDeepeningAI } from '../../miniprogram/ai/iterative-deepening.ts';
import { MinimaxAI, RuleAmbiguityError } from '../../miniprogram/ai/minimax.ts';
import { RandomAI } from '../../miniprogram/ai/random-ai.ts';
import { createSeededRng } from './seeded-rng.mts';
import type { FixedAlgorithm } from './search-harness.mts';

export type SelfPlayAlgorithm = 'RANDOM' | FixedAlgorithm | 'ITERATIVE_DEEPENING';
export type TerminationReason = 'COMPLETED' | 'MAX_PLIES_REACHED' |
  'RULE_AMBIGUITY' | 'ENGINE_ERROR';

export interface SelfPlayOptions {
  readonly matchup: readonly [SelfPlayAlgorithm, SelfPlayAlgorithm];
  readonly games: number;
  readonly seed: number;
  readonly maxPlies: number;
  readonly fixedDepth: number;
  readonly timeBudgetMs: number;
  readonly benchmarkId: string;
  readonly evaluationConfig?: EvaluationConfig;
}

export interface SelfPlayRow {
  readonly benchmarkId: string;
  readonly matchup: string;
  readonly gameIndex: number;
  readonly pairIndex: number;
  readonly pairSeed: number;
  readonly algorithmA: SelfPlayAlgorithm;
  readonly algorithmB: SelfPlayAlgorithm;
  readonly firstPlayer: Player;
  readonly winner: Player | null;
  readonly winnerAlgorithm: SelfPlayAlgorithm | null;
  readonly winnerReason: WinnerReason | null;
  readonly terminationReason: TerminationReason;
  readonly plies: number;
  readonly totalTimeMs: number;
  readonly totalNodes: number;
  readonly searchMoves: number;
  readonly averageDepth: number | null;
  readonly totalTtHits: number;
  /** There is no general draw rule; an aborted game contributes zero draws. */
  readonly draws: 0;
  readonly moveSequenceJson: string;
  readonly moveSequenceHash: string;
  readonly error: string | null;
}

export function classifySelfPlayError(error: unknown): {
  terminationReason: 'RULE_AMBIGUITY' | 'ENGINE_ERROR'; error: string;
} {
  return error instanceof RuleAmbiguityError ||
    (typeof error === 'object' && error !== null && 'code' in error &&
      error.code === 'RULE_AMBIGUITY')
    ? { terminationReason: 'RULE_AMBIGUITY', error: 'RULE_AMBIGUITY' }
    : { terminationReason: 'ENGINE_ERROR',
      error: error instanceof Error ? error.message : String(error) };
}

interface Decision {
  readonly move: Move | null;
  readonly nodes: number | null;
  readonly depth: number | null;
  readonly ttHits: number | null;
}

function choose(algorithm: SelfPlayAlgorithm, state: GameState, depth: number,
                budget: number, rng: () => number, config: EvaluationConfig): Decision {
  if (algorithm === 'RANDOM') return {
    move: new RandomAI(rng).chooseMove(state), nodes: null, depth: null, ttHits: null,
  };
  if (algorithm === 'MINIMAX') {
    const result = new MinimaxAI({ depth, evaluationConfig: config }).search(state);
    return { move: result.bestMove, nodes: result.nodesSearched,
      depth: result.searchDepth, ttHits: null };
  }
  if (algorithm === 'ITERATIVE_DEEPENING') {
    const result = new IterativeDeepeningAI({ maxDepth: depth, timeLimitMs: budget,
      evaluationConfig: config, useMoveOrdering: true, useTranspositionTable: true }).search(state);
    return { move: result.bestMove, nodes: result.nodesSearched,
      depth: result.searchDepth, ttHits: result.ttHits };
  }
  const result = new AlphaBetaAI({ depth, evaluationConfig: config,
    useMoveOrdering: algorithm !== 'ALPHA_BETA',
    useTranspositionTable: algorithm === 'ALPHA_BETA_TT',
  }).search(state);
  return { move: result.bestMove, nodes: result.nodesSearched,
    depth: result.searchDepth, ttHits: result.ttHits };
}

/** Every game begins at the standard initial state; each AI move is adjudicated by RuleEngine. */
export function runSelfPlay(options: SelfPlayOptions): SelfPlayRow[] {
  if (!Number.isSafeInteger(options.games) || options.games < 2 || options.games % 2 !== 0) {
    throw new RangeError('games must be a positive even count for paired side swaps');
  }
  if (!Number.isSafeInteger(options.seed) || !Number.isSafeInteger(options.maxPlies) ||
      options.maxPlies < 1 || !Number.isSafeInteger(options.fixedDepth) ||
      options.fixedDepth < 1 || !Number.isFinite(options.timeBudgetMs) ||
      options.timeBudgetMs < 0 || !options.benchmarkId) throw new RangeError('Invalid self-play config');
  const config = options.evaluationConfig ?? DEFAULT_EVALUATION_CONFIG;
  const [algorithmX, algorithmY] = options.matchup;
  const rows: SelfPlayRow[] = [];
  for (let gameIndex = 0; gameIndex < options.games; gameIndex++) {
    const pairIndex = Math.floor(gameIndex / 2);
    const pairSeed = options.seed + pairIndex;
    const algorithmA = gameIndex % 2 === 0 ? algorithmX : algorithmY;
    const algorithmB = gameIndex % 2 === 0 ? algorithmY : algorithmX;
    const rngA = createSeededRng(pairSeed);
    const rngB = createSeededRng(pairSeed);
    let state = createInitialGameState({ firstPlayer: 'A' });
    const moves: Move[] = [];
    let totalNodes = 0;
    let searchMoves = 0;
    let depthSum = 0;
    let totalTtHits = 0;
    let terminationReason: TerminationReason = 'MAX_PLIES_REACHED';
    let errorText: string | null = null;
    const started = performance.now();
    while (moves.length < options.maxPlies && state.game_status === 'PLAYING') {
      try {
        const legal = RuleEngine.getAllLegalMoves(state);
        if (!legal.length) throw new RuleAmbiguityError();
        const algorithm = state.current_player === 'A' ? algorithmA : algorithmB;
        const decision = choose(algorithm, state, options.fixedDepth, options.timeBudgetMs,
          state.current_player === 'A' ? rngA : rngB, config);
        if (!decision.move) throw new Error('AI returned no move from a playable state');
        if (decision.nodes !== null) {
          totalNodes += decision.nodes;
          searchMoves++;
          depthSum += decision.depth ?? 0;
          totalTtHits += decision.ttHits ?? 0;
        }
        state = RuleEngine.executeTurn(state, decision.move).state;
        moves.push(decision.move);
      } catch (error) {
        const classified = classifySelfPlayError(error);
        terminationReason = classified.terminationReason;
        errorText = classified.error;
        break;
      }
    }
    if (state.game_status === 'FINISHED') terminationReason = 'COMPLETED';
    const sequence = JSON.stringify(moves);
    rows.push({ benchmarkId: options.benchmarkId,
      matchup: `${algorithmX}_VS_${algorithmY}`, gameIndex, pairIndex, pairSeed,
      algorithmA, algorithmB, firstPlayer: 'A',
      winner: terminationReason === 'COMPLETED' ? state.winner : null,
      winnerAlgorithm: terminationReason === 'COMPLETED'
        ? state.winner === 'A' ? algorithmA : algorithmB : null,
      winnerReason: terminationReason === 'COMPLETED' ? state.winner_reason : null,
      terminationReason, plies: moves.length,
      totalTimeMs: performance.now() - started, totalNodes, searchMoves,
      averageDepth: searchMoves ? depthSum / searchMoves : null, totalTtHits,
      draws: 0, moveSequenceJson: sequence,
      moveSequenceHash: createHash('sha256').update(sequence).digest('hex'),
      error: errorText });
  }
  return rows;
}
