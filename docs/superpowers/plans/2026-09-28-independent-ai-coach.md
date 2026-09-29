# Independent AI Coach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the independent AI coach demo with sequential, version-bound hints from the current real AI game.

**Architecture:** Add a page-specific controller that loads the authoritative AI game and owns progressive hint state, conflict recovery, and stale-response protection. Keep the page thin: it renders the controller snapshot, maps the real game through the existing board mapper, and delegates each card selection to the controller. Rework the coach card into a generic presentational component and keep the existing in-game coach behavior unchanged.

**Tech Stack:** WeChat Mini Program TypeScript/WXML/WXSS, existing `GameApi`, Node test runner, miniprogram-automator.

---

### Task 1: Authoritative coach controller

**Files:**
- Create: `miniprogram/pages/coach/coach-controller.ts`
- Create: `tests/coach-controller.test.mts`

- [ ] **Step 1: Write failing tests for loading the current AI game**

Create controller tests that provide a fake `GameApi` and assert:

```ts
await controller.enter({});
assert.deepEqual(calls, [['getGame', 'active-ai']]);
assert.equal(controller.snapshot.state, 'ready');
assert.equal(controller.snapshot.gameVersion, 4);
assert.equal(controller.snapshot.gameState, state);
```

Also assert an explicit `gameId` takes priority, no ID produces `empty`, a non-AI game produces a safe `error`, and finished or AI-turn games produce `unavailable` without requesting a hint.

- [ ] **Step 2: Run the controller tests and verify RED**

Run:

```text
node --test tests/coach-controller.test.mts
```

Expected: fail because `coach-controller.ts` does not exist.

- [ ] **Step 3: Implement the controller load state**

Implement these public shapes:

```ts
export interface IndependentCoachSnapshot {
  readonly state: 'idle' | 'loading' | 'ready' | 'empty' | 'unavailable' | 'error' | 'conflict';
  readonly gameId: string | null;
  readonly gameVersion: number | null;
  readonly gameState: GameState | null;
  readonly humanPlayer: Player | null;
  readonly aiPlayer: Player | null;
  readonly hints: readonly CoachHintDto[];
  readonly loadingLevel: 1 | 2 | 3 | null;
  readonly errorMessage: string;
  readonly notice: string;
}

export class IndependentCoachController {
  get snapshot(): IndependentCoachSnapshot;
  enter(source?: { readonly gameId?: string }): Promise<void>;
  requestLevel(level: 1 | 2 | 3): Promise<void>;
  retry(): Promise<void>;
  dispose(): void;
}
```

`enter` must read the explicit ID first, then `readActiveAiId`, GET the authoritative game, validate AI metadata and integer version, update active storage, clear old hints, and classify `ready` versus `unavailable`.

- [ ] **Step 4: Write failing tests for sequential real hints**

Assert level 2 is ignored before level 1, each successful call uses the current version, response identity fields must match, loaded levels are not requested twice, and levels unlock in order:

```ts
await controller.requestLevel(1);
await controller.requestLevel(2);
await controller.requestLevel(3);
assert.deepEqual(calls, [
  ['getCoachHint', 'ai-1', 1, 4],
  ['getCoachHint', 'ai-1', 2, 4],
  ['getCoachHint', 'ai-1', 3, 4],
]);
assert.deepEqual(controller.snapshot.hints.map(item => item.level), [1, 2, 3]);
```

- [ ] **Step 5: Implement sequential hints and conflict recovery**

Before accepting a hint, compare `gameId`, `gameVersion`, `analyzedPlayer`, and `level` with the loaded snapshot. On `GAME_STATE_CONFLICT`, increment generation, clear hints, reload the authoritative game, and finish in `conflict` with the notice `棋局已更新，请从一级提示重新开始`. Reject duplicate requests while `loadingLevel` is non-null. Ignore all responses after `dispose` or a newer generation.

- [ ] **Step 6: Run controller tests and verify GREEN**

Run the controller test file and expect all load, sequencing, conflict, duplicate, and disposal cases to pass.

### Task 2: Real independent coach page and card component

