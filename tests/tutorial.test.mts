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

test('original lessons execute real moves and leave new boundary lessons to learn', async () => {
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
  assert.equal(c.snapshot.completed, false);
  c.next();
  assert.equal(c.snapshot.stepIndex, 3);
});

test('wrong moves retain the board, retry resets a passed lesson, invalid checkpoints reset safely', async () => {
  const { TutorialController, TUTORIAL_LESSONS } = await import('../miniprogram/guide/tutorial-controller.ts');
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
  for (const invalid of [-1, TUTORIAL_LESSONS.length + 1, 1.5, NaN]) assert.equal(new TutorialController(invalid).snapshot.stepIndex, 0);
  assert.equal(new TutorialController(TUTORIAL_LESSONS.length).snapshot.completed, true);
});

test('insufficient reserve cancels capture while retaining the legal move and red pieces', async () => {
  const { TutorialController } = await import('../miniprogram/guide/tutorial-controller.ts');
  const c = new TutorialController(3);
  assert.equal(c.snapshot.completed, false);
  assert.equal(c.snapshot.state.players.A.reserve_count, 1);
  c.tap('P08'); c.tap('P13');
  assert.equal(c.snapshot.passed, true);
  assert.equal(c.snapshot.lastCapture?.failure_reason, 'INSUFFICIENT_RESERVE');
  assert.equal(c.snapshot.lastCapture?.required_reserve, 2);
  assert.equal(c.snapshot.lastCapture?.reserve_used, 0);
  assert.equal(c.snapshot.state.players.A.reserve_count, 1);
  assert.equal(c.snapshot.state.board.occupancy.P12, 'B');
  assert.equal(c.snapshot.state.board.occupancy.P14, 'B');
  assert.equal(c.snapshot.state.board.occupancy.P13, 'A');
  assert.equal(c.snapshot.state.game_status, 'PLAYING');
});

test('blocking one temple piece does not win while another red piece has escape routes', async () => {
  const { TutorialController } = await import('../miniprogram/guide/tutorial-controller.ts');
  const { RuleEngine } = await import('../miniprogram/domain/index.ts');
  const c = new TutorialController(4);
  c.tap('P07'); c.tap('P03');
  assert.equal(c.snapshot.passed, true);
  assert.equal(c.snapshot.state.game_status, 'PLAYING');
  assert.equal(c.snapshot.state.winner, null);
  const moves = RuleEngine.getLegalMoves(c.snapshot.state);
  assert.ok(moves.length > 0);
  assert.ok(moves.every(move => move.from === 'P25'));
  assert.deepEqual(c.snapshot.escapeMoves, moves);
});

test('lone temple blockade is adjudicated after a real move and turn switch', async () => {
  const { TutorialController } = await import('../miniprogram/guide/tutorial-controller.ts');
  const c = new TutorialController(5);
  c.tap('P07'); c.tap('P03');
  assert.equal(c.snapshot.passed, true);
  assert.equal(c.snapshot.state.game_status, 'FINISHED');
  assert.equal(c.snapshot.state.winner, 'A');
  assert.equal(c.snapshot.state.winner_reason, 'TEMPLE_TRAP');
  assert.equal(c.snapshot.state.current_player, 'B');
});

test('independent exercise accepts every real winning move and legal unsuccessful attempts need retry', async () => {
  const { TutorialController, TUTORIAL_LESSONS } = await import('../miniprogram/guide/tutorial-controller.ts');
  const { RuleEngine } = await import('../miniprogram/domain/index.ts');
  const index = TUTORIAL_LESSONS.length - 1;
  assert.ok(index >= 6);
  assert.equal(TUTORIAL_LESSONS[index].move, undefined, 'no answer route in independent lesson');
  const initial = new TutorialController(index).snapshot.state;
  const winners = RuleEngine.getLegalMoves(initial).filter(move => {
    const turn = RuleEngine.executeTurn(initial, move);
    return turn.winner === 'A' && turn.winner_reason === 'ALL_PIECES_IMMOBILIZED';
  });
  assert.ok(winners.length >= 2, 'exercise has multiple successful choices');
  for (const move of winners) {
    const c = new TutorialController(index);
    c.next(); assert.equal(c.snapshot.stepIndex, index);
    c.tap(move.from);
    assert.deepEqual(c.snapshot.legalTargets, RuleEngine.getLegalMoves(initial)
      .filter(item => item.from === move.from).map(item => item.to));
    c.tap(move.to);
    assert.equal(c.snapshot.passed, true);
    assert.equal(c.snapshot.state.winner_reason, 'ALL_PIECES_IMMOBILIZED');
    c.next(); assert.equal(c.snapshot.completed, true);
  }
  const c = new TutorialController(index);
  c.tap('P07'); c.tap('P12');
  assert.equal(c.snapshot.state.board.occupancy.P12, 'A', 'legal attempt really executes');
  assert.equal(c.snapshot.passed, false);
  assert.equal(c.snapshot.state.winner, null);
  assert.ok(c.snapshot.escapeMoves.length > 0);
  c.next(); assert.equal(c.snapshot.stepIndex, index);
  c.retry();
  assert.deepEqual(c.snapshot.state, initial);
  c.tap('P09'); c.tap('P03'); assert.equal(c.snapshot.passed, true);
});
