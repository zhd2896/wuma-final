import type { GameState, Move, NodeId, Player } from '../../domain/index';
import type { EvaluationBreakdown } from '../../ai/evaluation';
import type { PositionAnalysis, ThreatType } from '../../ai/position-analysis';
import type { BoardState } from '../../types/domain';
import { mapGameStateToView } from '../game/game-state-mapper';
import { describeMove, highlightBoardMove } from '../../utils/board-guidance';
import { playerLabel, presentPosition, scoreText } from './analysis-presentation';
import type { PositionPresentation } from './analysis-presentation';
import { createMovePurposeExplainer } from './move-purpose';

export const threatLabels: Readonly<Record<ThreatType, string>> = {
  FORCED_BLOCKADE_AVAILABLE: '存在已验证的强制围堵路线',
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
  readonly scoreText: string;
  readonly basis: string;
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
  readonly scoreText: string;
  readonly assessment: string;
  readonly detail: string;
  readonly purpose: string;
}

export interface AnalysisViewModel {
  readonly presentation: PositionPresentation;
  readonly perspectiveLabel: string;
  readonly sideLabels: Readonly<Record<Player, string>>;
  readonly scoreText: string;
  readonly bestScoreText: string;
  readonly thinkingTimeText: string;
  readonly board: BoardState;
  readonly reserve: Readonly<Record<Player, number>>;
  readonly perspective: Player;
  readonly score: number;
  readonly bestScore: number;
  readonly breakdown: readonly AnalysisBreakdownRow[];
  readonly threats: readonly AnalysisThreatRow[];
  readonly keyPieces: readonly AnalysisKeyPiece[];
  readonly bestMove: AnalysisCandidateRow | null;
  readonly candidates: readonly AnalysisCandidateRow[];
  readonly alternatives: readonly AnalysisCandidateRow[];
  readonly searchDepth: number;
  readonly nodesSearched: number;
  readonly thinkingTimeMs: number;
  readonly timedOut: boolean;
  readonly terminal: boolean;
  readonly winner: Player | null;
  readonly winnerReason: GameState['winner_reason'];
}

function candidateRow(move: Move, score: number, rank: number,
                      isBest: boolean, tied: boolean): AnalysisCandidateRow {
  return {
    id: `${move.from}-${move.to}`,
    rank,
    move,
    notation: `${move.from} → ${move.to}`,
    score,
    scoreText: scoreText(score),
    assessment: isBest ? '推荐尝试' : tied ? '当前分析下相当' : '备选走法',
    detail: describeMove(move),
    purpose: '',
  };
}

export function mapPositionAnalysis(state: GameState,
                                    analysis: PositionAnalysis, humanPlayer?: Player): AnalysisViewModel {
  const board = highlightBoardMove(mapGameStateToView(state, {
    selectedNode: null, legalTargets: [], lastMove: null,
  }).board, analysis.bestMove);
  let candidates = analysis.candidateMoves.map(item =>
    candidateRow(item.move, item.score, item.rank, item.isBest, item.score === analysis.bestScore));
  let bestCandidate = analysis.bestMove
    ? candidates.find(item => item.move.from === analysis.bestMove?.from &&
        item.move.to === analysis.bestMove?.to) ??
      candidateRow(analysis.bestMove, analysis.bestScore, 1, true, false)
    : null;
  const explainMove = createMovePurposeExplainer(state, analysis, humanPlayer);
  const displayedIds = new Set(candidates.filter(candidate => candidate.id !== bestCandidate?.id)
    .slice(0, 2).map(candidate => candidate.id));
  if (bestCandidate) displayedIds.add(bestCandidate.id);
  candidates = candidates.map(candidate => displayedIds.has(candidate.id)
    ? { ...candidate, purpose: explainMove(candidate.move) } : candidate);
  if (bestCandidate) bestCandidate = candidates.find(candidate => candidate.id === bestCandidate!.id)
    ?? { ...bestCandidate, purpose: explainMove(bestCandidate.move) };
  const threats = analysis.threats.map((threat, index): AnalysisThreatRow => ({
    id: `${threat.type}-${index}`,
    label: threatLabels[threat.type] + (threat.type === 'FORCED_BLOCKADE_AVAILABLE'
      ? ` · 最多 ${threat.evidence.maxPlies} 手，覆盖全部合法应手` : ''),
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
    addKey(candidate.move.from, candidate.isBest ? '推荐走法起点' : '候选走法起点');
  }
  const keyPieces = [...keyReasons].map(([nodeId, reason]): AnalysisKeyPiece => {
    const player = state.board.occupancy[nodeId]!;
    return { nodeId, player, sideLabel: playerLabel(player, humanPlayer), reason };
  });
  return {
    presentation: presentPosition(state, analysis, humanPlayer),
    perspectiveLabel: playerLabel(analysis.analyzedPlayer, humanPlayer),
    sideLabels: { A: playerLabel('A', humanPlayer), B: playerLabel('B', humanPlayer) },
    scoreText: scoreText(analysis.evaluationBefore.score),
    bestScoreText: scoreText(analysis.bestScore),
    thinkingTimeText: `${(analysis.thinkingTimeMs / 1000).toFixed(1)} 秒`,
    board,
    reserve: { A: state.players.A.reserve_count, B: state.players.B.reserve_count },
    perspective: analysis.analyzedPlayer,
    score: analysis.evaluationBefore.score,
    bestScore: analysis.bestScore,
    breakdown: [...breakdownLabels.filter(({ key }) => analysis.evaluationBreakdown[key] !== undefined)
      .map(({ key, label }) => ({ key, label,
        rawValue: analysis.evaluationBreakdown[key]!.rawValue,
        weightedScore: analysis.evaluationBreakdown[key]!.weightedScore,
        scoreText: scoreText(analysis.evaluationBreakdown[key]!.weightedScore),
        basis: `指标差约 ${scoreText(analysis.evaluationBreakdown[key]!.rawValue)} × 权重 ${scoreText(analysis.evaluationBreakdown[key]!.weight)}` })),
      ...(analysis.evaluationBreakdown.blockade?.rawValue ? [{ key: 'blockade' as const, label: '围堵进度（启发式）',
        rawValue: analysis.evaluationBreakdown.blockade.rawValue,
        weightedScore: analysis.evaluationBreakdown.blockade.weightedScore,
        scoreText: scoreText(analysis.evaluationBreakdown.blockade.weightedScore),
        basis: `指标差约 ${scoreText(analysis.evaluationBreakdown.blockade.rawValue)} × 权重 ${scoreText(analysis.evaluationBreakdown.blockade.weight)}` }] : [])],
    threats,
    keyPieces,
    bestMove: bestCandidate,
    candidates,
    alternatives: candidates.filter(candidate => candidate.id !== bestCandidate?.id).slice(0, 2),
    searchDepth: analysis.searchDepth,
    nodesSearched: analysis.nodesSearched,
    thinkingTimeMs: analysis.thinkingTimeMs,
    timedOut: analysis.timedOut,
    terminal: analysis.terminal,
    winner: analysis.winner,
    winnerReason: analysis.winnerReason,
  };
}
