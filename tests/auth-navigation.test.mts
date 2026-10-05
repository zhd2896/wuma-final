import test from 'node:test';
import assert from 'node:assert/strict';
import { showLogin, safeReturnRoute } from '../miniprogram/services/auth-navigation.ts';

test('login navigation recovers after a missing callback without letting an older completion unlock a new request', () => {
  const originalNow = Date.now;
  const destinations: string[] = [];
  const completions: Array<() => void> = [];
  let now = 10000;
  (globalThis as any).getCurrentPages = () => [{ route: 'guide/pages/rules/rules', options: {} }];
  (globalThis as any).wx = { reLaunch(options: any) {
    destinations.push(options.url);
    completions.push(options.complete);
  } };
  Date.now = () => now;
  try {
    showLogin('/pages/index/index');
    showLogin('/pages/profile/profile');
    assert.equal(destinations.length, 1, 'concurrent redirects preserve the first destination');
    now += 5000;
    showLogin('/pages/game/game');
    assert.equal(destinations.length, 2, 'a missing callback must not lock future navigation');
    assert.equal(destinations[1], '/pages/login/login?next=/pages/game/game');
    completions[0]();
    showLogin('/pages/profile/profile');
    assert.equal(destinations.length, 2, 'old completion cannot unlock the new in-flight redirect');
    completions[1]();
    showLogin('/pages/profile/profile');
    assert.equal(destinations.length, 3);
  } finally {
    completions.at(-1)?.();
    Date.now = originalNow;
  }
});

test('encoded login options decode once and retain query value escaping', () => {
  const target = '/pages/review/review?gameId=a%26b&mode=ai';
  assert.equal(safeReturnRoute(encodeURIComponent(target)), target);
  assert.equal(safeReturnRoute(target), target);
  assert.equal(safeReturnRoute('/pages/review/review%3FgameId%3Da%2526b%26mode%3Dai'), target);
});

test('encoded external, unregistered, malformed and control-character return paths stay rejected', () => {
  for (const target of ['https://example.invalid', '//example.invalid', '/pages/unknown/unknown', '/pages/game/game\n', '/pages/game/game#x']) {
    assert.equal(safeReturnRoute(encodeURIComponent(target)), '/pages/index/index');
  }
  assert.equal(safeReturnRoute('%ZZ'), '/pages/index/index');
  assert.equal(safeReturnRoute('%252Fpages%252Fgame%252Fgame'), '/pages/index/index');
});

test('login target retains path slashes accepted by the real SDK while encoding nested query separators', () => {
  const destinations: string[] = [];
  (globalThis as any).getCurrentPages = () => [{ route: 'pages/profile/profile', options: {} }];
  (globalThis as any).wx = { reLaunch(options: any) {
    destinations.push(options.url);
    options.complete?.();
  } };
  const target = '/pages/review/review?gameId=g&mode=ai';
  showLogin(target);
  assert.equal(destinations[0], '/pages/login/login?next=/pages/review/review%3FgameId%3Dg%26mode%3Dai');
  assert.equal(new URL(destinations[0], 'https://miniprogram.invalid').searchParams.get('next'), target);
});
