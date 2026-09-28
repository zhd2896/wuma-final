# Real Player Skill Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed “我的棋力” placeholder with a versioned six-metric profile calculated from the current anonymous account's real AI games, human-side reviews, and training attempts.

**Architecture:** Add a database-independent Python calculator that accepts validated aggregate evidence and returns the complete API shape. Both persistence implementations gather owner-filtered evidence and call that calculator; the Mini Program treats the returned profile as required data and only formats it for display. No schema migration or new endpoint is required.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2, MySQL 8, pytest, WeChat Mini Program TypeScript/WXML/WXSS, Node test runner.

---

## File map

- Create `backend/app/services/player_skill.py`: constants, evidence dataclass, validation, metric calculation, overall level mapping.
- Create `backend/tests/test_player_skill.py`: pure formula, sample threshold, validation, and rounding tests.
- Modify `backend/app/services/game_store.py`: collect in-memory owner evidence from AI human-side reviews and training records.
- Modify `backend/app/db/repositories/mysql_store.py`: collect equivalent evidence with bounded aggregate SQL queries.
- Modify `backend/tests/test_accounts.py`: assert the API returns a real empty profile and isolates owner data.
- Modify `backend/tests/test_mysql_persistence.py`: assert MySQL evidence selection excludes wrong owner, mode, side, and review version.
- Modify `miniprogram/services/account-api.ts`: define the required skill profile response contract.
- Modify `miniprogram/pages/profile/profile.ts`: map API metrics to view data and reject stale requests.
- Modify `miniprogram/pages/profile/profile.wxml`: render level, six scores, sample progress, and disclaimer.
- Modify `miniprogram/pages/profile/profile.wxss`: style metric progress and remove obsolete demo styles.
- Modify `tests/profile-page.test.mts`: cover populated, insufficient, failure, and stale-response states.
- Modify `README.md`: document the real calculation scope and “内部能力参考” limitation.

### Task 1: Pure versioned skill calculator

**Files:**
- Create: `backend/tests/test_player_skill.py`
- Create: `backend/app/services/player_skill.py`

- [ ] **Step 1: Write failing calculator tests**

Define `SkillEvidence` fixtures and assert:

```python
from backend.app.services.player_skill import SkillEvidence, calculate_skill_profile


def complete_evidence(**changes):
    values = dict(
        wins=4, losses=2, training_attempts=10, training_correct=8,
        reviewed_games=3, reviewed_moves=20, good_moves=8, normal_moves=6,
        mistakes=4, blunders=2, best_equivalent_moves=5,
        score_loss_sum=500.0,
    )
    values.update(changes)
    return SkillEvidence(**values)


def test_calculates_six_metrics_and_level():
    result = calculate_skill_profile(complete_evidence())
    assert result["version"] == "player_skill_v1"
    assert [metric["key"] for metric in result["metrics"]] == [
        "performance", "bestMoveRate", "decisionQuality",
        "stability", "mistakeControl", "trainingMastery",
    ]
    assert [metric["value"] for metric in result["metrics"]] == [67, 25, 88, 70, 80, 80]
    assert result["ready"] is True
    assert result["overall"] == 68
    assert result["level"] == "熟练"
    assert result["seal"] == "熟"


def test_each_metric_keeps_its_own_sample_gate():
    result = calculate_skill_profile(complete_evidence(
        wins=4, losses=0, training_attempts=4, training_correct=4,
        reviewed_games=2, reviewed_moves=20,
    ))
    assert result["metrics"][0]["value"] is None
    assert all(metric["value"] is None for metric in result["metrics"][1:5])
    assert result["metrics"][5]["value"] is None
    assert result["ready"] is False
    assert result["overall"] is None
    assert result["level"] == "待评估"
    assert result["seal"] == "待"


def test_uses_half_up_rounding_and_clamps_scores():
    result = calculate_skill_profile(complete_evidence(
        wins=1, losses=7, reviewed_moves=40, good_moves=0, normal_moves=0,
        mistakes=0, blunders=40, best_equivalent_moves=1,
        score_loss_sum=12_000.0,
    ))
    assert result["metrics"][0]["value"] == 13
    assert result["metrics"][1]["value"] == 3
    assert result["metrics"][2]["value"] == 0
    assert result["metrics"][4]["value"] == 0


def test_rejects_inconsistent_or_negative_evidence():
    with pytest.raises(ValueError):
        calculate_skill_profile(complete_evidence(training_correct=11))
    with pytest.raises(ValueError):
        calculate_skill_profile(complete_evidence(score_loss_sum=-1))
    with pytest.raises(ValueError):
        calculate_skill_profile(complete_evidence(good_moves=99))
```

