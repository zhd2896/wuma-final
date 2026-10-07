import type { GameReplayDto, GameReviewDto } from '../../services/api-contract';
import { mapGameStateToView } from '../game/game-state-mapper';
import { describeMove } from '../../utils/board-guidance';
import { reviewReason, ruleReasonText } from '../../services/feedback-presentation';

/** Each index selects a saved state; terminal events do not consume a ply. */
export function replayView(replay: GameReplayDto, review: GameReviewDto, requestedIndex: number) {
  const index = Math.min(replay.steps.length, Math.max(0, Math.round(Number.isFinite(requestedIndex) ? requestedIndex : 0)));
  const step = index > 0 ? replay.steps[index - 1] : null;
  const state = step?.state ?? replay.initial_state;
  const previousMove = step?.kind === 'MOVE' ? step : replay.steps.slice(0, index).reverse().find(s => s.kind === 'MOVE');
  const lastMove = previousMove?.kind === 'MOVE' ? previousMove.move : null;
  const capture = step?.kind === 'MOVE' ? step.capture : null;
  const mapped = mapGameStateToView(state, { selectedNode: null, legalTargets: [], lastMove, lastCapture: capture });
  const row = step?.kind === 'MOVE' && step.player === review.reviewedPlayer
    ? review.moveReviews.find(r => r.turn === step.ply && r.player === review.reviewedPlayer) : undefined;
  const explanation = !step ? '初始局面，尚未走棋。' : step.kind === 'RESIGN'
    ? `玩家 ${step.player} 认输，终局事件不增加棋步。`
    : step.player !== review.reviewedPlayer ? `对手走法 · 玩家 ${step.player}，没有本人评价。`
    : row ? reviewReason(row) : '本方走法，本步没有评价。';
  return { replayIndex: index, replayPly: step?.ply ?? 0, replayTotalPly: replay.ply_count,
    replayMaxIndex: replay.steps.length, replayBoard: mapped.board,
    replayCurrentPlayer: mapped.currentPlayer, replayReserveA: mapped.reserve.A, replayReserveB: mapped.reserve.B,
    replayVersion: step?.version ?? 0,
    replayStepText: !step ? '首局面' : step.kind === 'RESIGN' ? `终局 · 玩家 ${step.player} 认输` : `第 ${step.ply} 手 · 玩家 ${step.player} · ${describeMove(step.move)}`,
    replayCaptureText: !capture ? '无吃子事件' : capture.was_applied
      ? `吃子：${capture.captured_nodes.join('、')} · 备用棋使用 ${capture.reserve_used} 枚`
      : capture.failure_reason === 'NONE' ? '本手没有吃子' : `吃子未生效：${ruleReasonText(capture.failure_reason)}`,
    replayExplanation: explanation, replayNaturalExplanation: '', replayRowTurn: row?.turn ?? 0 };
}
