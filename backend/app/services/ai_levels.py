"""Versioned, bounded search budgets for play only; learning budgets stay independent."""
from backend.app.core.config import Settings

AI_BUDGET_VERSION = "ai_budget_v1"

def _bounded(value: object, default: int, low: int, high: int) -> int:
    if type(value) is not int or value <= 0:
        return default
    return max(low, min(high, value))

def ai_search_budget(level: str | None, settings: Settings) -> tuple[int, int]:
    depth = _bounded(settings.ai_default_max_depth, 4, 2, 8)
    time = _bounded(settings.ai_default_time_limit_ms, 1000, 100, 3000)
    if level == "BEGINNER":
        return depth // 2, time // 2
    if level == "ADVANCED":
        return depth + 2, time * 2
    return depth, time