Also assert each metric returns `sampleCount`, `minimumSample`, `sampleUnit`, complete `sampleDetails`, and the evidence summary.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
.\backend\.venv\Scripts\python.exe -m pytest backend/tests/test_player_skill.py -q
```

Expected: collection fails because `backend.app.services.player_skill` does not exist.

- [ ] **Step 3: Implement the minimal pure calculator**

Create a frozen `SkillEvidence` dataclass, constants `PLAYER_SKILL_VERSION = "player_skill_v1"` and `SKILL_REVIEW_CONFIG_VERSION = 1`, and `calculate_skill_profile(evidence)`. Use `floor(value + 0.5)` for nonnegative half-up rounding, clamp to 0–100, apply the approved sample gates, and return all six metrics in the fixed order. Validate nonnegative finite inputs, `training_correct <= training_attempts`, `best_equivalent_moves <= reviewed_moves`, and category total equality with `reviewed_moves`.

Use these level boundaries:

```python
LEVELS = ((90, "卓越", "卓"), (75, "精通", "精"),
          (60, "熟练", "熟"), (40, "进阶", "进"),
          (0, "入门", "入"))
```

Return the approved disclaimer verbatim and build review `sampleDetails` with both `3 局` and `15 手` requirements.

- [ ] **Step 4: Run the calculator tests and verify GREEN**

Run the Task 1 pytest command. Expected: all calculator tests pass.

- [ ] **Step 5: Commit Task 1 files only**

```powershell
git add -- backend/app/services/player_skill.py backend/tests/test_player_skill.py
git commit -m "feat: add versioned player skill calculator" -- backend/app/services/player_skill.py backend/tests/test_player_skill.py
```

### Task 2: In-memory profile evidence and API behavior

**Files:**
- Modify: `backend/tests/test_accounts.py`
- Modify: `backend/app/services/game_store.py`

- [ ] **Step 1: Write failing account profile tests**

Extend the empty-account assertion to require:

```python
profile = client.get("/api/v1/me/profile").json()["data"]
assert profile["skillProfile"]["evidence"] == {
    "aiFinished": 0, "reviewedGames": 0,
    "reviewedMoves": 0, "trainingAttempts": 0,
}
assert profile["skillProfile"]["level"] == "待评估"
assert all(metric["value"] is None for metric in profile["skillProfile"]["metrics"])
```

Add an in-memory store integration test that prepares current-user and other-user games/reviews directly with existing `StoredGame` and `GameReview` schemas. Include one owned finished AI game reviewed from the human side, plus an owned LOCAL review, an AI-side review, an old-version review, and another account's review. Assert only the first contributes to `skillProfile.evidence`; top-level `reviewedGames` keeps its existing all-owned-review meaning.

- [ ] **Step 2: Run account tests and verify RED**

Run:

```powershell
.\backend\.venv\Scripts\python.exe -m pytest backend/tests/test_accounts.py -q
```

Expected: assertions fail because `skillProfile` is absent.

- [ ] **Step 3: Aggregate in-memory evidence**

Import `SkillEvidence`, `SKILL_REVIEW_CONFIG_VERSION`, and `calculate_skill_profile`. In `personal_profile`, select reviews only when the referenced game:

```python
game.user_id == user_id
and game.mode == "AI"
and game.state.game_status == "FINISHED"
and review.reviewedPlayer == ("B" if game.ai_player == "A" else "A")
and review.reviewConfigVersion == SKILL_REVIEW_CONFIG_VERSION
and review.moveReviews
```

Aggregate move categories, `bestMoveEquivalent`, and `scoreLoss`, then append `"skillProfile": calculate_skill_profile(evidence)` to the existing response.

- [ ] **Step 4: Run account and calculator tests**

Run both Task 1 and Task 2 test files. Expected: all pass.

- [ ] **Step 5: Commit Task 2 files only**

```powershell
git add -- backend/app/services/game_store.py backend/tests/test_accounts.py
git commit -m "feat: calculate skill profile from account evidence" -- backend/app/services/game_store.py backend/tests/test_accounts.py
```

### Task 3: MySQL evidence parity

**Files:**
- Modify: `backend/tests/test_mysql_persistence.py`
- Modify: `backend/app/db/repositories/mysql_store.py`

- [ ] **Step 1: Write a failing isolated MySQL test**

Using the existing `WUMA_TEST_DATABASE_URL` fixture, create owned and foreign finished AI games and persist review rows for the human side plus excluded LOCAL, wrong-side, and old-version rows. Assert the API evidence matches only the valid rows and the pure calculator result. Keep this test under the existing skip guard so it cannot touch a non-`*_test` database.

At minimum verify:

```python
profile = client.get("/api/v1/me/profile").json()["data"]
assert profile["skillProfile"]["evidence"] == {
    "aiFinished": 5,
    "reviewedGames": 3,
    "reviewedMoves": 15,
    "trainingAttempts": 5,
}
assert profile["skillProfile"] == calculate_skill_profile(expected_evidence)
```

- [ ] **Step 2: Run the MySQL test and verify RED or safe skip**

Run:

```powershell
.\backend\.venv\Scripts\python.exe -m pytest backend/tests/test_mysql_persistence.py -q
```

Expected with `WUMA_TEST_DATABASE_URL`: new assertion fails because MySQL lacks `skillProfile`. Without the variable: test module reports skipped; the test is retained for the isolated database gate.

- [ ] **Step 3: Implement bounded SQL aggregation**

Import SQLAlchemy `case` plus the player-skill calculator. Replace Python-side AI result loading with aggregate expressions and add one review aggregation query joining `games -> game_reviews -> move_reviews`. Apply owner, `AI`, `FINISHED`, opposite-human-side, and review-version predicates. Aggregate:

```python
count(distinct(GameReviewModel.game_id)), count(MoveReviewModel.id),
sum(case(category == "GOOD")), sum(case(category == "NORMAL")),
sum(case(category == "MISTAKE")), sum(case(category == "BLUNDER")),
sum(case(score_loss == 0)), sum(score_loss)
```

Combine the training count/correct count in one aggregate query and pass normalized Python `int`/`float` values to `SkillEvidence`. Preserve existing top-level fields.

- [ ] **Step 4: Run backend tests**

Run:

```powershell
.\backend\.venv\Scripts\python.exe -m pytest backend/tests/test_player_skill.py backend/tests/test_accounts.py -q
.\backend\.venv\Scripts\python.exe -m pytest backend/tests -q
```

Expected: all available tests pass; MySQL-only tests are either passing against the isolated database or explicitly skipped.

- [ ] **Step 5: Commit Task 3 files only**

```powershell
git add -- backend/app/db/repositories/mysql_store.py backend/tests/test_mysql_persistence.py
git commit -m "feat: aggregate player skill in mysql profiles" -- backend/app/db/repositories/mysql_store.py backend/tests/test_mysql_persistence.py
```

### Task 4: Required Mini Program contract and real profile rendering

**Files:**
- Modify: `tests/profile-page.test.mts`
- Modify: `miniprogram/services/account-api.ts`
- Modify: `miniprogram/pages/profile/profile.ts`
- Modify: `miniprogram/pages/profile/profile.wxml`
- Modify: `miniprogram/pages/profile/profile.wxss`

- [ ] **Step 1: Write failing page tests**

Update the mocked profile with all six metrics. Assert `seal`, `level`, `overallText`, metric value text, sample text, and bar widths come from the response. Add a partial profile where review metrics are null and assert “数据不足” with `2/3 局 · 11/15 手`.

Add a stale-response test using two pending `wx.request` callbacks:

```typescript
const first = page.load();
const second = page.load();
respondSecond(successProfile('新账号'));
await second;
respondFirst(successProfile('旧账号'));
await first;
assert.equal(page.data.name, '新账号');
```

Add an error-after-success case and assert old metrics are not retained in the error state. Inspect WXML and assert the fixed `<view class="level-seal">初</view>` and fixed `能力分析：数据不足` text are absent.

- [ ] **Step 2: Run the page test and verify RED**

Run:

```powershell
node --test tests/profile-page.test.mts
```

Expected: new view-model assertions fail because the page has no skill profile fields.

- [ ] **Step 3: Add strict API types and view mapping**

In `account-api.ts`, define required `SkillSampleDetailDto`, `SkillMetricDto`, `SkillEvidenceDto`, and `SkillProfileDto`, then add `readonly skillProfile: SkillProfileDto` to `PersonalProfileDto`.

In `profile.ts`, add typed view metrics:

```typescript
{
  ...metric,
  valueText: metric.value === null ? '数据不足' : `${metric.value}分`,
  barWidth: `${metric.value ?? 0}%`,
  sampleText: metric.sampleDetails
    .map(item => `${item.count}/${item.minimum} ${item.unit}`).join(' · '),
}
```

Use a module-level monotonically increasing load generation. Increment it before each request and check it before every success or error `setData`. Reset displayed profile fields when the latest load starts or fails.

- [ ] **Step 4: Render the six metrics**

Replace the fixed seal with `{{seal}}`, show `{{level}}` and `{{overallText}}`, render metrics with `wx:for`, set progress width from the preformatted `barWidth`, display sample progress, and show the disclaimer. Remove `.demo-switch`, `.switch`, `.demo-warning`, and their unused markup assumptions; add focused classes for level summary and metric progress.

- [ ] **Step 5: Run frontend verification**

Run:

```powershell
node --test tests/profile-page.test.mts
npm run typecheck
npm run check
npm test
```

Expected: profile tests, TypeScript, repository checks, and the full Node suite pass.

- [ ] **Step 6: Commit Task 4 files only**

```powershell
git add -- miniprogram/services/account-api.ts miniprogram/pages/profile/profile.ts miniprogram/pages/profile/profile.wxml miniprogram/pages/profile/profile.wxss tests/profile-page.test.mts
git commit -m "feat: render real player skill profile" -- miniprogram/services/account-api.ts miniprogram/pages/profile/profile.ts miniprogram/pages/profile/profile.wxml miniprogram/pages/profile/profile.wxss tests/profile-page.test.mts
```

### Task 5: Documentation and final acceptance

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-09-28-player-skill-profile.md`

