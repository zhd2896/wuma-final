# Remote participant accounts implementation plan

> **For agentic workers:** Execute inline with executing-plans and test-driven-development. The parent owns commits and phase review; no delegated agents or additional approval gate.

**Goal:** Bind remote seats to authenticated accounts and provide isolated cloud history, statistics, and cross-device recovery.

**Architecture:** Nullable participant foreign keys preserve existing rooms. Tokens remain seat capabilities, checked against the authenticated account for bound seats. Recovery and legacy claim update seats under a transaction and active-owner lock. Personal reads join participants and use the existing stable cursor.

**Tech Stack:** FastAPI, SQLAlchemy/MySQL, Alembic, TypeScript WeChat mini program, pytest and node:test.

### Task 1: Authenticated room ownership and recovery

Files: `backend/tests/test_remote_accounts.py`, `backend/app/api/v1/remote.py`, `backend/app/services/remote_service.py`, `backend/app/services/game_store.py`, `backend/app/db/repositories/remote.py`, `backend/app/db/repositories/mysql_store.py`, `backend/app/db/models.py`, `backend/alembic/versions/0015_remote_participants.py`.

- [x] Add API tests using independent account headers for host, guest, stranger. Assert missing authentication returns 401, same-account join returns REMOTE_SELF_JOIN, and all token routes reject other accounts.
- [x] Run `backend/.venv/Scripts/python.exe -m pytest backend/tests/test_remote_accounts.py -q`; expect missing auth and recovery failures.
- [x] Add `host_user_id` / `guest_user_id` defaults to StoredRemoteRoom and nullable indexed user foreign keys to model/migration after `0014_merge_auth_operations`.
- [x] Pass `user_id` from `require_account` to room service methods. Check token-selected bound seat belongs to this account. Keep `None` compatibility for explicit unauthenticated fixtures.
- [x] Add atomic `recover_remote_room(game_id, user_id, new_token_hash, claim_token_hash=None)`. Recovery requires an existing bound participant; claim verifies original token and unbound or already-self seat and rejects opposite-seat identity collisions. Rotate only the selected seat token.
- [x] Update MySQL and memory create/join/match with participant binding and retired-owner rejection. Match skips own accounts, including distinct device IDs.
- [x] Run focused API tests and existing remote engine tests.

### Task 2: Account merge and cloud personal reads

Files: same stores plus `backend/tests/test_mysql_persistence.py`.

- [x] Add failing merge tests that migrate both host/guest references, reject merge when source and target occupy opposite seats, and prevent retired source creating/claiming new rooms.
- [x] Lock participant rows before merge, reject identity collision before any ownership changes, and preserve both distinct account seats.
- [x] Add personal history tests for both accounts and stranger, mixed mode cursor pagination, seat-specific review availability, and remote win/loss counts while AI results stay unchanged.
- [x] Change queries to ordinary owned games OR bound remote participant; return own `seat`, aggregate remoteGames/remoteWins/remoteLosses and include remote in total/finished/review counts.
- [x] Apply migration only to isolated `staged_features_test`, run persistence tests, restart store, verify participant recovery survives.

### Task 3: Client recovery, routing, profile

Files: `miniprogram/services/online-api.ts`, `miniprogram/services/online-credentials.ts`, `miniprogram/pages/online/online-game.ts`, `miniprogram/pages/review/review.ts`, `miniprogram/services/account-api.ts`, history/profile pages and corresponding `tests/*.test.mts`.

- [x] Add failing tests that a cloud REMOTE row routes online, empty-token entry calls account recovery and persists the returned credential, and finished review can recover without a token.
- [x] Add recover/claim endpoints to OnlineApi and shared credential recovery helper. Existing valid token path explicitly claims legacy seats; missing or invalid old token recovers only by current account.
- [x] Extend personal DTO mode and seat and explicit remote profile fields; display separate remote wins/losses.
- [x] Run `npm test`, `npm run typecheck`, `npm run check` and backend full pytest using isolated MySQL. Inspect final diff for account security, no future phase changes, and no credentials.

### Verification and limitations

- [x] Verify unique Alembic head and fresh empty stage2 migration test schema; existing rows remain unbound after upgrade.
- [x] Record exact test results and remaining two-device WeChat acceptance limitations for parent review.

## Final verification

Backend full run: 226 passed, no skips, real isolated persistence and fresh migration databases. Frontend final full run independently verified by parent: 472 passed, no skips (`results/staged-phase2-final-frontend.log`); affected controller/recovery/operations/pages after the retry fix: 48 passed. Typecheck, mini-program structural checks, diff whitespace, unique/current migration head all passed. Review credential retirement/rotation and cached response checks passed independent specification review. Real two-device WeChat acceptance remains as recorded in `docs/remote-account-acceptance.md`. No commits or deployment were performed by this stage worker.
