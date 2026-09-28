# Independent Position Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the independent analysis demo with version-safe analysis of real local and server game states while sharing one presentation mapping with the AI game page.

**Architecture:** A pure `analysis-view-model` module maps a canonical `GameState` plus `PositionAnalysis` into all three tab models. An `IndependentAnalysisController` selects a local device snapshot or a server snapshot, enforces server version consistency, and publishes explicit page states. The page only renders controller output; the game page passes source context and reuses the pure mapper for its existing AI analysis panel.

**Tech Stack:** WeChat Mini Program TypeScript/WXML/WXSS, existing canonical rule engine and `analyzePosition`, existing `GameApi`, Node test runner.

---

### Task 1: Shared real analysis view model

**Files:**
- Create: `miniprogram/pages/analysis/analysis-view-model.ts`
- Create: `tests/analysis-view-model.test.mts`

- [ ] **Step 1: Write the failing mapping tests**

Create tests that analyze a real canonical state and assert the mapped board, perspective, seven nonterminal score rows, threats, occupied key pieces, and ranked candidates:

```ts
const state = createInitialGameState();
const result = analyzePosition(state, { maxDepth: 1, timeLimitMs: 1000, now: () => 0 });
const view = mapPositionAnalysis(state, result);
assert.equal(view.board.pieces.length, 10);
assert.equal(view.perspective, state.current_player);
assert.deepEqual(view.breakdown.map(row => row.key), [
  'material', 'reserve', 'mobility', 'templeControl',
  'captureOpportunity', 'vulnerability', 'trapRisk',
]);
assert.deepEqual(view.candidates.map(row => row.score),
  result.candidateMoves.map(row => row.score));
assert.ok(view.keyPieces.every(row => state.board.occupancy[row.nodeId] !== null));
```

Add a terminal-state test asserting `bestMove === null`, an empty candidate list, and no invented recommendation.

- [ ] **Step 2: Run the mapping test and verify RED**

Run: `node --test tests/analysis-view-model.test.mts`

Expected: FAIL because `analysis-view-model.ts` does not exist.

- [ ] **Step 3: Implement the pure mapper**

Define `AnalysisViewModel`, `AnalysisBreakdownRow`, `AnalysisThreatRow`, `AnalysisKeyPiece`, and `AnalysisCandidateRow`. Export:

```ts
export function mapPositionAnalysis(
  state: GameState,
  analysis: PositionAnalysis,
): AnalysisViewModel
```

Use `mapGameStateToView(state, { selectedNode: null, legalTargets: [], lastMove: analysis.bestMove })` for the board. Map the seven named evaluation fields to Chinese labels and `weightedScore`. Map threats through one exported `threatLabels` table. Build key-piece candidates in this order: occupied `relatedNodes`, occupied `relatedMove.from`, then occupied candidate `move.from`; deduplicate by node ID. Candidate details contain only rank, score, and best-move status derived from the engine result.

- [ ] **Step 4: Run the mapping test and verify GREEN**

Run: `node --test tests/analysis-view-model.test.mts`

Expected: all mapping tests PASS.

### Task 2: Source-aware independent analysis controller

**Files:**
- Create: `miniprogram/pages/analysis/analysis-controller.ts`
- Create: `tests/analysis-controller.test.mts`

- [ ] **Step 1: Write failing local-source tests**

Use a real `DeviceHistoryEntry.localState` and inject an analyzer spy. Assert that `enter({ mode: 'local', gameId: 'local-1' })` never calls `GameApi`, publishes loading then success, and returns a view mapped from the stored state. Add no-ID fallback through an injected `readActiveLocalId` and an empty-state case when no valid local record exists.

- [ ] **Step 2: Run controller tests and verify local RED**

Run: `node --test tests/analysis-controller.test.mts`

Expected: FAIL because the controller does not exist.

- [ ] **Step 3: Implement local analysis**

Define:

