"""Aggregate first-exposure results, separate from stable teaching stages."""
from backend.app.schemas.training import TrainingCalibration

MINIMUM_PLAYTEST_ACCOUNTS = 20


def calibrate_difficulty(samples: int, correct: int) -> TrainingCalibration:
    suggested = None
    if samples >= MINIMUM_PLAYTEST_ACCOUNTS:
        ratio = correct / samples
        suggested = 'EASY' if ratio >= .75 else 'NORMAL' if ratio >= .40 else 'COMPLEX'
    return TrainingCalibration(sampleCount=samples, firstTryCorrectCount=correct,
        minimumSamples=MINIMUM_PLAYTEST_ACCOUNTS,
        status='CALIBRATED' if suggested else 'COLLECTING', suggestedDifficulty=suggested)
