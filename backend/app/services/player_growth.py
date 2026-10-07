"""Account-scoped practice guidance, with identical memory and SQL evidence semantics."""
from datetime import datetime, timedelta, timezone

SHANGHAI = timezone(timedelta(hours=8))
THEMES = [('CAPTURE', '吃子'), ('VULNERABILITY', '防守'), ('LONE_PIECE_RISK', '孤棋')]
GOAL = 2
MINIMUM = 3


def growth_window_start(now=None):
    now = now or datetime.now(timezone.utc)
    day = now.astimezone(SHANGHAI).replace(hour=0, minute=0, second=0, microsecond=0)
    return (day - timedelta(days=27)).astimezone(timezone.utc).replace(tzinfo=None)


def calculate_growth(records, now=None):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    today = now.astimezone(SHANGHAI).date()
    rows = []
    for record in records:
        at = record['answeredAt']
        at = at.replace(tzinfo=timezone.utc) if at.tzinfo is None else at
        day = at.astimezone(SHANGHAI).date()
        if today - timedelta(days=27) <= day <= today and at <= now:
            rows.append({**record, 'at': at, 'day': day})
    rows.sort(key=lambda r: (r['at'], r['id']))

    def first_exposure(items):
        first = {}
        for item in items:
            first.setdefault(item['trainingId'], item)
        return [r for r in first.values() if not r.get('hintLevelUsed')]

    def rate(first):
        correct = sum(r['result'] == 'CORRECT' for r in first)
        return correct, (int(100 * correct / len(first) + 0.5) if len(first) >= MINIMUM else None)

    def period(start, end):
        subset = [r for r in rows if start <= r['day'] <= end]
        first = first_exposure(subset)
        correct, accuracy = rate(first)
        return dict(start=start.isoformat(), end=end.isoformat(),
                    completed=len({r['trainingId'] for r in subset if r['result'] == 'CORRECT'}),
                    attempted=len({r['trainingId'] for r in subset}),
                    firstAttempts=len(first), firstCorrect=correct, accuracy=accuracy)

    current_start = today - timedelta(days=6)
    current = period(current_start, today)
    previous = period(today - timedelta(days=13), today - timedelta(days=7))
    themes = []
    first = first_exposure(rows)
    for key, label in THEMES:
        samples = [r for r in first if key in r['tags']]
        correct, accuracy = rate(samples)
        completed = len({r['trainingId'] for r in rows if key in r['tags'] and
                         r['day'] >= current_start and r['result'] == 'CORRECT'})
        themes.append(dict(theme=key, label=label, attempts=len(samples), correct=correct,
                           accuracy=accuracy, completedThisWeek=completed,
                           remaining=max(0, GOAL-completed),
                           recommendedDifficulty='NORMAL' if len(samples) >= MINIMUM and correct * 4 >= len(samples) * 3 else 'EASY'))
    daily = []
    for offset in range(13, -1, -1):
        day = today - timedelta(days=offset)
        subset = [r for r in rows if r['day'] == day]
        daily.append(dict(date=day.isoformat(), completed=len({r['trainingId'] for r in subset if r['result']=='CORRECT'}),
                          attempted=len({r['trainingId'] for r in subset})))
    return dict(version='growth_v1', asOf=today.isoformat(), goal=GOAL, minimumSamples=MINIMUM,
                themes=themes, recent=dict(current=current, previous=previous), daily=daily)
