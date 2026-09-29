"""The only place that builds LLM prompts from trusted review facts."""

import json
from dataclasses import dataclass

from backend.app.schemas.explanation import PROMPT_VERSION
from backend.app.schemas.game import GameReview, MoveReview


@dataclass(frozen=True)
class ReviewPrompt:
    system: str
    user: str


_SYSTEM = (
    "你只解释给定的五马棋引擎事实，不分析棋盘，不重新决定最佳走法、评分、分类或转折点。"
    "不得虚构棋步、棋子、捕获、庙宇、储备、战术、胜率或概率。"
    "不要写节点编号、数字、分类标签、胜负或局势优劣判断；这些由页面从结构化结果显示。"
    "用‘实际走法’和‘最佳走法’称呼已有走法。"
    "只输出指定 JSON；中文简短、准确。"
)


class ReviewPromptBuilder:
    version = PROMPT_VERSION

    @staticmethod
    def game(review: GameReview) -> ReviewPrompt:
        facts = {
            "reviewedPlayer": review.reviewedPlayer,
            "reviewedMoves": len(review.moveReviews),
            "goodMoves": review.goodMoves, "normalMoves": review.normalMoves,
            "mistakes": review.mistakes, "blunders": review.blunders,
            "bestMoveRate": review.bestMoveRate,
            "turningPoints": review.turningPoints,
            "winner": review.winner, "winnerReason": review.winnerReason,
        }
        return ReviewPrompt(_SYSTEM, "根据以下固定事实解释整局。返回 JSON 字段 "
                            "overall_summary、strengths、main_problems、practice_suggestions；"
                            "后三个字段是最多三项的字符串数组。\n" +
                            json.dumps(facts, ensure_ascii=False, separators=(",", ":")))

    @staticmethod
    def move(move: MoveReview, review: GameReview) -> ReviewPrompt:
        facts = {
            "turn": move.turn, "player": move.player,
            "actualMove": move.actualMove.model_dump(by_alias=True),
            "bestMove": move.bestMove.model_dump(by_alias=True),
            "scoreBefore": move.scoreBefore, "scoreAfter": move.scoreAfter,
            "bestScore": move.bestScore, "actualMoveScore": move.actualMoveScore,
            "scoreLoss": move.scoreLoss, "category": move.category,
            "bestMoveEquivalent": move.bestMoveEquivalent,
            "evaluationBefore": move.evaluationBefore.model_dump(mode="json"),
            "evaluationAfter": move.evaluationAfter.model_dump(mode="json"),
            "candidateMoves": [item.model_dump(mode="json", by_alias=True)
                               for item in move.bestCandidateMoves[:3]],
            "threatsBefore": [item.model_dump(mode="json", by_alias=True)
                              for item in move.threatsBefore[:5]],
            "winner": review.winner if move.turn == review.moveReviews[-1].turn else None,
            "winnerReason": review.winnerReason if move.turn == review.moveReviews[-1].turn else None,
        }
        return ReviewPrompt(_SYSTEM, "根据以下固定事实解释这一手。返回 JSON 字段 "
                            "headline、explanation、suggestion。不要在文字中写分类标签或节点编号。\n" +
                            json.dumps(facts, ensure_ascii=False, separators=(",", ":")))
