import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { createInitialGameState } from '../miniprogram/domain/index.ts';
registerHooks({ resolve(s, c, next) {
  try { return next(s, c); } catch (e) {
    if (s.startsWith('.') && c.parentURL && existsSync(new URL(`${s}.ts`, c.parentURL)))
      return next(new URL(`${s}.ts`, c.parentURL).href, c);
    throw e;
  }
} });
const { TrainingController } = await import('../miniprogram/pages/training/training-controller.ts');

test('a scored twentieth attempt refreshes calibration without replaying the answer or resetting progress', async () => {
  const q: any = { id: 'intro', player: 'A', sourceKind: 'CURATED', stateSnapshot: createInitialGameState(),
    progress: { attemptCount: 0, completed: false, latestResult: null },
    difficultyCalibration: { sampleCount: 19, firstTryCorrectCount: 14, minimumSamples: 20,
      status: 'COLLECTING', suggestedDifficulty: null } };
  let getCalls = 0, answerCalls = 0;
  const api: any = { list: async () => ({ items: [q], total: 1 }),
    get: async () => ++getCalls === 1 ? q : { ...q, difficultyCalibration: {
      ...q.difficultyCalibration, sampleCount: 20, firstTryCorrectCount: 15, status: 'CALIBRATED', suggestedDifficulty: 'EASY' } },
    legalMoves: async () => ({ moves: [{ from: 'P11', to: 'P12' }] }),
    answer: async () => { answerCalls++; return { result: 'CORRECT' }; } };
  const c = new TrainingController(api, () => {});
  await c.enter(); await c.open(q.id); await c.tapNode('P11'); await c.tapNode('P12');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.snapshot.question?.difficultyCalibration?.status, 'CALIBRATED');
  assert.equal(c.snapshot.items[0].difficultyCalibration?.sampleCount, 20);
  assert.equal(c.snapshot.question?.progress.attemptCount, 1);
  assert.equal(c.snapshot.question?.progress.completed, true);
  assert.equal(answerCalls, 1);
  assert.equal(c.snapshot.isSubmittingAnswer, false);
});

test('late or failed calibration reads preserve graded answers and cannot refill a closed question', async () => {
  const q: any = { id: 'intro', player: 'A', sourceKind: 'CURATED', stateSnapshot: createInitialGameState(),
    progress: { attemptCount: 0, completed: false, latestResult: null },
    difficultyCalibration: { sampleCount: 19, status: 'COLLECTING' } };
  for (const close of [true, false]) {
    let resolveRead!: (value: any) => void, rejectRead!: (error: Error) => void, calls = 0;
    const read = new Promise((resolve, reject) => { resolveRead = resolve; rejectRead = reject; });
    const api: any = { list: async () => ({ items: [q], total: 1 }), get: async () => ++calls === 1 ? q : read,
      legalMoves: async () => ({ moves: [{ from: 'P11', to: 'P12' }] }), answer: async () => ({ result: 'CORRECT' }) };
    const c = new TrainingController(api, () => {});
    await c.enter(); await c.open(q.id); await c.tapNode('P11'); await c.tapNode('P12');
    assert.equal(c.snapshot.answer?.result, 'CORRECT');
    if (close) { c.backToList(); resolveRead({ ...q, difficultyCalibration: { status: 'CALIBRATED' } }); }
    else rejectRead(new Error('offline'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(c.snapshot.errorMessage, null);
    if (close) assert.equal(c.snapshot.question, null);
    else assert.equal(c.snapshot.answer?.result, 'CORRECT');
    c.dispose();
  }
});
