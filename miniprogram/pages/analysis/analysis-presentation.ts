import { RuleEngine, getPlayerNodes } from '../../domain/index';
import type { GameState, Player } from '../../domain/index';
import type { PositionAnalysis } from '../../ai/position-analysis';

export interface PositionPresentation {
  readonly basisLabel: string;
  readonly title: string;
  readonly tone: 'balanced' | 'advantage' | 'disadvantage' | 'finished';
  readonly reasons: readonly string[];
  readonly quality: string;
  readonly outlook: string;
}

export function playerLabel(player: Player, humanPlayer?: Player): string {
  return humanPlayer ? player === humanPlayer ? '你' : 'AI' : player === 'A' ? '黑方' : '红方';
}

export function scoreText(score: number): string {
  return Number.isFinite(score) ? (Math.abs(score) < 0.05 ? 0 : score).toFixed(1) : '—';
}

function scoreBand(score: number): number {
  return Math.abs(score) < 150 ? 0 : Math.sign(score) * (Math.abs(score) >= 400 ? 2 : 1);
}

function positionTitle(label: string, score: number): string {
  const band = scoreBand(score);
  return band === 0 ? '双方局面接近' : `${label}${band === 2 ? '占明显优势'
    : band === 1 ? '稍占优势' : band === -2 ? '处于明显劣势' : '稍处劣势'}`;
}

const finishReasons: Partial<Record<NonNullable<GameState['winner_reason']>, string>> = {
  CAPTURE_ALL: '对方棋子已全部被吃。',
  TEMPLE_TRAP: '对方孤棋被困在庙内，已无合法走法。',
  LONE_PIECE_IMMOBILIZED: '对方孤棋已无合法走法。',
  ALL_PIECES_IMMOBILIZED: '对方所有棋子均无合法走法。',
  RESIGN: '对方已认输。',
};

/** Display bands describe heuristic scores, never probabilities or adjudication. */
export function presentPosition(state: GameState, analysis: PositionAnalysis,
                                humanPlayer?: Player): PositionPresentation {
  const own = analysis.analyzedPlayer;
  const other: Player = own === 'A' ? 'B' : 'A';
  const label = playerLabel(own, humanPlayer);
  const otherLabel = playerLabel(other, humanPlayer);
  if (analysis.terminal && analysis.winner) {
    const winnerLabel = playerLabel(analysis.winner, humanPlayer);
    const loserLabel = playerLabel(analysis.winner === 'A' ? 'B' : 'A', humanPlayer);
    return { title: `${winnerLabel}${winnerLabel === 'AI' ? ' ' : ''}获胜`,
      tone: 'finished', reasons: [(finishReasons[analysis.winnerReason!] ?? '对局已结束。').replace('对方', loserLabel)],
      quality: '对局结果由棋规判定', outlook: '', basisLabel: '棋规判定结果' };
  }
  const proof = analysis.threats.find(threat => threat.player === own &&
    threat.type === 'FORCED_BLOCKADE_AVAILABLE');
  const immediate = analysis.threats.find(threat => threat.player === own &&
    threat.type === 'IMMEDIATE_WIN_AVAILABLE');
  const quality = proof ? '已验证围堵路线，覆盖对手所有合法应手。'
    : immediate ? '一步获胜机会已通过棋规执行验证。'
    : analysis.searchDepth === 0
      ? '分析有限：尚未完成前瞻搜索，以下为当前棋盘判断。'
      : analysis.timedOut
        ? '分析有限：已达到分析时限，推荐仅基于已完成的搜索。'
        : '当前分析的参考判断，局势可能随后续走棋变化。';
  const score = analysis.evaluationBefore.score;
  const magnitude = Math.abs(score);
  const title = proof ? `${label}可强制围堵获胜`
    : immediate ? `${label}有一步获胜机会`
    : positionTitle(label, score);
  const outlook = !proof && !immediate && analysis.searchDepth > 0 &&
    scoreBand(analysis.bestScore) !== scoreBand(score)
    ? `后续走势参考：考虑后续应手后，当前搜索判断：${positionTitle(label, analysis.bestScore)}。这与当前棋盘判断的时间点不同。`
    : '';
  const reasons: string[] = [];
  if (proof) reasons.push(`推荐路线已覆盖对手所有合法应手，最多 ${proof.evidence.maxPlies} 手可完成围堵。`);
  else if (immediate) reasons.push('检测到一步获胜机会，可展开分析依据查看具体走法。');
  const breakdown = analysis.evaluationBreakdown;
  const material = breakdown.material.rawValue;
  if (material) reasons.push(`${label}盘上比${otherLabel}${material > 0 ? '多' : '少'} ${Math.abs(material)} 颗棋。`);
  for (const player of [own, other]) {
    if (getPlayerNodes(state.board, player).length !== 1) continue;
    const moves = RuleEngine.getAllLegalMovesForPlayer(state, player).length;
    reasons.push(`${playerLabel(player, humanPlayer)}只剩孤棋，当前有 ${moves} 个合法走法，需关注围堵风险。`);
  }
  const features = [
    { score: breakdown.reserve.weightedScore, text: `${label}备用棋比${otherLabel}${breakdown.reserve.rawValue > 0 ? '多' : '少'} ${Math.abs(breakdown.reserve.rawValue)} 颗。` },
    { score: breakdown.mobility.weightedScore, text: `${label}合法走法比${otherLabel}${breakdown.mobility.rawValue > 0 ? '多' : '少'} ${Math.abs(breakdown.mobility.rawValue)} 个。` },
    { score: breakdown.captureOpportunity.weightedScore, text: `${label}下一手可捕获的目标比${otherLabel}${breakdown.captureOpportunity.rawValue > 0 ? '多' : '少'} ${Math.abs(breakdown.captureOpportunity.rawValue)} 个。` },
    { score: breakdown.vulnerability.weightedScore, text: `${breakdown.vulnerability.rawValue > 0 ? otherLabel : label}有效吃子走法较多，注意吃子威胁。` },
    { score: breakdown.templeControl.weightedScore, text: `${label}庙内棋子比${otherLabel}${breakdown.templeControl.rawValue > 0 ? '多' : '少'} ${Math.abs(breakdown.templeControl.rawValue)} 颗，仍需结合出口判断。` },
    { score: breakdown.blockade?.weightedScore ?? 0, text: `${(breakdown.blockade?.rawValue ?? 0) > 0 ? otherLabel : label}孤棋活动区域受到封锁，围堵尚需后续走法验证。` },
  ].filter(feature => feature.score !== 0).sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  reasons.push(...features.map(feature => feature.text));
  if (!reasons.length) reasons.push('当前棋子数量与活动空间接近，尚未检测到明显差距。');
  return { title, tone: proof || immediate ? 'advantage' : magnitude < 150 ? 'balanced'
    : score > 0 ? 'advantage' : 'disadvantage', reasons: reasons.slice(0, 3), quality, outlook,
    basisLabel: proof ? '已验证的围堵路线' : immediate ? '已验证的一步获胜机会' : '当前棋盘判断' };
}
