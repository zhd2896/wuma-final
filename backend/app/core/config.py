"""Runtime settings; DATABASE_URL overrides individual DB_* variables."""

from dataclasses import dataclass, field
import os
from pathlib import Path
from sqlalchemy.engine import URL


REPO_ROOT = Path(__file__).resolve().parents[3]


def default_engine_command() -> tuple[str, ...]:
    return (os.getenv("WUMA_NODE_EXECUTABLE", "node"), str(REPO_ROOT / "backend" / "engine_worker.mjs"))


def default_database_url() -> str:
    explicit = os.getenv("DATABASE_URL")
    if explicit:
        return explicit
    return URL.create(
        "mysql+pymysql",
        username=os.getenv("DB_USER", "wuma"),
        password=os.getenv("DB_PASSWORD", ""),
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=int(os.getenv("DB_PORT", "3306")),
        database=os.getenv("DB_NAME", "wuma"),
        query={"charset": "utf8mb4"},
    ).render_as_string(hide_password=False)


@dataclass(frozen=True)
class Settings:
    environment: str = field(default_factory=lambda: os.getenv("WUMA_ENV", "development"))
    engine_command: tuple[str, ...] = field(default_factory=default_engine_command)
    engine_request_timeout_s: float = 45.0
    ai_default_max_depth: int = 4
    ai_default_time_limit_ms: int = 1000
    analysis_max_depth: int = 2
    analysis_time_limit_ms: int = 1000
    analysis_candidate_limit: int = 3
    database_url: str = field(default_factory=default_database_url)
    llm_api_key: str = field(default_factory=lambda: os.getenv("LLM_API_KEY", ""))
    llm_base_url: str = field(default_factory=lambda: os.getenv("LLM_BASE_URL", ""))
    llm_model: str = field(default_factory=lambda: os.getenv("LLM_MODEL", ""))
    llm_provider_name: str = field(default_factory=lambda: os.getenv("LLM_PROVIDER", "configured"))
    llm_timeout_seconds: float = field(default_factory=lambda: float(os.getenv("LLM_TIMEOUT_SECONDS", "8")))
    llm_total_timeout_seconds: float = field(default_factory=lambda: float(os.getenv("LLM_TOTAL_TIMEOUT_SECONDS", "30")))
    llm_temperature: float = field(default_factory=lambda: float(os.getenv("LLM_TEMPERATURE", "0.1")))
