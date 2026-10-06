# Phase 5 acceptance evidence

Baseline: 9f7775a, branch codex/staged-completion. No commit, push, deployment, secret inspection, business database writes or dependency installation performed by the implementation agent.

## Implemented behavior

- New local games record version 1 first-player/moves/resigning-player metadata from initialization. Real Page/store tests cover two moves, one-frame undo, a new branch, reopening, defensive copies and independent terminal events.
- Legacy snapshot-only saves retain continuation, terminal display and their existing undo frame; later moves do not invent the missing prefix and explicit sync reports the missing score.
- POST /api/v1/game/import-local accepts only a strict body: clientGameId (8–64 ASCII letters/digits/underscore/hyphen), firstPlayer, exact from/to moves (at most 2048), nullable resigningPlayer. State, winner, score and owner are never accepted.
- Canonical Engine replay rejects illegal turns, invalid nodes, moves after natural end, wrong-actor resignation and terminal resignation. Natural-end version equals plies; resignation adds one terminal revision without an extra ply. Imported LOCAL games use the existing authenticated continuation, review and training APIs.
- Exact client IDs remain case sensitive in both stores. The SQL owner/client key is SHA-256 of the exact ID, preserving the database's normal FK collations. Request digest conflicts are checked before replay and again in the final atomic transaction.
- In-memory construction publishes only after copying all objects. SQL game/moves/terminal/key use one transaction. Focus tests inject a mid-import move persistence failure and confirm no partial rows. Concurrent retries return the same game.
- Merge migrates ownership and import keys under ordered user locks. Same client IDs that point to different games produce LOCAL_IMPORT_ACCOUNT_CONFLICT and leave both accounts intact. A real MySQL test pauses an authenticated import across a merge and verifies AUTH_INVALID at persistence with no residual rows.
- Explicit history sync captures one account token/root for strict profile lookup and import, then durably writes exact pending payload with owner ID/API root before POST. Tokens never enter history. App reopening, new same-owner tokens, account/root switching, pending/link storage failures and delayed identity switching are tested. Frozen records cannot move/undo/resign; a restart safely creates a different ID and leaves the original record intact even with repeated time/random values.
- Linked records route to the authenticated ordinary cloud LOCAL controller or review by cloud ID. The cloud row overrides linked local metadata, and sync uses catchtap with disabled syncing UI. Account/filter/lifecycle generations reject stale cloud results; hide/show during a pending sync clears the busy projection correctly.
- Migration 0017 follows 0016, inherits users.id/games.id FK collations, and refuses downgrade when import keys exist.

## Commands and results

Red/green cycles were observed in the actual tool console for score metadata missing, missing import route (405), pending metadata operations missing, Page score persistence missing, syncing label mismatch, hide/show busy projection stuck, restart refusing a safe new ID, and an existing key returning NOT_PLAYER_TURN instead of LOCAL_IMPORT_CONFLICT.

Focus: backend/tests/test_local_import.py plus test_mysql_persistence.py -k import: 20 passed (15 memory/API, 5 real MySQL), 34 deselected, no skips. Node new phase tests before the final cloud-setup regression: 12 passed, no skips. Fresh migration focus: 11 passed, no skips in staged_phase5_20261006_focus_01_test.

Initial final frontend: npm test = 495 passed, 0 failed, 0 skipped. npm run typecheck and npm run check = exit 0; check validates 11 registered pages and 18 components. Logs: staged-phase5-frontend-full.log, staged-phase5-typecheck.log, staged-phase5-check.log.

Final backend: 297 passed, 0 failed, 0 skipped in 211.35 seconds, with 12 existing deprecation warnings. The features URL is mysql+pymysql://root@127.0.0.1:34365/staged_features_test?charset=utf8mb4. The fresh full migration URL is mysql+pymysql://root@127.0.0.1:34365/staged_phase5_20261006_full_01_test?charset=utf8mb4. Preparation verified server UUID 79904ab3-c0d6-11f1-b2bb-088fc3774c8f and port 34365 against results/staged-mysql-20261006/auto.cnf, and confirmed the new database empty. No databases were dropped. Logs: staged-phase5-mysql-prepare-full.log and staged-phase5-backend-full.log.

Existing Node module-type and Python/Alembic deprecation warnings remain; no dependencies were changed for them.

## External verification

Real WeChat DevTools/device testing and deployed two-device sync remain unperformed because this project has not been deployed. Migration 0017 must be applied to the eventual deployed service before using sync. Pending outcomes intentionally retain the original frozen score until authenticated same-owner/same-root retry confirms the result.

Final frontend after the red-tested cloud setup regression fix: npm test = 496 passed, 0 failed, 0 skipped (33.99 seconds). npm run typecheck and npm run check both exit 0. Final logs: staged-phase5-frontend-final.log, staged-phase5-typecheck-final.log, staged-phase5-check-final.log. This rerun was necessary because the new root/token capture originally occurred outside the cloud loader's try/catch; the regression now resolves setup failures with a notice while keeping device rows usable. Backend code was unchanged after its successful full run, so it was not rerun.

Exact full verification commands (PowerShell):

```powershell
npm test
npm run typecheck
npm run check
& backend/.venv/Scripts/python.exe results/staged-phase5-mysql-prepare.py staged_phase5_20261006_full_01_test
$env:WUMA_TEST_DATABASE_URL='mysql+pymysql://root@127.0.0.1:34365/staged_features_test?charset=utf8mb4'
$env:WUMA_TEST_MIGRATION_DATABASE_URL='mysql+pymysql://root@127.0.0.1:34365/staged_phase5_20261006_full_01_test?charset=utf8mb4'
& backend/.venv/Scripts/python.exe -m pytest backend/tests
git diff --check
```

Current new phase tests: 13 Node tests (five score/store/service plus eight actual Page tests); 20 backend import tests (15 HTTP/in-memory plus five real MySQL cases), all included in final suites. The full backend collected and passed 297 cases without skips. Independent SPEC review and the follow-up safe-new-ID/conflict review passed; independent QUALITY passed (parent-coordinated, independent backend 15 / frontend 38), including the setup-catch regression.
