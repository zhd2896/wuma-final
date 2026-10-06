"""Versioned skill formulas use real samples, never fallback scores."""
import pytest


def calculate(**changes):
    from backend.app.services.player_skill import SkillEvidence, calculate_skill_profile
    return calculate_skill_profile(SkillEvidence(**changes))


def ready(**changes):
    evidence = dict(wins=3, losses=2, reviewed_games=3, reviewed_moves=20,
                    good_moves=5, normal_moves=10, mistakes=3, blunders=2,
                    best_equivalent_moves=5, score_loss_sum=1000,
                    training_attempts=5, training_correct=4)
    return calculate(**(evidence | changes))


def values(profile):
    return {item['key']: item['value'] for item in profile['metrics']}


def test_empty_evidence_returns_null_scores_and_complete_gates():
    profile = calculate()
    assert profile['version'] == 'player_skill_v1'
    assert (profile['ready'], profile['overall'], profile['level'], profile['seal']) == (False, None, '待评估', '待')
    assert list(values(profile)) == ['performance', 'best_move', 'decision', 'stability', 'mistake_control', 'training']
    assert all(v is None for v in values(profile).values())
    assert profile['metrics'][1]['sampleDetails'] == [
        {'label': '复盘局数', 'count': 0, 'minimum': 3, 'unit': '局'},
        {'label': '复盘着数', 'count': 0, 'minimum': 15, 'unit': '手'}]
    assert profile['metrics'][5]['sampleUnit'] == '次'
    assert '能力参考' in profile['disclaimer']


def test_six_formulas_and_overall():
    profile = ready()
    assert values(profile) == dict(performance=60, best_move=25, decision=75, stability=75, mistake_control=83, training=80)
    assert (profile['ready'], profile['overall'], profile['level'], profile['seal']) == (True, 66, '熟练', '熟')
    assert profile['evidence'] == dict(aiFinished=5, reviewedGames=3, reviewedMoves=20, trainingAttempts=5)


@pytest.mark.parametrize('changes,missing', [
    ({'wins': 2, 'losses': 2}, ['performance']),
    ({'reviewed_games': 2}, ['best_move', 'decision', 'stability', 'mistake_control']),
    ({'reviewed_moves': 14, 'good_moves': 4, 'normal_moves': 5, 'mistakes': 3, 'blunders': 2}, ['best_move', 'decision', 'stability', 'mistake_control']),
    ({'training_attempts': 4}, ['training']),
])
def test_gates_are_independent(changes, missing):
    profile = ready(**changes)
    assert [k for k, v in values(profile).items() if v is None] == missing
    assert profile['overall'] is None and profile['seal'] == '待'


def test_exact_minimums_zero_and_hundred_are_real_scores():
    zero = ready(wins=0, losses=5, reviewed_moves=15, good_moves=0, normal_moves=0,
                 mistakes=0, blunders=15, best_equivalent_moves=0, score_loss_sum=6000, training_correct=0)
    assert all(v == 0 for v in values(zero).values())
    assert zero['overall'] == 0 and zero['seal'] == '入'
    perfect = ready(wins=5, losses=0, reviewed_moves=15, good_moves=15, normal_moves=0,
                    mistakes=0, blunders=0, best_equivalent_moves=15, score_loss_sum=0, training_correct=5)
    assert all(v == 100 for v in values(perfect).values()) and perfect['seal'] == '卓'


def test_half_up_and_blunder_weight():
    assert values(ready(wins=1, losses=7, training_attempts=8, training_correct=1))['performance'] == 13
    assert values(ready(training_attempts=8, training_correct=1))['training'] == 13
    assert values(ready())['mistake_control'] == 83  # 82.5 -> 83
    assert values(ready(good_moves=5, normal_moves=10, mistakes=5, blunders=0))['mistake_control'] == 88


def test_review_formulas_and_overall_round_half_up():
    profile = ready(reviewed_moves=40, good_moves=5, normal_moves=0, mistakes=35, blunders=0,
                    best_equivalent_moves=5, score_loss_sum=7000)
    assert {k: values(profile)[k] for k in ('best_move', 'decision', 'stability')} == {
        'best_move': 13, 'decision': 13, 'stability': 13}
    assert ready(training_attempts=100, training_correct=81)['overall'] == 67  # 66.5


@pytest.mark.parametrize('metric', ['mistake_control', 'decision'])
def test_half_up_survives_float_subtraction_cancellation(metric):
    profile = ready(reviewed_moves=20, good_moves=3, normal_moves=0, mistakes=17, blunders=0,
                    best_equivalent_moves=3, score_loss_sum=1700)
    assert values(profile)[metric] == 58  # exact 57.5 for both business formulas


@pytest.mark.parametrize('moves', [20, 40, 100])
def test_all_half_point_ratios_match_exact_integer_arithmetic(moves):
    # Compare independent integer rational oracle across every possible mistake count.
    for mistakes in range(moves + 1):
        numerator = 100 * (2 * moves - mistakes)
        denominator = 2 * moves
        expected = (2 * numerator + denominator) // (2 * denominator)
        profile = ready(wins=moves-mistakes, losses=mistakes,
                        training_attempts=moves, training_correct=moves-mistakes,
                        reviewed_moves=moves, good_moves=moves-mistakes, normal_moves=0,
                        mistakes=mistakes, blunders=0, best_equivalent_moves=moves-mistakes,
                        score_loss_sum=50 * mistakes)
        assert values(profile)['mistake_control'] == expected
        ratio_score = (200 * (moves-mistakes) + moves) // (2 * moves)
        for metric in ('performance', 'best_move', 'stability', 'training'):
            assert values(profile)[metric] == ratio_score
        decision_numerator = 200 * moves - 50 * mistakes
        assert values(profile)['decision'] == (2 * decision_numerator + denominator) // (2 * denominator)
        total = sum(values(profile).values())
        assert profile['overall'] == (2 * total + 6) // 12


@pytest.mark.parametrize('score,level,seal', [(0,'入门','入'),(39,'入门','入'),(40,'进阶','进'),(59,'进阶','进'),(60,'熟练','熟'),(74,'熟练','熟'),(75,'精通','精'),(89,'精通','精'),(90,'卓越','卓'),(100,'卓越','卓')])
def test_grade_boundaries(score, level, seal):
    from backend.app.services.player_skill import skill_grade
    assert skill_grade(score) == (level, seal)


@pytest.mark.parametrize('changes', [
    {'wins': -1}, {'wins': 1.5}, {'wins': True}, {'losses': '2'},
    {'score_loss_sum': float('nan')}, {'score_loss_sum': float('inf')}, {'score_loss_sum': -1},
    {'score_loss_sum': True}, {'score_loss_sum': '1'}, {'training_correct': 6},
    {'best_equivalent_moves': 21}, {'good_moves': 6}, {'reviewed_games': 21},
    {'reviewed_games': 6}, {'reviewed_moves': 0, 'good_moves': 0, 'normal_moves': 0, 'mistakes': 0, 'blunders': 0, 'best_equivalent_moves': 0},
])
def test_invalid_evidence_cannot_create_plausible_scores(changes):
    with pytest.raises(ValueError):
        ready(**changes)


def test_positive_loss_without_moves_is_invalid():
    with pytest.raises(ValueError):
        calculate(score_loss_sum=1)
