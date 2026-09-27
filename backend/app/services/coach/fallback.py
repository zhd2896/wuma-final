"""Deterministic beginner hints, using only the allowed evidence."""

from backend.app.services.coach.policy import AllowedCoachEvidence


def fallback_hint(evidence: AllowedCoachEvidence) -> str:
    topic = evidence.focusTopics[0] if evidence.focusTopics else "当前局面"
    if evidence.level == 1:
        return f"先关注{topic}，再检查自己有哪些合法选择。"
    if evidence.level == 2:
        if evidence.candidateFromNodes:
            nodes = "、".join(evidence.candidateFromNodes)
            return f"可以优先考虑 {nodes} 的棋子，比较它们的合法路线。"
        return f"继续关注{topic}，比较当前可选棋子的合法路线。"
    if evidence.bestMove:
        return (f"当前推荐走 {evidence.bestMove.from_node}→{evidence.bestMove.to_node}，"
                "这是本次引擎搜索得到的最佳行动。")
    return "本次分析没有找到可推荐的行动。"
