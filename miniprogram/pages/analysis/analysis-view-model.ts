import type { GameState, Move, NodeId, Player } from '../../domain/index';
import type { EvaluationBreakdown } from '../../ai/evaluation';
import type { PositionAnalysis, ThreatType } from '../../ai/position-analysis';
import type { BoardState } from '../../types/domain';
import { mapGameStateToView } from '../game/game-state-mapper';

export const threatLabels: Readonly<Record<ThreatType, string>> = {
  IMMEDIATE_WIN_AVAILABLE: '存在直接获胜走法',
  CAPTURE_AVAILABLE: '存在直接捕获机会',
  CAPTURE_THREAT: '存在后续捕获威胁',
  VULNERABILITY: '对手捕获行动较多',
  LONE_PIECE_MOBILITY_RISK: '孤棋机动性较低',
};

const breakdownLabels: readonly { key: Exclude<keyof EvaluationBreakdown, 'terminal'>;
  label: string }[] = [
  { key: 'material', label: '子力' },
  { key: 'reserve', label: '备用子' },
  { key: 'mobility', label: '机动性' },
  { key: 'templeControl', label: '庙宇控制' },
  { key: 'captureOpportunity', label: '捕获机会' },
  { key: 'vulnerability', label: '易受攻击' },
  { key: 'trapRisk', label: '孤棋风险' },
];

export interface AnalysisBreakdownRow {
  readonly key: Exclude<keyof EvaluationBreakdown, 'terminal'>;
  readonly label: string;
  readonly rawValue: number;
  readonly weightedScore: number;
}

export interface AnalysisThreatRow {
  readonly id: string;
  readonly label: string;
  readonly move: string;
  readonly nodes: string;
}

export interface AnalysisKeyPiece {
  readonly nodeId: NodeId;
  readonly player: Player;
  readonly sideLabel: string;
  readonly reason: string;
}

export interface AnalysisCandidateRow {
  readonly id: string;
  readonly rank: number;
  readonly move: Move;
  readonly notation: string;
  readonly score: number;
  readonly assessment: string;
  readonly detail: string;
}

export interface AnalysisViewModel {
  readonly board: BoardState;
  readonly perspective: Player;
  readonly score: number;
  readonly bestScore: number;
  readonly breakdown: readonly AnalysisBreakdownRow[];
  readonly threats: readonly AnalysisThreatRow[];
  readonly keyPieces: readonly AnalysisKeyPiece[];
  readonly bestMove: AnalysisCandidateRow | null;
  readonly candidates: readonly AnalysisCandidateRow[];
  readonly searchDepth: number;
  readonly nodesSearched: number;
  readonly thinkingTimeMs: number;
  readonly timedOut: boolean;
  readonly terminal: boolean;
  readonly winner: Player | null;
  readonly winnerReason: GameState['winner_reason'];
}

function candidateRow(move: Move, score: number, rank: number,
                      isBest: boolean): AnalysisCandidateRow {
  return {
    id: `${move.from}-${move.to}`,
    rank,
    move,
    notation: `${move.from} → ${move.to}`,
    score,
    assessment: isBest ? '最佳走法' : `候选 ${rank}`,
    detail: `引擎评分 ${score}`,
  };
}

export function mapPositionAnalysis(state: GameState,
                                    analysis: PositionAnalysis): AnalysisViewModel {
  const board = mapGameStateToView(state, {
    selectedNode: null, legalTargets: [], lastMove: analysis.bestMove,
  }).board;
  const candidates = analysis.candidateMoves.map(item =>
    candidateRow(item.move, item.score, item.rank, item.isBest));
  const bestCandidate = analysis.bestMove
    ? candidates.find(item => item.move.from === analysis.bestMove?.from &&
        item.move.to === analysis.bestMove?.to) ??
      candidateRow(analysis.bestMove, analysis.bestScore, 1, true)
    : null;
  const threats = analysis.threats.map((threat, index): AnalysisThreatRow => ({
    id: `${threat.type}-${index}`,
    label: threatLabels[threat.type],
    move: threat.relatedMove
      ? `${threat.relatedMove.from} → ${threat.relatedMove.to}` : '',
    nodes: threat.relatedNodes?.join('、') ?? '',
  }));
  const keyReasons = new Map<NodeId, string>();
  const addKey = (nodeId: NodeId, reason: string): void => {
    if (state.board.occupancy[nodeId] !== null && !keyReasons.has(nodeId)) {
      keyReasons.set(nodeId, reason);
    }
  };
  for (const threat of analysis.threats) {
    for (const node of threat.relatedNodes ?? []) addKey(node, threatLabels[threat.type]);
    if (threat.relatedMove) addKey(threat.relatedMove.from, threatLabels[threat.type]);
  }
  for (const candidate of analysis.candidateMoves) {
    addKey(candidate.move.from, candidate.isBest ? '最佳走法起点' : '候选走法起点');
  }
  const keyPieces = [...keyReasons].map(([nodeId, reason]): AnalysisKeyPiece => {
    const player = state.board.occupancy[nodeId]!;
    return { nodeId, player, sideLabel: player === 'A' ? '黑方 A' : '红方 B', reason };
  });
  return {
    board,
    perspective: analysis.analyzedPlayer,
    score: analysis.evaluationBefore.score,
    bestScore: analysis.bestScore,
    breakdown: breakdownLabels.map(({ key, label }) => ({ key, label,
      rawValue: analysis.evaluationBreakdown[key].rawValue,
      weightedScore: analysis.evaluationBreakdown[key].weightedScore })),
    threats,
    keyPieces,
    bestMove: bestCandidate,
    candidates,
    searchDepth: analysis.searchDepth,
    nodesSearched: analysis.nodesSearched,
    thinkingTimeMs: analysis.thinkingTimeMs,
    timedOut: analysis.timedOut,
    terminal: analysis.terminal,
    winner: analysis.winner,
    winnerReason: analysis.winnerReason,
  };
}
