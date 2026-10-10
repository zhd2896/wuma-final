import { RuleEngine } from '../domain/index';
import type { GameState, Move, NodeId, Player } from '../domain/index';
import { evaluatePosition } from './evaluation';
import type { EvaluationBreakdown, EvaluationResult } from './evaluation';
import { IterativeDeepeningAI } from './iterative-deepening';
import type { IterativeDeepeningOptions } from './iterative-deepening';
import { MoveOrderCategory, orderMoves } from './move-ordering';
import { proveBlockadeMove } from './blockade';
import { getPlayerNodes, TEMPLE_NODES } from '../domain/index';

export interface AnalyzePositionOptions extends Pick<IterativeDeepeningOptions,
  'maxDepth' | 'timeLimitMs' | 'now' | 'evaluationConfig' | 'useBlockadeExtension' | 'blockadeAttackerTurns'> {
  readonly candidateLimit?: number;
}

export interface CandidateAnalysis {
  readonly move: Move;
  readonly score: number;
  readonly rank: number;
  readonly scorePerspective: Player;
  readonly isBest: boolean;
}

export type ThreatType = 'IMMEDIATE_WIN_AVAILABLE' | 'CAPTURE_AVAILABLE' |
  'CAPTURE_THREAT' | 'VULNERABILITY' | 'LONE_PIECE_MOBILITY_RISK' | 'FORCED_BLOCKADE_AVAILABLE';

export interface ThreatInfo {
  readonly type: ThreatType;
  readonly player: Player;
  readonly relatedMove?: Move;
  readonly relatedNodes?: readonly NodeId[];
  readonly evidence: Readonly<Record<string, string | number>>;
}

export interface PositionAnalysis {
  readonly analyzedPlayer: Player;
  readonly scorePerspective: Player;
  readonly bestMove: Move | null;
  readonly bestScore: number;
  readonly evaluationBefore: EvaluationResult;
  readonly evaluationBreakdown: EvaluationBreakdown;
  readonly candidateMoves: readonly CandidateAnalysis[];
  readonly searchDepth: number;
  readonly nodesSearched: number;
  readonly thinkingTimeMs: number;
  readonly algorithm: 'ITERATIVE_DEEPENING_ALPHA_BETA';
  readonly ttHits: number;
  readonly timedOut: boolean;
  readonly threats: readonly ThreatInfo[];
  readonly terminal: boolean;
  readonly winner: Player | null;
  readonly winnerReason: GameState['winner_reason'];
}

function collectThreats(state: GameState, player: Player,
                        evaluation: EvaluationResult, bestMove: Move | null, blockadeAttackerTurns?: 1 | 2 | 3): ThreatInfo[] {
  const threats: ThreatInfo[] = [];
  for (const info of orderMoves(state)) {
    if (info.category === MoveOrderCategory.IMMEDIATE_WIN) {
      threats.push({ type: 'IMMEDIATE_WIN_AVAILABLE', player, relatedMove: info.move,
        evidence: { winnerReason: info.childState.winner_reason! } });
    } else if (info.category === MoveOrderCategory.CAPTURE) {
      const capture = RuleEngine.executeTurn(state, info.move).captures;
      threats.push({ type: 'CAPTURE_AVAILABLE', player, relatedMove: info.move,
        relatedNodes: [...capture.captured_nodes], evidence: { captureCount: info.captureCount } });
    } else if (info.category === MoveOrderCategory.CAPTURE_THREAT) {
      threats.push({ type: 'CAPTURE_THREAT', player, relatedMove: info.move,
        evidence: { moveCategory: info.category } });
    }
  }
  if (evaluation.breakdown.vulnerability.rawValue > 0) {
    threats.push({ type: 'VULNERABILITY', player,
      evidence: { excessOpponentCaptureMoves: evaluation.breakdown.vulnerability.rawValue } });
  }
  if (evaluation.breakdown.trapRisk.rawValue > 0) {
    threats.push({ type: 'LONE_PIECE_MOBILITY_RISK', player,
      evidence: { relativeLonePieceRisk: evaluation.breakdown.trapRisk.rawValue } });
  }
  const proof = bestMove ? proveBlockadeMove(state, bestMove, { maxAttackerTurns: blockadeAttackerTurns }) : null;
  if (proof && proof.maxPlies > 1) {
    const defender = player === 'A' ? 'B' : 'A';
    const seals = TEMPLE_NODES.filter(node => state.board.occupancy[node] === player);
    threats.unshift({ type: 'FORCED_BLOCKADE_AVAILABLE', player, relatedMove: bestMove!,
      relatedNodes: [...getPlayerNodes(state.board, defender), ...seals],
      evidence: { maxPlies: proof.maxPlies, replyCount: proof.lines.length,
        winnerReason: proof.winnerReasons.join('、') } });
  }
  return threats;
}

/** Read-only orchestration over the existing Evaluation and Phase 15 search. */
export function analyzePosition(state: GameState,
                                options: AnalyzePositionOptions = {
                                  maxDepth: 2, timeLimitMs: 1000, candidateLimit: 3,
                                }): PositionAnalysis {
  if (options.candidateLimit !== undefined &&
      (!Number.isSafeInteger(options.candidateLimit) || options.candidateLimit < 1)) {
    throw new RangeError('candidateLimit must be a positive safe integer');
  }
  const analyzedPlayer = state.current_player;
  const evaluationBefore = evaluatePosition(state, analyzedPlayer, options.evaluationConfig);
  const common = { analyzedPlayer, scorePerspective: analyzedPlayer, evaluationBefore,
    evaluationBreakdown: evaluationBefore.breakdown,
    winner: state.winner, winnerReason: state.winner_reason };
  if (state.game_status === 'FINISHED') {
    return { ...common, bestMove: null, bestScore: evaluationBefore.score,
      candidateMoves: [], searchDepth: 0, nodesSearched: 0, thinkingTimeMs: 0,
      algorithm: 'ITERATIVE_DEEPENING_ALPHA_BETA', ttHits: 0, timedOut: false,
      threats: [], terminal: true };
  }
  const search = new IterativeDeepeningAI({ ...options, retainProvedWin: false }).search(state, analyzedPlayer);
  const ranked = search.candidateMoves.map((candidate, index) => ({ ...candidate, index }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ move, score }, index): CandidateAnalysis => ({ move, score, rank: index + 1,
      scorePerspective: analyzedPlayer,
      isBest: search.bestMove?.from === move.from && search.bestMove.to === move.to }));
  return { ...common, bestMove: search.bestMove, bestScore: search.evaluationScore,
    candidateMoves: ranked.slice(0, options.candidateLimit),
    searchDepth: search.searchDepth, nodesSearched: search.nodesSearched,
    thinkingTimeMs: search.thinkingTimeMs, algorithm: search.algorithm,
    ttHits: search.ttHits, timedOut: search.timedOut,
    threats: collectThreats(state, analyzedPlayer, evaluationBefore,
      options.useBlockadeExtension === false ? null : search.bestMove, options.blockadeAttackerTurns), terminal: false };
}
