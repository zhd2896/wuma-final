import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TranspositionTable,
  classifyTTFlag,
  normalizeScoreForTT,
  restoreScoreFromTT,
} from '../miniprogram/ai/transposition-table.ts';

const baseEntry = {
  hash: '0123456789abcdef', stateSignature: 'board|A|4|4|PLAYING|null|null',
  depth: 3, score: 123, isMate: false,
  flag: 'EXACT' as const, bestMove: null,
};

test('EXACT entry is used only at the same remaining depth', () => {
  const table = new TranspositionTable();
  assert.equal(table.store(baseEntry), true);
  const exact = table.probe(baseEntry.hash, baseEntry.stateSignature, 3, -Infinity, Infinity, 2);
  assert.equal(exact.hit, true);
  assert.equal(exact.exact, true);
  assert.equal(exact.score, 123);
  assert.equal(exact.cutoff, false);
  assert.equal(table.hits, 1);
  const shallow = table.probe(baseEntry.hash, baseEntry.stateSignature, 2, -Infinity, Infinity, 2);
  const deep = table.probe(baseEntry.hash, baseEntry.stateSignature, 4, -Infinity, Infinity, 2);
  assert.equal(shallow.hit, false);
  assert.equal(deep.hit, false);
  assert.equal(table.hits, 1);
});

test('same hash with a different state signature is a collision miss', () => {
  const table = new TranspositionTable();
  table.store(baseEntry);
  const collision = table.probe(baseEntry.hash, 'different-state', 3, -Infinity, Infinity, 0);
  assert.equal(collision.hit, false);
  assert.equal(collision.score, null);
  table.store({ ...baseEntry, stateSignature: 'different-state', score: 456 });
  assert.equal(table.size, 2);
  assert.equal(table.probe(baseEntry.hash, baseEntry.stateSignature, 3,
    -Infinity, Infinity, 0).score, 123);
  assert.equal(table.probe(baseEntry.hash, 'different-state', 3,
    -Infinity, Infinity, 0).score, 456);
});

test('LOWER_BOUND tightens alpha and records only real TT cutoffs', () => {
  const table = new TranspositionTable();
  table.store({ ...baseEntry, flag: 'LOWER_BOUND', score: 20 });
  const tightened = table.probe(baseEntry.hash, baseEntry.stateSignature, 3, 10, 30, 0);
  assert.equal(tightened.hit, true);
  assert.equal(tightened.exact, false);
  assert.equal(tightened.alpha, 20);
  assert.equal(tightened.beta, 30);
  assert.equal(tightened.cutoff, false);
  const unchanged = table.probe(baseEntry.hash, baseEntry.stateSignature, 3, 25, 30, 0);
  assert.equal(unchanged.hit, false);
  const cutoff = table.probe(baseEntry.hash, baseEntry.stateSignature, 3, 10, 15, 0);
  assert.equal(cutoff.cutoff, true);
  assert.equal(cutoff.score, 20);
  assert.equal(table.cutoffs, 1);
});

test('UPPER_BOUND tightens beta without changing alpha', () => {
  const table = new TranspositionTable();
  table.store({ ...baseEntry, flag: 'UPPER_BOUND', score: 5 });
  const tightened = table.probe(baseEntry.hash, baseEntry.stateSignature, 3, 0, 10, 0);
  assert.equal(tightened.hit, true);
  assert.equal(tightened.alpha, 0);
  assert.equal(tightened.beta, 5);
  assert.equal(tightened.cutoff, false);
  const cutoff = table.probe(baseEntry.hash, baseEntry.stateSignature, 3, 7, 10, 0);
  assert.equal(cutoff.cutoff, true);
  assert.equal(cutoff.score, 5);
});

test('fail-soft flags use the original window', () => {
  assert.equal(classifyTTFlag(10, 10, 20), 'UPPER_BOUND');
  assert.equal(classifyTTFlag(20, 10, 20), 'LOWER_BOUND');
  assert.equal(classifyTTFlag(15, 10, 20), 'EXACT');
});

test('replacement keeps deeper entries and prefers EXACT at equal depth', () => {
  const table = new TranspositionTable();
  table.store({ ...baseEntry, flag: 'LOWER_BOUND' });
  assert.equal(table.store({ ...baseEntry, depth: 2, score: 99 }), false);
  assert.equal(table.store({ ...baseEntry, depth: 3, flag: 'EXACT', score: 200 }), true);
  assert.equal(table.store({ ...baseEntry, depth: 3, flag: 'UPPER_BOUND', score: 7 }), false);
  assert.equal(table.probe(baseEntry.hash, baseEntry.stateSignature, 3,
    -Infinity, Infinity, 0).score, 200);
  assert.equal(table.store({ ...baseEntry, depth: 4, score: 300 }), true);
  assert.equal(table.probe(baseEntry.hash, baseEntry.stateSignature, 3,
    -Infinity, Infinity, 0).hit, false);
  assert.equal(table.probe(baseEntry.hash, baseEntry.stateSignature, 4,
    -Infinity, Infinity, 0).score, 300);
  assert.equal(table.stores, 3);
  assert.equal(table.size, 1);
});

test('mate normalization restores the correct positive and negative distance', () => {
  assert.equal(normalizeScoreForTT(999_997, 3, true), 1_000_000);
  assert.equal(restoreScoreFromTT(1_000_000, 1, true), 999_999);
  assert.equal(normalizeScoreForTT(-999_997, 3, true), -1_000_000);
  assert.equal(restoreScoreFromTT(-1_000_000, 5, true), -999_995);
});

test('ordinary scores, even near mate magnitude, are never ply-adjusted', () => {
  for (const score of [123, 999_997, -999_997]) {
    assert.equal(normalizeScoreForTT(score, 4, false), score);
    assert.equal(restoreScoreFromTT(score, 7, false), score);
  }
});
