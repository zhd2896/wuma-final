"""Pure, versioned skill profile calculation from account-scoped evidence."""
from dataclasses import dataclass, fields
from fractions import Fraction
from math import floor, isfinite

PLAYER_SKILL_VERSION = 'player_skill_v1'


@dataclass(frozen=True)
class SkillEvidence:
    wins: int = 0
    losses: int = 0
    training_attempts: int = 0
    training_correct: int = 0
    reviewed_games: int = 0
    reviewed_moves: int = 0
    good_moves: int = 0
    normal_moves: int = 0
    mistakes: int = 0
    blunders: int = 0
    best_equivalent_moves: int = 0
    score_loss_sum: float = 0

    def validate(self) -> None:
        for field in fields(self):
            value = getattr(self, field.name)
            if field.name == 'score_loss_sum':
                if type(value) not in (int, float) or not isfinite(value) or value < 0:
                    raise ValueError('score_loss_sum must be finite and nonnegative')
            elif type(value) is not int or value < 0:
                raise ValueError(f'{field.name} must be a nonnegative integer')
        if self.training_correct > self.training_attempts:
            raise ValueError('Correct answers exceed attempts')
        if self.best_equivalent_moves > self.reviewed_moves:
            raise ValueError('Equivalent moves exceed reviewed moves')
        if self.good_moves + self.normal_moves + self.mistakes + self.blunders != self.reviewed_moves:
            raise ValueError('Move categories must partition reviewed moves')
        if self.reviewed_games > min(self.reviewed_moves, self.wins + self.losses):
            raise ValueError('Reviewed games exceed eligible games or human moves')
        if self.reviewed_moves and not self.reviewed_games:
            raise ValueError('Reviewed moves require reviewed games')
        if not self.reviewed_moves and self.score_loss_sum:
            raise ValueError('Score loss requires reviewed moves')


def _round_score(value: Fraction) -> int:
    return max(0, min(100, floor(value + Fraction(1, 2))))


def skill_grade(score: int) -> tuple[str, str]:
    for minimum, level, seal in [(90, '卓越', '卓'), (75, '精通', '精'),
                                  (60, '熟练', '熟'), (40, '进阶', '进')]:
        if score >= minimum:
            return level, seal
    return '入门', '入'


def calculate_skill_profile(evidence: SkillEvidence) -> dict:
    evidence.validate()
    e = evidence
    ai_finished = e.wins + e.losses
    review_ready = e.reviewed_games >= 3 and e.reviewed_moves >= 15
    # Exact ratios avoid cancellation around half points (e.g. 57.5 becoming
    # 57.49999999999999). Persisted finite losses enter as their decimal value.
    capped_loss = min(Fraction(str(e.score_loss_sum)), 200 * e.reviewed_moves)
    game_samples = [dict(label='AI 对局', count=ai_finished, minimum=5, unit='局')]
    review_samples = [dict(label='复盘局数', count=e.reviewed_games, minimum=3, unit='局'),
                      dict(label='复盘着数', count=e.reviewed_moves, minimum=15, unit='手')]
    training_samples = [dict(label='训练作答', count=e.training_attempts, minimum=5, unit='次')]

    def metric(key, label, value, samples, description):
        primary = samples[-1]
        return dict(key=key, label=label, value=None if value is None else _round_score(value),
                    sampleCount=primary['count'], minimumSample=primary['minimum'],
                    sampleUnit=primary['unit'], sampleDetails=[dict(s) for s in samples], description=description)

    metrics = [
        metric('performance', '实战表现', Fraction(100 * e.wins, ai_finished) if ai_finished >= 5 else None,
               game_samples, 'AI 对局胜率'),
        metric('best_move', '最佳着率', Fraction(100 * e.best_equivalent_moves, e.reviewed_moves) if review_ready else None,
               review_samples, '与引擎最佳着等价的比例'),
        metric('decision', '决策质量', Fraction(100) - capped_loss / (2 * e.reviewed_moves) if review_ready else None,
               review_samples, '平均分数损失越低，分数越高'),
        metric('stability', '稳定性', Fraction(100 * (e.good_moves + e.normal_moves), e.reviewed_moves) if review_ready else None,
               review_samples, '正常及以上质量的着法比例'),
        metric('mistake_control', '失误控制', Fraction(100 * (2 * e.reviewed_moves - e.mistakes - 2 * e.blunders),
                                                    2 * e.reviewed_moves) if review_ready else None,
               review_samples, '严重失误按普通失误的两倍扣分'),
        metric('training', '训练掌握', Fraction(100 * e.training_correct, e.training_attempts) if e.training_attempts >= 5 else None,
               training_samples, '真实训练作答正确率'),
    ]
    ready = all(m['value'] is not None for m in metrics)
    overall = _round_score(Fraction(sum(m['value'] for m in metrics), 6)) if ready else None
    level, seal = skill_grade(overall) if overall is not None else ('待评估', '待')
    return dict(version=PLAYER_SKILL_VERSION, ready=ready, overall=overall, level=level, seal=seal,
                metrics=metrics, evidence=dict(aiFinished=ai_finished, reviewedGames=e.reviewed_games,
                                               reviewedMoves=e.reviewed_moves, trainingAttempts=e.training_attempts),
                disclaimer='根据当前账号的实战、复盘和训练记录计算，仅作为弈智五马内的能力参考。')
