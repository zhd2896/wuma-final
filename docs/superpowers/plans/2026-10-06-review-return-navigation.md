# Review Return Navigation Implementation Plan

> **For agentic workers:** Execute inline with superpowers:executing-plans and test-driven-development. Parent reviews the result; no subagents or automatic commits.

**Goal:** Allow review to return normally and recover to authenticated reviewable history when back navigation is unavailable or fails.

**Architecture:** Keep the existing page stack through `navigateBack`. Use a page-local fallback with `hasWechatSession` and `showLogin`; no changes to global navigation or authentication policy.

**Tech Stack:** WeChat TypeScript Page, Node test runner, TypeScript compiler.

## Task 1: Reproduce and specify return behavior

**Files:** Create `tests/review-navigation.test.mts`; inspect `miniprogram/pages/review/review.ts`, `miniprogram/services/device-auth.ts`, `miniprogram/services/auth-navigation.ts`.

- [x] Register the existing `.ts` resolver and capture the real review `Page` definition. Supply SDK adapters for navigation and saved session only; call the actual `back()` method.
- [x] Assert `navigateBack` delta 1 and unchanged fallback destinations when an existing history/game/online page is below review.
- [x] Assert authenticated empty/single-page stacks reLaunch `/pages/history/history?filter=reviewable` without attempting back.
- [x] Assert an SDK `fail` callback or synchronous throw returns to that history route.
- [x] Assert missing/expired session recovers through `/pages/login/login`, with query-decoded `next` equal to the history route.
- [x] Run `node --test tests/review-navigation.test.mts`; observe failures for missing recovery before production edits.

## Task 2: Minimal implementation and green run

**Files:** Modify `miniprogram/pages/review/review.ts`.

- [x] Add imports for `hasWechatSession` and `showLogin`.
- [x] Replace `back()` with the following behavior:

```typescript
back() {
  const fallback = () => {
    const route = '/pages/history/history?filter=reviewable';
    if (hasWechatSession()) wx.reLaunch({ url: route });
    else showLogin(route);
  };
  if (getCurrentPages().length <= 1) { fallback(); return; }
  try { wx.navigateBack({ delta: 1, fail: fallback }); }
  catch { fallback(); }
},
```

- [x] Run `node --test tests/review-navigation.test.mts tests/review-page.test.mts tests/auth-navigation.test.mts tests/rules-auth.test.mts`; confirm green.

## Task 3: Verify and document limits

- [x] Run `npm test`, `npm run typecheck`, and `npm run check`; verify exit codes and test totals.
- [x] Review the scoped diff, update this checklist and write `docs/reviews/2026-10-06-review-return-navigation-verification.md` with red/green results and external acceptance still pending.
- [x] Report files and evidence to the parent for review. Do not commit or modify the global phase roadmap.