**Files:**
- Modify: `miniprogram/pages/coach/coach.ts`
- Modify: `miniprogram/pages/coach/coach.wxml`
- Modify: `miniprogram/pages/coach/coach.wxss`
- Modify: `miniprogram/pages/coach/coach.json`
- Modify: `miniprogram/components/coach-card/coach-card.ts`
- Modify: `miniprogram/components/coach-card/coach-card.wxml`
- Modify: `miniprogram/components/coach-card/coach-card.wxss`
- Create: `tests/coach-page.test.mts`

- [ ] **Step 1: Write failing page and template tests**

Load `coach.ts` with fake `wx` storage and HTTP responses. Assert the page reads `activeAiGameId`, renders the real board and version, and requests levels 1 through 3 with `expected_version`. Inspect WXML text and assert it binds `hintText`, `focusTopics`, `candidateFromNodes`, `bestMove`, and the real board while excluding `UI 演示`, `演示提示`, `演示讲解`, `P09 → P13`, and the old fixed speech.

- [ ] **Step 2: Run page tests and verify RED**

Run:

```text
node --test tests/coach-page.test.mts
```

Expected: fail because the current page still loads `coachService.getHints()` and contains demo content.

- [ ] **Step 3: Wire the page to the controller**

In `coach.ts`, construct `IndependentCoachController` with `createGameApi(createApiClient())`, `activeAiGameId` storage functions, and a render callback. Map `snapshot.gameState` through `mapGameStateToView`. Build three card view objects from the real hint list and state. Handle `selectHint`, retry, start/continue AI game, history, review, and unload disposal.

- [ ] **Step 4: Replace demo WXML with real state rendering**

Render loading, empty, error/conflict, unavailable, and ready states. In ready state render authoritative metadata, `chess-board`, and three `coach-card` components. The cards must display only DTO-backed content and progressive lock/loading state. Continue-AI navigation must include `mode=ai&gameId=<encoded id>`.

- [ ] **Step 5: Make `coach-card` presentational**

Replace the old `hint` object contract with explicit properties:

```ts
level: Number;
title: String;
body: String;
detail: String;
expanded: Boolean;
locked: Boolean;
loading: Boolean;
```

The card emits `select` only when unlocked and not loading. Remove the demo tag and show lock/loading detail derived from page state.

- [ ] **Step 6: Run page and controller tests and verify GREEN**

Run both new test files and expect all tests to pass.

### Task 3: WeChat developer-tool end-to-end acceptance

**Files:**
- Create: `scripts/independent-coach-devtool-e2e.cjs`
- Modify: `package.json`

- [ ] **Step 1: Add the end-to-end script**

Connect to the existing automator endpoint, preserve and restore `activeAiGameId`, create a fresh AI game with the human moving first, open `/pages/coach/coach`, and assert the authoritative board and version are shown. Tap each level card in order and assert the page snapshot contains levels `[1, 2, 3]`, level 3 has a real `bestMove`, and no demo label exists.

- [ ] **Step 2: Register and run the script**

Add:

```json
"test:e2e:coach": "node scripts/independent-coach-devtool-e2e.cjs"
```

Run `npm run test:e2e:coach` and expect a `RESULT independent-coach=PASS` line with game ID, version, and three loaded levels.

### Task 4: Regression suite and stage acceptance

**Files:**
- Create: `docs/independent-ai-coach-acceptance.md`

- [ ] **Step 1: Run focused tests**

Run:

```text
node --test tests/coach-controller.test.mts tests/coach-page.test.mts tests/ai-game.test.mts
```

Expected: all independent and in-game coach tests pass.

- [ ] **Step 2: Run project verification**

Run `npm test`, `npm run typecheck`, `npm run check`, and `git diff --check`. Record exact pass counts and any non-failing line-ending warnings.

- [ ] **Step 3: Write the acceptance record**

Document the implemented data flow, progressive disclosure, stale-response protection, error states, focused/full test results, and developer-tool evidence. Mark the stage complete only when every design acceptance item has direct test or end-to-end evidence.
