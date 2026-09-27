import { performance } from 'node:perf_hooks';
import { AlphaBetaAI } from '../../miniprogram/ai/alpha-beta.ts';
import { DEFAULT_EVALUATION_CONFIG } from '../../miniprogram/ai/evaluation.ts';
import type { EvaluationConfig } from '../../miniprogram/ai/evaluation.ts';
import { IterativeDeepeningAI } from '../../miniprogram/ai/iterative-deepening.ts';
import { MinimaxAI, RuleAmbiguityError } from '../../miniprogram/ai/minimax.ts';
import type { CandidateMoveScore } from '../../miniprogram/ai/minimax.ts';
import type { Move, Player } from '../../miniprogram/domain/index.ts';
import type { BenchmarkPosition } from './positions.mts';

export const FIXED_ALGORITHMS = [
  'MINIMAX', 'ALPHA_BETA', 'ORDERED_ALPHA_BETA', 'ALPHA_BETA_TT',
] as const;
export type FixedAlgorithm = typeof FIXED_ALGORITHMS[number];
export type SearchStatus = 'COMPLETED' | 'NOT_COMPLETED' | 'RULE_AMBIGUITY' | 'ENGINE_ERROR';
export type SearchAlgorithm = FixedAlgorithm | 'ITERATIVE_DEEPENING';

export interface SearchBenchmarkRow {
  readonly benchmarkId: string;
  readonly experiment: 'FIXED_DEPTH' | 'TIME_BUDGET';
  readonly positionId: string;
  readonly positionSource: string;
  readonly algorithm: SearchAlgorithm;
  readonly rootPlayer: Player;
  readonly depth: number | null;
  readonly budgetMs: number | null;
  readonly repetition: number;
  readonly status: SearchStatus;
  readonly bestMoveFrom: string | null;
  readonly bestMoveTo: string | null;
  readonly evaluationScore: number | null;
  readonly scorePerspective: Player | null;
  readonly nodesSearched: number | null;
  readonly searchDepth: number | null;
  /** External high-resolution wall clock for every algorithm. */
  readonly thinkingTimeMs: number;
  readonly timedOut: boolean | null;
  readonly candidateBestEquivalent: boolean | null;
  readonly cutoffs: number | null;
  readonly ttProbes: number | null;
  readonly ttHits: number | null;
  readonly ttCutoffs: number | null;
  readonly ttStores: number | null;
  readonly error: string | null;
}

interface CommonOptions {
  readonly positions: readonly BenchmarkPosition[];
  readonly repetitions: number;
  readonly warmups: number;
  readonly benchmarkId: string;
  readonly evaluationConfig?: EvaluationConfig;
}
export interface FixedDepthOptions extends CommonOptions {
  readonly depths: readonly number[];
  readonly algorithms?: readonly FixedAlgorithm[];
}
export interface TimeBudgetOptions extends CommonOptions {
  readonly budgetsMs: readonly number[];
  readonly maxDepth: number;
}

function validateCommon(options: CommonOptions): void {
  if (!Number.isSafeInteger(options.repetitions) || options.repetitions < 1 ||
      !Number.isSafeInteger(options.warmups) || options.warmups < 0 ||
      !options.benchmarkId || !options.positions.length) {
    throw new RangeError('Invalid benchmark repetitions, warmups, ID, or position suite');
  }
}

function fixedSearch(position: BenchmarkPosition, depth: number,
                     algorithm: FixedAlgorithm, config: EvaluationConfig) {
  const state = position.state;
  const player = position.currentPlayer;
  if (algorithm === 'MINIMAX') return new MinimaxAI({ depth, evaluationConfig: config }).search(state, player);
  return new AlphaBetaAI({ depth, evaluationConfig: config,
    useMoveOrdering: algorithm !== 'ALPHA_BETA',
    useTranspositionTable: algorithm === 'ALPHA_BETA_TT',
  }).search(state, player);
}

function bestEquivalent(best: Move | null, candidates: readonly CandidateMoveScore[],
                        score: number): boolean {
  if (!best) return candidates.length === 0;
  return candidates.some(candidate => candidate.move.from === best.from &&
    candidate.move.to === best.to && candidate.score === score);
}

function warmup(execute: () => unknown): void {
  try { execute(); }
  catch { /* The measured repetition records the search error as a raw status row. */ }
}

