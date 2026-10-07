"""Required and strictly typed personal statistics and skill transport contract."""
from typing import Annotated, Literal
from pydantic import ConfigDict, Field, field_validator
import unicodedata
from backend.app.schemas.game import StrictModel

Count = Annotated[int, Field(ge=0)]
Score = Annotated[int, Field(ge=0, le=100)]
MetricKey = Literal['performance', 'best_move', 'decision', 'stability', 'mistake_control', 'training']
Avatar = Literal['piece_v1_shi', 'piece_v1_ma', 'piece_v1_pao']


class AccountDto(StrictModel):
    model_config = ConfigDict(extra='forbid', strict=True)


class ProfileUpdate(AccountDto):
    nickname: str
    avatar: Avatar

    @field_validator('nickname')
    @classmethod
    def valid_nickname(cls, value: str) -> str:
        if any(unicodedata.category(char) in ('Cc', 'Cf', 'Cs') for char in value):
            raise ValueError('Nickname contains control characters')
        value = value.strip()
        if not 1 <= len(value) <= 24:
            raise ValueError('Nickname must contain 1 to 24 characters')
        return value


class SkillSampleDto(AccountDto):
    label: str
    count: Count
    minimum: Annotated[int, Field(ge=1)]
    unit: Literal['局', '手', '次']


class SkillMetricDto(AccountDto):
    key: MetricKey
    label: str
    value: Score | None
    sampleCount: Count
    minimumSample: Annotated[int, Field(ge=1)]
    sampleUnit: Literal['局', '手', '次']
    sampleDetails: Annotated[list[SkillSampleDto], Field(min_length=1, max_length=2)]
    description: str


class SkillEvidenceDto(AccountDto):
    aiFinished: Count
    reviewedGames: Count
    reviewedMoves: Count
    trainingAttempts: Count


class SkillProfileDto(AccountDto):
    version: Literal['player_skill_v1']
    ready: bool
    overall: Score | None
    level: Literal['待评估', '入门', '进阶', '熟练', '精通', '卓越']
    seal: Literal['待', '入', '进', '熟', '精', '卓']
    metrics: Annotated[list[SkillMetricDto], Field(min_length=6, max_length=6)]
    evidence: SkillEvidenceDto
    disclaimer: str


class GrowthThemeDto(AccountDto):
    theme: Literal['CAPTURE', 'VULNERABILITY', 'LONE_PIECE_RISK']
    label: str
    attempts: Count
    correct: Count
    accuracy: Score | None
    completedThisWeek: Count
    remaining: Count
    recommendedDifficulty: Literal['EASY', 'NORMAL']


class GrowthPeriodDto(AccountDto):
    start: str
    end: str
    completed: Count
    attempted: Count
    firstAttempts: Count
    firstCorrect: Count
    accuracy: Score | None


class GrowthRecentDto(AccountDto):
    current: GrowthPeriodDto
    previous: GrowthPeriodDto


class GrowthDayDto(AccountDto):
    date: str
    completed: Count
    attempted: Count


class GrowthDto(AccountDto):
    version: Literal['growth_v1']
    asOf: str
    goal: Literal[2]
    minimumSamples: Literal[3]
    themes: Annotated[list[GrowthThemeDto], Field(min_length=3, max_length=3)]
    recent: GrowthRecentDto
    daily: Annotated[list[GrowthDayDto], Field(min_length=14, max_length=14)]


class PersonalProfileDto(AccountDto):
    id: str
    nickname: str
    avatar: Avatar
    games: Count
    finishedGames: Count
    wins: Count
    losses: Count
    remoteGames: Count
    remoteWins: Count
    remoteLosses: Count
    reviewedGames: Count
    training: Count
    trainingAttempts: Count
    correct: Count
    skillProfile: SkillProfileDto
    growth: GrowthDto | None = None
