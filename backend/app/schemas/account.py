"""Required and strictly typed personal statistics and skill transport contract."""
from typing import Annotated, Literal
from pydantic import ConfigDict, Field
from backend.app.schemas.game import StrictModel

Count = Annotated[int, Field(ge=0)]
Score = Annotated[int, Field(ge=0, le=100)]
MetricKey = Literal['performance', 'best_move', 'decision', 'stability', 'mistake_control', 'training']


class AccountDto(StrictModel):
    model_config = ConfigDict(extra='forbid', strict=True)


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


class PersonalProfileDto(AccountDto):
    id: str
    nickname: str
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