function measure(
  position: BenchmarkPosition, benchmarkId: string, experiment: SearchBenchmarkRow['experiment'],
  algorithm: SearchAlgorithm, depth: number | null, budgetMs: number | null,
  repetition: number, execute: () => ReturnType<typeof fixedSearch> |
    ReturnType<IterativeDeepeningAI['search']>,
): SearchBenchmarkRow {
  const started = performance.now();
  try {
    const result = execute();
    const elapsed = performance.now() - started;
    const complete = experiment === 'FIXED_DEPTH'
      ? result.searchDepth === depth : result.searchDepth > 0;
    const timedOut = 'timedOut' in result ? result.timedOut : false;
    const metrics = 'ttProbes' in result ? result : null;
    return {
      benchmarkId, experiment, positionId: position.id, positionSource: position.source,
      algorithm, rootPlayer: position.currentPlayer, depth, budgetMs, repetition,
      status: complete ? 'COMPLETED' : 'NOT_COMPLETED',
      bestMoveFrom: result.bestMove?.from ?? null,
      bestMoveTo: result.bestMove?.to ?? null,
      evaluationScore: result.evaluationScore, scorePerspective: result.scorePerspective,
      nodesSearched: result.nodesSearched, searchDepth: result.searchDepth,
      thinkingTimeMs: elapsed, timedOut,
      candidateBestEquivalent: bestEquivalent(result.bestMove,
        result.candidateMoves, result.evaluationScore),
      cutoffs: metrics?.cutoffs ?? null, ttProbes: metrics?.ttProbes ?? null,
      ttHits: metrics?.ttHits ?? null, ttCutoffs: metrics?.ttCutoffs ?? null,
      ttStores: metrics?.ttStores ?? null, error: null,
    };
  } catch (error) {
    const kind = error instanceof RuleAmbiguityError ? 'RULE_AMBIGUITY' : 'ENGINE_ERROR';
    return { benchmarkId, experiment, positionId: position.id,
      positionSource: position.source, algorithm, rootPlayer: position.currentPlayer,
      depth, budgetMs, repetition, status: kind, bestMoveFrom: null, bestMoveTo: null,
      evaluationScore: null, scorePerspective: null, nodesSearched: null,
      searchDepth: null, thinkingTimeMs: performance.now() - started,
      timedOut: null, candidateBestEquivalent: null, cutoffs: null,
      ttProbes: null, ttHits: null, ttCutoffs: null, ttStores: null,
      error: error instanceof Error ? error.message : String(error) };
  }
}

/** Each measured sample owns a new search object and a search-local TT. */
export function runFixedDepth(options: FixedDepthOptions): SearchBenchmarkRow[] {
  validateCommon(options);
  if (!options.depths.length || options.depths.some(depth =>
    !Number.isSafeInteger(depth) || depth < 1)) throw new RangeError('Invalid fixed depths');
  const algorithms = options.algorithms ?? FIXED_ALGORITHMS;
  if (!algorithms.length || new Set(algorithms).size !== algorithms.length ||
      algorithms.some(algorithm => !FIXED_ALGORITHMS.includes(algorithm))) {
    throw new RangeError('Invalid fixed algorithms');
  }
  const config = options.evaluationConfig ?? DEFAULT_EVALUATION_CONFIG;
  const rows: SearchBenchmarkRow[] = [];
  for (const position of options.positions) for (const depth of options.depths) {
    for (const algorithm of algorithms) {
      for (let index = 0; index < options.warmups; index++) {
        warmup(() => fixedSearch(position, depth, algorithm, config));
      }
      for (let repetition = 1; repetition <= options.repetitions; repetition++) {
        rows.push(measure(position, options.benchmarkId, 'FIXED_DEPTH', algorithm,
          depth, null, repetition, () => fixedSearch(position, depth, algorithm, config)));
      }
    }
  }
  return rows;
}

export function runTimeBudget(options: TimeBudgetOptions): SearchBenchmarkRow[] {
  validateCommon(options);
  if (!Number.isSafeInteger(options.maxDepth) || options.maxDepth < 1 ||
      !options.budgetsMs.length || options.budgetsMs.some(budget =>
        !Number.isFinite(budget) || budget < 0)) throw new RangeError('Invalid time budgets');
  const config = options.evaluationConfig ?? DEFAULT_EVALUATION_CONFIG;
  const rows: SearchBenchmarkRow[] = [];
  for (const position of options.positions) for (const budget of options.budgetsMs) {
    const execute = () => new IterativeDeepeningAI({ maxDepth: options.maxDepth,
      timeLimitMs: budget, evaluationConfig: config,
      useMoveOrdering: true, useTranspositionTable: true,
    }).search(position.state, position.currentPlayer);
    for (let index = 0; index < options.warmups; index++) warmup(execute);
    for (let repetition = 1; repetition <= options.repetitions; repetition++) {
      rows.push(measure(position, options.benchmarkId, 'TIME_BUDGET', 'ITERATIVE_DEEPENING',
        options.maxDepth, budget, repetition, execute));
    }
  }
  return rows;
}

export interface ScoreMismatch {
  readonly positionId: string;
  readonly depth: number;
  readonly repetition: number;
  readonly algorithm: SearchAlgorithm;
  readonly expected: number;
  readonly actual: number;
}

export function fixedScoreMismatches(rows: readonly SearchBenchmarkRow[]): ScoreMismatch[] {
  const baseline = new Map<string, number>();
  for (const row of rows) if (row.experiment === 'FIXED_DEPTH' &&
      row.algorithm === 'MINIMAX' && row.status === 'COMPLETED' && row.depth !== null &&
      row.evaluationScore !== null) {
    baseline.set(`${row.positionId}:${row.rootPlayer}:${row.depth}:${row.repetition}`,
      row.evaluationScore);
  }
  const mismatches: ScoreMismatch[] = [];
  for (const row of rows) if (row.experiment === 'FIXED_DEPTH' &&
      row.algorithm !== 'MINIMAX' && row.status === 'COMPLETED' && row.depth !== null &&
      row.evaluationScore !== null) {
    const expected = baseline.get(`${row.positionId}:${row.rootPlayer}:${row.depth}:${row.repetition}`);
    if (expected !== undefined && expected !== row.evaluationScore) mismatches.push({
      positionId: row.positionId, depth: row.depth, repetition: row.repetition,
      algorithm: row.algorithm, expected, actual: row.evaluationScore });
  }
  return mismatches;
}
