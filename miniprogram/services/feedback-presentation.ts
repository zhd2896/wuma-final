import type { MoveReviewDto, TrainingAnswerDto } from './api-contract';
import type { Player } from '../domain/index';

const categories: Readonly<Record<string, string>> = { GOOD: '好棋', NORMAL: '一般', MISTAKE: '失误', BLUNDER: '严重失误' };
const reasons: Readonly<Record<string, string>> = { CAPTURE_ALL: '棋子被吃尽', TEMPLE_TRAP: '庙区困局',
  LONE_PIECE_IMMOBILIZED: '孤棋无路可走', ALL_PIECES_IMMOBILIZED: '所有棋子均无合法走法', RESIGN: '认输', INSUFFICIENT_RESERVE: '备用棋不足',
  TWO_PIECES_CANNOT_CARRY: '对方只剩两子，不能挑吃', LAST_PIECE_CANNOT_CLAMP: '对方只剩一子，不能夹吃',
  NOT_NEW_PATTERN: '没有形成新的吃子结构', LINE_HAS_EXTRA_PIECES: '同一直线上有其他棋子', NONE: '没有吃子' };

export function reviewCategoryText(category: string): string { return categories[category] ?? '未评价'; }
export function ruleReasonText(reason: string | null): string { return reason ? reasons[reason] ?? '原因暂不可用' : '尚未结束'; }
export function translateFeedback(text: string): string {
  return text.replace(/\b(GOOD|NORMAL|MISTAKE|BLUNDER|CAPTURE_ALL|TEMPLE_TRAP|LONE_PIECE_IMMOBILIZED|ALL_PIECES_IMMOBILIZED|RESIGN)\b/g,
    key => categories[key] ?? reasons[key]);
}
export function readableReason(text: string | undefined, fallback: string): string {
  const parts = translateFeedback(text ?? '').split(/[。；;\n]+/).map(part => part.trim())
    .filter(part => part && !/评分|搜索|深度|版本|损失.*分|胜率.*%|同分/.test(part));
  return parts.length ? parts.join('。') + '。' : fallback;
}
export function reviewReason(move: MoveReviewDto & { naturalExplanation?: string }): string {
  const types = new Set((move.threatsBefore ?? []).map(threat => threat.type));
  if (types.has('FORCED_BLOCKADE_AVAILABLE') && move.engineExplanation?.includes('仍能完成强制围堵')) {
    return '这步仍可围堵，但收网较慢；建议比较更快的封锁路线。';
  }
  const fallback = types.has('FORCED_BLOCKADE_AVAILABLE')
    ? move.bestMoveEquivalent || move.category === 'GOOD'
      ? '这步保留了封锁通路，已验证可强制完成围堵；仍需根据对手应手继续收口。'
      : '走前存在可强制完成的围堵路线；保留封口棋，调入另一枚棋收紧通路。'
    : move.bestMoveEquivalent || move.category === 'GOOD'
    ? '这步是当前分析下的好选择；不同路线也可能同样有效。'
    : types.has('IMMEDIATE_WIN_AVAILABLE') ? '走前存在直接获胜的机会，应重点比较是否及时抓住。'
    : types.has('CAPTURE_AVAILABLE') ? '走前存在吃子机会，需要比较吃子后能否应对对手反击。'
    : types.has('VULNERABILITY') ? '走前存在受吃风险，先检查对手下一步能否夹吃或挑吃。'
    : types.has('LONE_PIECE_MOBILITY_RISK') ? '孤棋存在被封锁的风险，要为后续移动保留通路。'
    : '当前分析认为还有更好的路线；结合走前棋盘，比较对手下一步的吃子和封锁机会。';
  return readableReason(move.naturalExplanation, fallback);
}
export function keyReviewMoments<T extends { player: Player; category: string; scoreLoss: number; turn: number }>(rows: readonly T[], player: Player): T[] {
  return rows.filter(row => row.player === player && (row.category === 'BLUNDER' || row.category === 'MISTAKE'))
    .sort((a, b) => Number(b.category === 'BLUNDER') - Number(a.category === 'BLUNDER') || b.scoreLoss - a.scoreLoss || a.turn - b.turn)
    .slice(0, 3);
}
export function answerFeedback(answer: TrainingAnswerDto | null) {
  if (!answer) return { title: '', reason: '', recommendationNote: '' };
  const correct = answer.result === 'CORRECT';
  const sameRoute = answer.submittedMove.from === answer.bestMove.from && answer.submittedMove.to === answer.bestMove.to;
  return { title: correct ? '走法正确' : '还有更好的走法',
    reason: readableReason(answer.lessonExplanation ?? answer.feedback,
      correct ? '你的走法是当前分析下的有效最佳选择。' : '这步走法合法，但推荐路线更好；比较两条路线，并检查对手下一步的吃子和封锁机会。'),
    recommendationNote: correct && !sameRoute ? '推荐路线供参考，你的走法同样有效。' : '' };
}
