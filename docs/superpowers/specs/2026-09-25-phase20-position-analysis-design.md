# PHASE 20 Position Analysis Design

## Scope

Add a pure TypeScript `analyzePosition(state, options)` orchestrator, a game-id based FastAPI endpoint, versioned MySQL analysis records, and a small manual analysis panel in the existing AI game page. Keep game actions, chess rules, and search algorithms unchanged.

## Canonical analysis

`analyzedPlayer` is `state.current_player`. `evaluationBefore` is `evaluatePosition(state, analyzedPlayer)` and `evaluationBreakdown` is the same object's `breakdown`. Nonterminal positions use the existing `IterativeDeepeningAI.search(state, analyzedPlayer)` with ordering and TT. Search supplies `bestMove`, score, exact root candidate scores, and all metrics. Rank candidates by descending score with stable original search order for ties, then apply `candidateLimit` only to the returned list. Terminal positions use Evaluation, skip search, and return no move or candidates.

Threats are deterministic structured evidence from existing one-ply `orderMoves` classifications and Evaluation features: immediate win, capture available, capture threat, vulnerability, and lone-piece mobility risk when supported by actual values. They contain no natural-language chess assessment and never use board UI coordinates.

## API and persistence

`POST /api/v1/ai/analyze` accepts only `{game_id}`. Server settings control depth, time, and candidate limit. The service loads a snapshot with its version, releases the read transaction, calls the Node worker's analysis command, then calls `commit_analysis`. MySQL checks `games.version` with a short row-locked transaction and inserts a separate `ai_analysis` record. A changed version returns `GAME_STATE_CONFLICT` without inserting. The operation does not execute a move, update `games`, or write `game_moves`. In-memory store provides equivalent behavior for isolated API tests.

## WeChat page

The existing game page uses a manual analysis button in AI mode. Its controller tracks `isAnalyzing`, the result, and error state. It rejects overlapping analysis or moves, discards a late result after game state changes or unload, and clears the displayed result after a move or restart. A compact panel displays real best move, score, depth, elapsed time, top candidates, weighted Evaluation contributions, and fixed labels for supported threat types. Candidate rows do not execute a move.

## Verification

Test exact candidate ordering and full-search invariance, both perspectives, static Evaluation, terminal and timeout behavior, state immutability, structured threats, API validation and version conflict, MySQL persistence without board or move changes, and real WeChat simulator analysis followed by continued play.
