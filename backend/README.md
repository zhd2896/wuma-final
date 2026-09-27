# FastAPI + MySQL

`miniprogram/domain` and `miniprogram/ai` remain the only rule and AI implementation. FastAPI calls the existing Node worker, then persists its canonical `GameState` and `TurnResult` through SQLAlchemy 2. The API contract from Phase 16 is unchanged.

## Setup

Use Python 3.12+, Node 24+, and MySQL 8. Set `DATABASE_URL` or the `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` variables described in `.env.example`. Do not point tests at a production database. The optional `docker-compose.mysql.yml` starts only a development database; supply `DB_PASSWORD` and `DB_ROOT_PASSWORD` through your environment.

From the repository root:

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python -m pip install -r backend/requirements.txt
cd backend
.venv/Scripts/python -m alembic upgrade head
cd ..
backend/.venv/Scripts/python -m uvicorn backend.app.main:app
```

Run `backend/.venv/Scripts/python -m pytest backend/tests -q`. For real MySQL integration tests, first apply the migration to an isolated test database and set `WUMA_TEST_DATABASE_URL` to its URL. Those tests are skipped when this variable is absent; they never use the app's default database implicitly.

## Persistence

`games.initial_state` and `games.current_state` hold full canonical JSON snapshots. `game_moves` stores every full turn, its before and after states, capture details, reserve counts, and actual AI search output when applicable. The service reads a state and version, calls the TypeScript engine, then the repository commits a version checked game update and move insert in one short transaction. An older version returns `GAME_STATE_CONFLICT`. The service's `replay_game(game_id)` reads ordered saved snapshots, validates continuity and the final snapshot, and does not run old moves through today's rules.

The `users` table is ready for later authentication; `games.user_id` is nullable for current guest games. `ai_analysis` stores a versioned current-position analysis. Migration `0005_game_reviews` adds `game_reviews` and `move_reviews` for finished-game review. Migration `0006_review_explanations` adds separate versioned explanations. Training and rating tables remain deferred.

## Finished-game review

`POST /api/v1/game/{game_id}/review` creates or reuses a review; `GET` reads it. Local API games can specify `reviewed_player=A|B`. AI games always review their human player. Only `FINISHED` games are accepted. The service reads each saved `game_moves.state_before`, `state_after`, and actual move from the database. The Node worker validates snapshot consistency and uses the existing position analysis search for every legal root move. Thus the actual move receives an exact score even when it is outside the three returned candidates. The review is saved in one transaction and is unique by `(game_id, reviewed_player, review_config_version)`.

ReviewConfig version 1 uses depth 2, 1000 ms per move, and three displayed candidates. A move with no fully completed search depth fails the review. All scores use the reviewed move player's perspective. `scoreBefore` and `scoreAfter` are static evaluations; `bestScore` and `actualMoveScore` come from the same completed root search; `scoreLoss = bestScore - actualMoveScore`. The classification cutoffs are 0, 30, and 100 score units for GOOD, NORMAL, MISTAKE, and BLUNDER. These are **heuristic thresholds**, not benchmark calibrated. `bestMoveRate` is the fraction of reviewed moves tied with the best search score. `turningPoints` are up to three MISTAKE or BLUNDER turns ordered by descending score loss, with turn number breaking ties. `overallScore` is null because no calibrated score formula exists. Engine explanations use fixed evidence-based templates; no LLM or win probability is used during Review generation.

## Finished-game explanation

Generate a Review first. `POST /api/v1/game/{game_id}/review/explain` reads that Review, generates or reuses an explanation, and returns both the unchanged Review and its explanation. `GET` on the same path reads the saved result without calling a provider. The key `(game_review_id, prompt_version)` is unique. Explanation rows never update `games`, `game_moves`, `game_reviews`, or `move_reviews`.

`ReviewPromptBuilder` passes bounded Review facts to an injected `LLMProvider`; it does not pass full historical board states or expose engine tools. The configured provider uses an OpenAI-compatible chat completions endpoint. Set `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL` **only on the backend**; optional settings are `LLM_PROVIDER`, `LLM_TIMEOUT_SECONDS`, `LLM_TOTAL_TIMEOUT_SECONDS`, and `LLM_TEMPERATURE` (see `.env.example`). At most the three saved turning points use model-generated move text, and all provider calls share a total 30-second default budget. No configured provider, timeout, malformed JSON, invalid schema, or unsupported claim produces a deterministic explanation with `fallbackUsed=true`. Numeric scores and move/category labels continue to come from the structured Review and UI.

For real MySQL tests, migrate an isolated `*_test` database to head and set `WUMA_TEST_DATABASE_URL`. For the no-key WeChat E2E, start FastAPI against that database with no `LLM_API_KEY`, open this project in WeChat Developer Tools with automation enabled, set `WUMA_WECHAT_AUTO_ENDPOINT` to its WebSocket URL, and run `npm run test:e2e:llm-review`. The script creates a real finished game through the existing API, generates its Review, opens the WeChat review page, checks fallback text and MySQL rows, then reloads the page to verify reuse. No external LLM account is required.

One Node worker still serializes engine calls, and the bridge remains temporary. MySQL version checks protect concurrent requests across API processes; conflicting stale requests receive `GAME_STATE_CONFLICT`.