```ts
export type AnalysisSource = { mode: 'local'; gameId?: string } |
  { mode: 'remote'; gameId?: string };

export interface IndependentAnalysisSnapshot {
  readonly state: 'idle' | 'loading' | 'success' | 'empty' | 'error' | 'conflict';
  readonly source: AnalysisSource;
  readonly gameId: string | null;
  readonly gameVersion: number | null;
  readonly view: AnalysisViewModel | null;
  readonly errorMessage: string;
}
```

The controller constructor receives `GameApi`, a local record reader, `readActiveLocalId`, an analyzer defaulting to `analyzePosition`, and `onChange`. Validate that a local entry has `mode === 'local'` and `localState`, publish loading, analyze the exact saved state, and ignore results after disposal or a newer generation.

- [ ] **Step 4: Write failing server-version tests**

Assert this exact order and data flow:

```ts
assert.deepEqual(calls, [
  ['getGame', 'server-1'],
  ['analyzeGame', 'server-1', 7],
]);
```

Add cases for response `game_version !== 7`, `GAME_STATE_CONFLICT`, duplicate `enter()` during loading, retry after conflict, and disposal before a delayed response.

- [ ] **Step 5: Run controller tests and verify server RED**

Run: `node --test tests/analysis-controller.test.mts`

Expected: new server tests FAIL because remote loading is not implemented.

- [ ] **Step 6: Implement server analysis and error states**

For `mode === 'remote'`, require a game ID, call `getGame`, require a numeric `version`, call `analyzeGame(id, version)`, and compare both `game_id` and `game_version`. Convert `GAME_STATE_CONFLICT` or a response mismatch to `conflict` with “棋局已变化，请重新分析”. Use `messageForApiError` for safe network/not-found/forbidden messages. Prevent parallel execution while loading; retry starts a fresh generation and repeats both server requests.

- [ ] **Step 7: Run controller tests and verify GREEN**

Run: `node --test tests/analysis-controller.test.mts`

Expected: all controller tests PASS.

### Task 3: Replace the demo analysis page

**Files:**
- Modify: `miniprogram/pages/analysis/analysis.ts`
- Modify: `miniprogram/pages/analysis/analysis.wxml`
- Modify: `miniprogram/pages/analysis/analysis.wxss`
- Modify: `miniprogram/components/evaluation-panel/evaluation-panel.ts`
- Modify: `miniprogram/components/evaluation-panel/evaluation-panel.wxml`
- Modify: `miniprogram/components/candidate-move-list/candidate-move-list.wxml`
- Create: `tests/analysis-page.test.mts`

- [ ] **Step 1: Write the failing page tests**

Register the page with mocked `Page` and `wx`. Seed a local device-history record, call `onLoad({ mode: 'local', gameId: 'local-1' })`, flush async work, and assert success uses the saved state. Mock `wx.request` for a remote game and analysis response, then assert the GET occurs before POST and the expected version is sent. Inspect WXML and assert it contains real view fields and does not contain `演示数据`, `演示棋盘`, or `UI 演示`.

- [ ] **Step 2: Run the page test and verify RED**

Run: `node --test tests/analysis-page.test.mts`

Expected: FAIL because the page still reads `analysisService` demo data.

- [ ] **Step 3: Wire the page to the controller**

Initialize empty page data, parse only `mode === 'remote'` as server mode and otherwise local mode, instantiate the controller with `createGameApi(createApiClient())`, `createWxDeviceHistoryStore().get`, and `wx.getStorageSync('activeLocalGameId')`. Render controller snapshots with `setData`; dispose on unload; make `retry()` call the controller again.

- [ ] **Step 4: Render the three real tabs and explicit states**

Update WXML so:

- loading uses `loading-state`;
- error and conflict use `error-state` with retry;
- empty state has buttons to `/pages/game/game?mode=local` and `/pages/history/history`;
- evaluation reads `view.score`, `view.bestScore`, `view.breakdown`, `view.threats`, and `view.board`;
- pieces reads `view.keyPieces` and `view.board`;
- moves reads `view.bestMove`, `view.candidates`, and `view.board`.

