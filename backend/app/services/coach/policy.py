"""Remove forbidden engine facts before any Coach LLM call."""

from pydantic import BaseModel, ConfigDict

from backend.app.schemas.game import Move, NodeId, PositionAnalysis


THREAT_TOPICS = {
    "IMMEDIATE_WIN_AVAILABLE": "直接终局机会",
    "CAPTURE_AVAILABLE": "捕获机会",
    "CAPTURE_THREAT": "捕获威胁",
    "VULNERABILITY": "受攻击风险",
    "LONE_PIECE_MOBILITY_RISK": "孤棋机动性",
}
EVALUATION_TOPICS = {
    "material": "子力",
    "reserve": "备用棋",
    "mobility": "机动性",
    "templeControl": "庙宇控制",
    "captureOpportunity": "捕获机会",
    "vulnerability": "受攻击风险",
    "trapRisk": "孤棋风险",
}


class AllowedCoachEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    level: int
    focusTopics: list[str]
    threatTypes: list[str]
    candidateFromNodes: list[NodeId]
    bestMove: Move | None = None
    bestScore: float | None = None
    bestMoveThreatTypes: list[str] = []
    candidateMoves: list[Move] = []
    allowedNodes: list[NodeId] = []


class CoachHintPolicy:
    @staticmethod
    def build(analysis: PositionAnalysis, level: int) -> AllowedCoachEvidence:
        threat_types = list(dict.fromkeys(threat.type for threat in analysis.threats))
        topics = list(dict.fromkeys(THREAT_TOPICS[kind] for kind in threat_types))
        if not topics:
            ranked = sorted(EVALUATION_TOPICS, key=lambda key:
                            abs(getattr(analysis.evaluationBreakdown, key).weightedScore),
                            reverse=True)
            topics = [EVALUATION_TOPICS[ranked[0]]]
        common = {"level": level, "focusTopics": topics[:3], "threatTypes": threat_types}
        if level == 1:
            return AllowedCoachEvidence(**common, candidateFromNodes=[])
        origins = list(dict.fromkeys(item.move.from_node for item in analysis.candidateMoves))
        # A destination revealed as another candidate's origin can complete the answer.
        if analysis.bestMove:
            origins = [node for node in origins if node != analysis.bestMove.to_node]
        origins = origins[:3]
        if level == 2:
            return AllowedCoachEvidence(**common, candidateFromNodes=origins)
        moves = [item.move for item in analysis.candidateMoves]
        if analysis.bestMove and analysis.bestMove not in moves:
            moves.insert(0, analysis.bestMove)
        nodes = list(dict.fromkeys(node for move in moves
                                   for node in (move.from_node, move.to_node)))
        nodes.extend(node for threat in analysis.threats for node in (threat.relatedNodes or [])
                     if node not in nodes)
        return AllowedCoachEvidence(**common, candidateFromNodes=origins,
                                    bestMove=analysis.bestMove, bestScore=analysis.bestScore,
                                    bestMoveThreatTypes=list(dict.fromkeys(
                                        threat.type for threat in analysis.threats
                                        if analysis.bestMove is not None and
                                        threat.relatedMove == analysis.bestMove)),
                                    candidateMoves=moves, allowedNodes=nodes)
