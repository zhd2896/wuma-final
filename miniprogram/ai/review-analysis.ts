import { NODE_IDS, RuleEngine } from '../domain/index';
import type { GameState, Move, Player } from '../domain/index';
import { evaluatePosition } from './evaluation';
import type { EvaluationConfig, EvaluationResult } from './evaluation';
import { analyzePosition } from './position-analysis';
import type { CandidateAnalysis, ThreatInfo } from './position-analysis';

export interface ReviewSearchConfig {
  readonly maxDepth: number;
  readonly timeLimitMs: number;
  readonly candidateLimit: number;
  /** Heuristic thresholds in evaluation score units; not benchmark calibrated. */
  readonly goodMaxLoss: number;
  readonly normalMaxLoss: number;
  readonly mistakeMaxLoss: number;
  readonly now?: () => number;
  readonly evaluationConfig?: EvaluationConfig;
  readonly useBlockadeExtension?: boolean;
}

export type MoveCategory = 'GOOD' | 'NORMAL' | 'MISTAKE' | 'BLUNDER';

export interface ReviewMoveAnalysis {
  readonly actualMove: Move;
  readonly bestMove: Move;
  readonly scorePerspective: Player;
  readonly scoreBefore: number;
  readonly scoreAfter: number;
  readonly bestScore: number;
  readonly actualMoveScore: number;
  readonly scoreLoss: number;
  readonly bestMoveEquivalent: boolean;
  readonly category: MoveCategory;
  readonly evaluationBefore: EvaluationResult;
  readonly evaluationAfter: EvaluationResult;
  readonly bestCandidateMoves: readonly CandidateAnalysis[];
  readonly threatsBefore: readonly ThreatInfo[];
  readonly engineExplanation: string;
  readonly searchDepth: number;
  readonly timedOut: boolean;
}

export class ReviewAnalysisError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function sameState(left: GameState, right: GameState): boolean {
  return left.first_player === right.first_player &&
    left.current_player === right.current_player &&
    left.game_status === right.game_status &&
    left.winner === right.winner && left.winner_reason === right.winner_reason &&
    left.players.A.reserve_count === right.players.A.reserve_count &&
    left.players.B.reserve_count === right.players.B.reserve_count &&
    NODE_IDS.every(node => left.board.occupancy[node] === right.board.occupancy[node]);
}

/** Review one historical human turn using the same completed root search for both scores. */
export function analyzeReviewMove(stateBefore: GameState, stateAfter: GameState,
                                  actualMove: Move, config: ReviewSearchConfig): ReviewMoveAnalysis {
  if (!(config.goodMaxLoss >= 0 && config.goodMaxLoss <= config.normalMaxLoss &&
        config.normalMaxLoss <= config.mistakeMaxLoss &&
        Number.isFinite(config.mistakeMaxLoss))) {
    throw new RangeError('Invalid review thresholds');
  }
  const replayed = stateBefore.game_status === 'PLAYING' && RuleEngine.validateMove(stateBefore, actualMove)
    ? RuleEngine.executeTurn(stateBefore, actualMove).state : null;
  // Older snapshots kept a multi-piece blockade PLAYING. Only this adjudication
  // difference is compatible; occupancy, reserves and the next player stay exact.
  const legacyBlockade = replayed?.winner_reason === 'ALL_PIECES_IMMOBILIZED' &&
    sameState({ ...replayed, game_status: 'PLAYING', winner: null, winner_reason: null }, stateAfter);
  if (!replayed || (!sameState(replayed, stateAfter) && !legacyBlockade)) {
    throw new ReviewAnalysisError('REPLAY_INTEGRITY_ERROR', 'Stored move and snapshots disagree');
  }
  const player = stateBefore.current_player;
  // candidateLimit only limits the public result. Request all exact root scores here.
  const analysis = analyzePosition(stateBefore, { maxDepth: config.maxDepth,
    timeLimitMs: config.timeLimitMs, candidateLimit: Number.MAX_SAFE_INTEGER, now: config.now,
    evaluationConfig: config.evaluationConfig, useBlockadeExtension: config.useBlockadeExtension });
  if (analysis.searchDepth === 0 || !analysis.bestMove) {
    throw new ReviewAnalysisError('REVIEW_INCOMPLETE', 'No complete search depth for this move');
  }
  const actual = analysis.candidateMoves.find(item =>
    item.move.from === actualMove.from && item.move.to === actualMove.to);
  if (!actual) throw new ReviewAnalysisError('REVIEW_INCOMPLETE', 'Actual move has no exact score');
  const loss = analysis.bestScore - actual.score;
  if (!Number.isFinite(loss) || loss < -1e-9) {
    throw new ReviewAnalysisError('REVIEW_INCOMPLETE', 'Inconsistent review search scores');
  }
  const scoreLoss = Math.abs(loss) <= 1e-9 ? 0 : loss;
  const category: MoveCategory = scoreLoss <= config.goodMaxLoss ? 'GOOD'
    : scoreLoss <= config.normalMaxLoss ? 'NORMAL'
      : scoreLoss <= config.mistakeMaxLoss ? 'MISTAKE' : 'BLUNDER';
  const evaluationAfter = evaluatePosition(stateAfter, player, config.evaluationConfig);
  const bestMoveEquivalent = scoreLoss === 0;
  const missedWin = analysis.threats.some(threat =>
    threat.type === 'IMMEDIATE_WIN_AVAILABLE' &&
    threat.relatedMove?.from === analysis.bestMove?.from &&
    threat.relatedMove?.to === analysis.bestMove?.to) && !stateAfter.winner;
  const searchExplanation = bestMoveEquivalent
    ? '实际走法与最佳方案搜索同分。'
    : missedWin ? `该走法错过了直接获胜机会，搜索评分损失 ${scoreLoss}。`
      : `该走法比最佳方案的搜索评分低 ${scoreLoss}。`;
  const forcedBlockade = analysis.threats.find(threat => threat.type === 'FORCED_BLOCKADE_AVAILABLE');
  const blockadeExplanation = forcedBlockade ? bestMoveEquivalent
    ? '这步保留封锁通路，已验证对手任意合法应手后均可完成围堵。'
    : '这步错过了可强制完成的围堵；应保留封口棋，调入另一枚棋收紧通路。' : '';
  const engineExplanation = legacyBlockade
    ? `历史棋谱按原记录保留，评价使用现行规则。${blockadeExplanation}${searchExplanation}`
    : blockadeExplanation + searchExplanation;
  return { actualMove, bestMove: analysis.bestMove, scorePerspective: player,
    scoreBefore: analysis.evaluationBefore.score, scoreAfter: evaluationAfter.score,
    bestScore: analysis.bestScore, actualMoveScore: actual.score, scoreLoss,
    bestMoveEquivalent, category, evaluationBefore: analysis.evaluationBefore,
    evaluationAfter, bestCandidateMoves: analysis.candidateMoves.slice(0, config.candidateLimit),
    threatsBefore: analysis.threats, engineExplanation,
    searchDepth: analysis.searchDepth, timedOut: analysis.timedOut };
}
