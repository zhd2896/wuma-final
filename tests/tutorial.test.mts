import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
registerHooks({ resolve(s, c, next) {
  try { return next(s, c); } catch (e) {
    if (s.startsWith('.') && c.parentURL && existsSync(new URL(`${s}.ts`, c.parentURL)))
      return next(new URL(`${s}.ts`, c.parentURL).href, c);
    throw e;
  }
} });

test('three lessons execute real moves, captures and reserve replacement before completion', async () => {
  const { TutorialController, TUTORIAL_LESSONS } = await import('../miniprogram/guide/tutorial-controller.ts');
  const c = new TutorialController();
  for (let i = 0; i < 3; i++) {
    const lesson = TUTORIAL_LESSONS[i];
    c.next();
    assert.equal(c.snapshot.stepIndex, i, 'cannot skip unfinished lesson');
    c.tap(lesson.move.from);
    assert.deepEqual(c.snapshot.legalTargets, [lesson.move.to]);
    c.tap(lesson.move.to);
    assert.equal(c.snapshot.passed, true);
    assert.equal(c.snapshot.state.board.occupancy[lesson.move.from], null);
    assert.equal(c.snapshot.state.board.occupancy[lesson.move.to], 'A');
    assert.equal(c.snapshot.lastCapture?.captured_nodes.length, i);
    assert.equal(c.snapshot.state.players.A.reserve_count, 4 - i);
    for (const node of c.snapshot.lastCapture?.captured_nodes ?? [])
      assert.equal(c.snapshot.state.board.occupancy[node], 'A');
    if (i) assert.equal(c.snapshot.lastCapture?.patterns[0].capture_type, i === 1 ? 'CLAMP' : 'CARRY');
    const state = c.snapshot.state;
    c.tap(lesson.move.to);
    assert.equal(c.snapshot.state, state, 'duplicate tap cannot execute another turn');
    c.next();
  }
  assert.equal(c.snapshot.completed, true);
  c.next();
  assert.equal(c.snapshot.stepIndex, 3);
});

test('wrong moves retain the board, retry resets a passed lesson, invalid checkpoints reset safely', async () => {
  const { TutorialController } = await import('../miniprogram/guide/tutorial-controller.ts');
  const c = new TutorialController(1);
  const initial = c.snapshot.state;
  c.tap('bogus'); c.tap('P12'); c.tap('P13');
  assert.equal(c.snapshot.state, initial);
  assert.equal(c.snapshot.passed, false);
  c.tap('P08'); c.tap('P09');
  assert.equal(c.snapshot.state, initial);
  assert.ok(c.snapshot.message);
  c.tap('P13');
  assert.equal(c.snapshot.passed, true);
  c.retry();
  assert.equal(c.snapshot.stepIndex, 1);
  assert.equal(c.snapshot.passed, false);
  assert.equal(c.snapshot.state.board.occupancy.P12, 'B');
  for (const invalid of [-1, 4, 1.5, NaN]) assert.equal(new TutorialController(invalid).snapshot.stepIndex, 0);
  assert.equal(new TutorialController(3).snapshot.completed, true);
});
