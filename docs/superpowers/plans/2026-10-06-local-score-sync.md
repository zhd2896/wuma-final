# Phase 5 implementation plan

Approved scope: preserve complete new local scores and explicitly import them into an authenticated owner's ordinary LOCAL game. Existing legacy snapshots remain playable but cannot be imported.

1. Test first: local session score creation, move/undo branching, resignation, persistence copies and legacy compatibility. Add version 1 score metadata without changing the history envelope version.
2. Test first: strict import DTO (client ID 8–64 ASCII letters/digits/underscore/hyphen, at most 2048 moves, exact move fields), canonical engine replay, idempotency and terminal version/ply semantics. Implement an atomic store operation in both adapters.
3. Test first: case sensitive import keys, concurrent imports, rollback, migration and account merging/retirement. Add migration 0017 and owner lock ordering shared with merge. Use SHA-256 of the exact client ID as the MySQL unique key; retain original ID and canonical payload digest.
4. Test first: durable pending payload with initiating account and normalized API root, retry with original body and fresh same-owner token, no token persisted, mutation freeze on every page action, storage failure recovery. Resolve identity through the strict profile API using one captured client/token context.
5. Test first: history catchtap sync, linked routes, cloud authority/deduplication, stale account/filter/lifecycle response rejection. Preserve existing local snapshots, online history and cloud controllers.
6. Self review against the approved scope, focus verification, independent SPEC then QUALITY review by parent, fix feedback with regression tests. Final front/back suites and fresh empty MySQL migration database once stable; retain logs under results/staged-phase5-*. No deployment, secrets, push or commits.

External verification remains the real WeChat DevTools/device and deployed service, which are unavailable here.

Implementation status: steps 1–5 completed with observed red/green tests. Self review completed. Independent SPEC and the safe-new-ID/conflict follow-up passed. Full frontend 496 and full backend 297 passed with no failures/skips; TypeScript and structural checks passed. Logs and complete acceptance evidence are in results/staged-phase5-acceptance.md. Independent QUALITY passed (parent-coordinated, independent backend 15 / frontend 38). Phase 5 implementation and required local verification are complete. No commit/deployment was made by this agent.