Remove every demo label and change the footer to “评分为当前行棋方视角的引擎评估”. Update `evaluation-panel` properties to numeric current/best scores and perspective. Keep `candidate-move-list` generic but render actual assessment and score detail.

- [ ] **Step 5: Run the page tests and verify GREEN**

Run: `node --test tests/analysis-page.test.mts`

Expected: all independent page tests PASS.

### Task 4: Pass real game context and share AI mapping

**Files:**
- Modify: `miniprogram/pages/game/game.ts`
- Modify: `miniprogram/pages/game/game.wxml`
- Modify: `tests/history-game-page.test.mts`
- Modify: `tests/ai-game-page.test.mts`

- [ ] **Step 1: Write failing navigation and shared-mapping tests**

Capture `wx.navigateTo` calls. For local page data, assert analysis opens:

```text
/pages/analysis/analysis?mode=local&gameId=<encoded local ID>
```

For remote page data, assert:

```text
/pages/analysis/analysis?mode=remote&gameId=<encoded server ID>
```

Keep the existing AI request assertion and add assertions that its breakdown, threats, and candidate display model equals `mapPositionAnalysis(currentState, response)`.

- [ ] **Step 2: Run affected tests and verify RED**

Run: `node --test tests/history-game-page.test.mts tests/ai-game-page.test.mts`

Expected: navigation tests FAIL because `openAnalysis()` currently sends no parameters; shared-view assertions FAIL because AI uses page-local mapping.

- [ ] **Step 3: Implement context-aware navigation**

Update `openAnalysis()`:

```ts
if (this.data.mode === 'ai') {
  void this.aiController?.analyze();
  return;
}
const gameId = this.data.mode === 'local'
  ? this.data.localGameId : this.data.remoteState?.gameId;
if (!gameId) {
  wx.showToast({ title: '当前没有可分析的棋局', icon: 'none' });
  return;
}
openPage(`/pages/analysis/analysis?mode=${this.data.mode}&gameId=${encodeURIComponent(gameId)}`);
```

- [ ] **Step 4: Replace AI-only mapping constants with the shared mapper**

Remove page-local breakdown and threat tables. When `snapshot.analysis` and `snapshot.gameState` exist, call `mapPositionAnalysis`; store the result as `aiAnalysisView`. Bind AI analysis WXML to the shared view’s candidates, breakdown, threats, score, perspective, and search metadata.

- [ ] **Step 5: Run affected tests and verify GREEN**

Run: `node --test tests/history-game-page.test.mts tests/ai-game-page.test.mts`

Expected: all affected tests PASS.

### Task 5: Acceptance evidence and full verification

**Files:**
- Create: `docs/independent-position-analysis-acceptance.md`
- Modify: `README.md`

- [ ] **Step 1: Update user-facing status documentation**

Change README statements that say independent analysis still uses demonstration content. Record in the acceptance document the implemented sources, version behavior, offline behavior, exact test commands, and current phase decision.

- [ ] **Step 2: Run targeted feature verification**

Run:

```powershell
node --test tests/analysis-view-model.test.mts tests/analysis-controller.test.mts tests/analysis-page.test.mts tests/history-game-page.test.mts tests/ai-game-page.test.mts
```

Expected: all targeted tests PASS.

- [ ] **Step 3: Run project verification**

Run:

```powershell
npm run typecheck
npm run check
npm test
```

Expected: typecheck and structural checks exit 0; the full frontend suite has zero failures.

- [ ] **Step 4: Run WeChat developer-tool acceptance**

Using the already configured automator connection, open a real local position and a real server `LOCAL` position through their analysis entry. Verify the three tabs show non-demo fields, the local path makes no API call, and the server path returns the same game ID/version from GET and analysis. Re-run after one legal move and verify the version or saved state changes.

- [ ] **Step 5: Decide the stage gate**

Mark the stage complete only if all automated checks pass and developer-tool acceptance proves local offline analysis plus server versioned analysis. Otherwise list each unmet acceptance condition and keep the next stage blocked.
