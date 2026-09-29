"""Reject unsupported claims; never repair model text into invented evidence."""

import re


_NODE = re.compile(r"(?<![A-Za-z0-9])P\d{2}(?![A-Za-z0-9])", re.IGNORECASE)
_MOVE = re.compile(r"(?<![A-Za-z0-9])(P\d{2})\s*(?:→|->|至|到)\s*(P\d{2})(?![A-Za-z0-9])", re.IGNORECASE)
_CATEGORY = re.compile(r"(?<![A-Za-z])(?:GOOD|NORMAL|MISTAKE|BLUNDER)(?![A-Za-z])", re.IGNORECASE)
_UNSUPPORTED = re.compile(
    r"胜率|获胜概率|赢面|\d+(?:\.\d+)?\s*[%％]\s*(?:概率|获胜)|"
    r"夹吃|担吃|捕获|吃掉|吃子|储备|补子|庙宇|立即获胜|直接获胜"
)
_EQUIVALENCE_CLAIM = re.compile(
    r"同分|等价最佳|也是最佳|没有.{0,5}(?:评分)?损失|零损失|无损失|"
    r"相同评分|没有差别|无差别|不逊于最佳|与最佳方案等价"
)
_CLASSIFICATION_CLAIM = re.compile(r"好棋|普通走法|普通棋|严重失误|败着")
_OUTCOME_CLAIM = re.compile(r"玩家\s*[AB]|[AB]\s*方|获胜|胜利|赢得|战胜|落败|输掉|赢家|胜方|终局")
_ADVANTAGE_CLAIM = re.compile(r"更强|更好|更优|优于|高于|胜过|更有利|更占优|领先|提升|改善|占优|优势")
_GAME_PRAISE = re.compile(r"完美|出色|优秀|稳健|碾压|没有问题|没有失误")
_CHINESE_NUMBER = re.compile(r"[零一二三四五六七八九十百千万两]+\s*(?:手|次|分|点|成)")


def validate_move_text(text: str, actual: tuple[str, str],
                       best: tuple[str, str], category: str) -> bool:
    if _UNSUPPORTED.search(text):
        return False
    allowed_nodes = set(actual + best)
    if any(node.upper() not in allowed_nodes for node in _NODE.findall(text)):
        return False
    if any((source.upper(), target.upper()) not in (actual, best)
           for source, target in _MOVE.findall(text)):
        return False
    # Numeric facts and classification stay in the structured Review UI.
    if re.search(r"\d", _NODE.sub("", text)):
        return False
    if _CATEGORY.search(text) or _CLASSIFICATION_CLAIM.search(text):
        return False
    if _OUTCOME_CLAIM.search(text) or _ADVANTAGE_CLAIM.search(text):
        return False
    if _CHINESE_NUMBER.search(text):
        return False
    if category != "GOOD" and _EQUIVALENCE_CLAIM.search(text):
        return False
    if category != "GOOD" and re.search(
        r"(?:这|该|实际|本)(?:一)?步.{0,6}(?:是|属于).{0,4}(?:最佳走法|完美走法)", text
    ):
        return False
    return True


def validate_game_text(text: str) -> bool:
    return (not _NODE.search(text) and not _UNSUPPORTED.search(text)
            and not re.search(r"\d", text) and not _CATEGORY.search(text)
            and not _CLASSIFICATION_CLAIM.search(text)
            and not _OUTCOME_CLAIM.search(text)
            and not _ADVANTAGE_CLAIM.search(text)
            and not _GAME_PRAISE.search(text)
            and not _CHINESE_NUMBER.search(text))