- [ ] **Step 1: Update product documentation**

Change the feature table entry to state that “我的棋力” computes six versioned internal-reference metrics from owned AI results, human-side reviews, and training records. Document that LOCAL games are excluded because the account cannot be attributed to one local side, each metric has an independent minimum sample, and the overall level remains “待评估” until all six qualify.

- [ ] **Step 2: Run fresh full verification**

Run:

```powershell
.\backend\.venv\Scripts\python.exe -m pytest backend/tests -q
npm run typecheck
npm run check
npm test
git diff --check HEAD
git status --short
```

If an isolated test database and WeChat automation endpoint are configured, also run the MySQL integration suite and manually verify the new-account empty profile plus refreshed real-account profile in Developer Tools. If those external facilities are absent, record them as unverified rather than claiming they passed.

- [ ] **Step 3: Review against the design acceptance list**

Confirm every item in `docs/superpowers/specs/2026-09-28-player-skill-profile-design.md` has code or test evidence: real inputs, versioned formulas, per-metric gates, storage parity, local-game exclusion, dynamic seal, stale-load protection, and no demo score.

- [ ] **Step 4: Commit documentation and plan progress only**

```powershell
git add -- README.md docs/superpowers/plans/2026-09-28-player-skill-profile.md
git commit -m "docs: document real player skill profile" -- README.md docs/superpowers/plans/2026-09-28-player-skill-profile.md
```

- [ ] **Step 5: Complete the branch workflow**

Use `superpowers:finishing-a-development-branch`, present verified integration options, and do not merge or push without the user's choice.
