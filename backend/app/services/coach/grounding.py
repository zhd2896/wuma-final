"""Reject model claims that exceed the evidence shown at each hint level."""

import re

from backend.app.services.coach.policy import AllowedCoachEvidence


NODE = re.compile(r"(?<![A-Za-z0-9])P\d{2}(?![A-Za-z0-9])", re.IGNORECASE)
MOVE = re.compile(r"(?<![A-Za-z0-9])(P\d{2})\s*(?:→|->|至|到|走到|走至|去往|移到|移动到)\s*(P\d{2})(?![A-Za-z0-9])", re.IGNORECASE)
PROBABILITY = re.compile(r"胜率|获胜概率|赢面|\d+(?:\.\d+)?\s*[%％]")


def validate_coach_text(text: str, evidence: AllowedCoachEvidence) -> bool:
    if not text.strip() or PROBABILITY.search(text):
        return False
    nodes = [node.upper() for node in NODE.findall(text)]
    moves = [(source.upper(), target.upper()) for source, target in MOVE.findall(text)]
    if evidence.level == 1:
        if nodes:
            return False
    elif evidence.level == 2:
        if moves or any(node not in evidence.candidateFromNodes for node in nodes):
            return False
        if re.search(r"(?:移到|移动到|走到|落到|目标点|终点)", text):
            return False
    else:
        best = evidence.bestMove
        best_pair = (best.from_node, best.to_node) if best else None
        # In prose, show only the Engine's best action. Other candidates stay in
        # structured evidence for comparisons but cannot become advice by wording.
        if best_pair is None and nodes:
            return False
        if best_pair is not None and any(node not in best_pair for node in nodes):
            return False
        if any(move != best_pair for move in moves):
            return False
        if len(nodes) >= 2 and (len(nodes) % 2 != 0 or any(
            tuple(nodes[index:index + 2]) != best_pair
            for index in range(0, len(nodes), 2))):
            return False
    if "夹" in text or "挑" in text:
        return False  # ThreatInfo does not prove the capture mechanism.
    if "捕获" in text or "吃子" in text:
        if "对手" in text:
            if "VULNERABILITY" not in evidence.threatTypes or not re.search(r"风险|威胁", text):
                return False
        elif "威胁" in text and "机会" not in text and "可以" not in text:
            if "CAPTURE_THREAT" not in evidence.threatTypes:
                return False
        elif "CAPTURE_AVAILABLE" not in evidence.threatTypes:
            return False
        if evidence.level == 3 and re.search(r"这(?:一)?步|该步|推荐走法|最佳走法", text):
            if "CAPTURE_AVAILABLE" not in evidence.bestMoveThreatTypes:
                return False
    if re.search(r"直接获胜|立即获胜|立即结束|必胜|胜利|终局", text):
        if "IMMEDIATE_WIN_AVAILABLE" not in evidence.threatTypes:
            return False
        if evidence.level == 3 and re.search(r"这(?:一)?步|该步|推荐走法|最佳走法", text):
            if "IMMEDIATE_WIN_AVAILABLE" not in evidence.bestMoveThreatTypes:
                return False
    if re.search(r"强制完成围堵|强制围堵|(?:可|能|一定|保证).*(?:完成围堵|封锁获胜|封死)", text):
        if "FORCED_BLOCKADE_AVAILABLE" not in evidence.threatTypes:
            return False
        if evidence.level == 3 and "FORCED_BLOCKADE_AVAILABLE" not in evidence.bestMoveThreatTypes:
            return False
    guaranteed_result = re.search(r"(?:一定|必然|必定|保证|肯定|必胜|稳赢|强制).*(?:获胜|胜利|成功|庙困|封死)", text)
    if guaranteed_result:
        proved_types = {"FORCED_BLOCKADE_AVAILABLE", "IMMEDIATE_WIN_AVAILABLE"}
        if not proved_types.intersection(evidence.threatTypes):
            return False
        if evidence.level == 3 and not proved_types.intersection(evidence.bestMoveThreatTypes):
            return False
        # The filtered policy provides no terminal-reason evidence. A guaranteed
        # specific temple result would exceed the facts supplied to the model.
        if "庙困" in text:
            return False
    # Scores and counts are structured facts; arbitrary digits in prose are unsupported.
    if re.search(r"\d", NODE.sub("", text)):
        return False
    return True
