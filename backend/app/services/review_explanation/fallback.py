"""Honest deterministic text made only from saved review facts."""

from backend.app.schemas.explanation import GameExplanationText, MoveExplanationText
from backend.app.schemas.game import GameReview, MoveReview


_MOVE_TEXT = {
    "GOOD": "这一步与引擎最佳方案评分相同，没有可测的局面损失。",
    "NORMAL": "这一步相对最佳方案有少量局面评分损失。",
    "MISTAKE": "这一步使局面评分明显低于最佳方案。",
    "BLUNDER": "这一步造成较大的局面评分损失，是本局需要重点复盘的节点。",
}
_WINNER_REASON = {
    "CAPTURE_ALL": "对方棋子全部被吃尽",
    "TEMPLE_TRAP": "换手后，对方孤棋在庙内无合法走法",
    "LONE_PIECE_IMMOBILIZED": "对方仅剩棋子无法合法移动",
    "ALL_PIECES_IMMOBILIZED": "对方所有棋子均无合法走法",
    "RESIGN": "对方认输",
}


def fallback_move(move: MoveReview) -> MoveExplanationText:
    if move.bestMoveEquivalent and move.actualMove != move.bestMove:
        detail = "虽然走法不同，但搜索评分与最佳方案相同，属于等价最佳选择。"
    else:
        detail = _MOVE_TEXT[move.category]
    blockade = any(threat.type == "FORCED_BLOCKADE_AVAILABLE" for threat in move.threatsBefore)
    if blockade:
        detail += ("这步保留了可强制完成的围堵路线。" if move.bestMoveEquivalent else
                   "走前存在可强制完成的围堵路线，这步没有及时利用。")
    return MoveExplanationText(
        headline=f"第 {move.turn} 手复盘",
        explanation=f"{detail}相对最佳方案的评分损失为 {move.scoreLoss:g} 分。",
        suggestion=("保留已有封口，调入另一枚棋收紧通路，再检查对手全部合法应手。"
                    if blockade else "比较页面列出的实际走法与最佳走法，观察评分差异。"),
    )


def fallback_game(review: GameReview) -> GameExplanationText:
    turns = "、".join(str(turn) for turn in review.turningPoints)
    summary = (f"本局共复盘 {len(review.moveReviews)} 手：GOOD {review.goodMoves}，"
               f"NORMAL {review.normalMoves}，MISTAKE {review.mistakes}，"
               f"BLUNDER {review.blunders}。同分最佳走法比例 "
               f"{review.bestMoveRate * 100:.1f}%；"
               + (f"主要转折点为第 {turns} 手。" if turns else "无明显失误转折点。"))
    if review.winner is not None and review.winnerReason is not None:
        reason = (f"玩家 {'B' if review.winner == 'A' else 'A'} 认输"
                  if review.winnerReason == "RESIGN" else _WINNER_REASON[review.winnerReason])
        summary += f"最终玩家 {review.winner} 获胜；终局原因为{reason}。"
    return GameExplanationText(overall_summary=summary,
        strengths=[f"有 {review.goodMoves} 手与引擎最佳方案同分。"] if review.goodMoves else [],
        main_problems=[f"有 {review.mistakes + review.blunders} 手评分损失较明显。"]
                      if review.mistakes + review.blunders else [],
        practice_suggestions=["对照复盘中的实际走法和最佳走法，优先查看关键转折点。"])
