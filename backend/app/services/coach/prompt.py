"""Coach-specific prompt, built exclusively from level-filtered evidence."""

import json
from dataclasses import dataclass

from backend.app.services.coach.policy import AllowedCoachEvidence


@dataclass(frozen=True)
class CoachPrompt:
    system: str
    user: str


class CoachPromptBuilder:
    @staticmethod
    def build(evidence: AllowedCoachEvidence) -> CoachPrompt:
        system = (
            "你是五马棋初学者教练，只解释给定的引擎事实，不看棋盘或另选走法。"
            "只能使用 JSON 证据中的信息，不能猜测节点、棋步、胜率或结果。"
            "输出 JSON 对象，仅包含 hintText 中文字符串，简短准确。"
        )
        instructions = {
            1: "只说关注主题，不写节点编号或具体走法。",
            2: "可以说候选起点，不写目标点或完整走法。",
            3: "可以解释 bestMove；若说推荐走法，必须与 bestMove 一致。",
        }
        facts = evidence.model_dump(mode="json", by_alias=True, exclude_none=True,
                                    exclude_defaults=True)
        return CoachPrompt(system, instructions[evidence.level] + "\n" +
                           json.dumps(facts, ensure_ascii=False, separators=(",", ":")))
