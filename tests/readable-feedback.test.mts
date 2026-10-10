import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
registerHooks({ resolve(s, c, next) {
  try { return next(s, c); } catch (e) {
    if (s.startsWith('.') && c.parentURL && existsSync(new URL(`${s}.ts`, c.parentURL)))
      return next(new URL(`${s}.ts`, c.parentURL).href, c);
    throw e;
  }
} });

test('review highlights only own mistakes, orders severity and loss, and handles no mistakes honestly', async () => {
  const { keyReviewMoments, reviewCategoryText, readableReason } = await import('../miniprogram/services/feedback-presentation.ts');
  const rows: any[] = [
    { turn: 1, player: 'B', category: 'BLUNDER', scoreLoss: 999 },
    { turn: 2, player: 'A', category: 'MISTAKE', scoreLoss: 99 },
    { turn: 3, player: 'A', category: 'BLUNDER', scoreLoss: 10 },
    { turn: 4, player: 'A', category: 'BLUNDER', scoreLoss: 20 },
    { turn: 5, player: 'A', category: 'GOOD', scoreLoss: 0 },
  ];
  const original = structuredClone(rows);
  assert.deepEqual(keyReviewMoments(rows, 'A').map(r => r.turn), [4, 3, 2]);
  assert.deepEqual(keyReviewMoments(rows, 'B').map(r => r.turn), [1]);
  assert.deepEqual(keyReviewMoments(rows.filter(r => r.category === 'GOOD'), 'A'), []);
  assert.deepEqual(rows, original);
  assert.deepEqual(['GOOD', 'NORMAL', 'MISTAKE', 'BLUNDER'].map(reviewCategoryText), ['好棋', '一般', '失误', '严重失误']);
  assert.equal(readableReason('错过了夹吃机会。评分损失为 230 分。搜索深度 2。', 'fallback'), '错过了夹吃机会。');
  assert.equal(readableReason('这一步是 BLUNDER。', 'fallback'), '这一步是 严重失误。');
});

test('answer feedback prefers lesson reasoning, preserves equivalent-best correctness and has no technical score first', async () => {
  const { answerFeedback } = await import('../miniprogram/services/feedback-presentation.ts');
  const a: any = { result: 'CORRECT', bestMoveEquivalent: true, submittedMove: { from: 'P02', to: 'P22' },
    bestMove: { from: 'P02', to: 'P27' }, scoreLoss: 0, lessonExplanation: '离开夹击线，保留活动空间。' };
  assert.equal(answerFeedback(a).title, '走法正确');
  assert.equal(answerFeedback(a).reason, a.lessonExplanation);
  assert.match(answerFeedback(a).recommendationNote, /同样有效/);
  assert.doesNotMatch(JSON.stringify(answerFeedback({ ...a, result: 'SUBOPTIMAL', lessonExplanation: null })), /\b(CORRECT|SUBOPTIMAL)\b|搜索深度|评分损失/);
  assert.equal(answerFeedback(null).title, '');
});

test('native details are closed by default, toggle locally and reset for a different record', async () => {
  let definition: any;
  (globalThis as any).Component = (value: any) => { definition = value; };
  await import('../miniprogram/components/expandable-details/expandable-details.ts');
  const c = { ...definition, ...definition.methods, data: { ...definition.data },
    setData(patch: any) { Object.assign(this.data, patch); } };
  assert.equal(c.data.expanded, false);
  c.toggle(); assert.equal(c.data.expanded, true);
  c.toggle(); assert.equal(c.data.expanded, false);
  c.toggle(); definition.observers.resetKey.call(c, 'first'); assert.equal(c.data.expanded, false);
  c.toggle(); definition.observers.resetKey.call(c, 'first'); assert.equal(c.data.expanded, true);
  definition.observers.resetKey.call(c, 'second'); assert.equal(c.data.expanded, false);
  const template = readFileSync('miniprogram/components/expandable-details/expandable-details.wxml', 'utf8');
  assert.match(template, /wx:if="\{\{expanded\}\}"/);
  assert.match(template, /<slot\s*\//);
});

test('templates lead with key mistakes and hide score depth and version behind details', () => {
  const review = readFileSync('miniprogram/pages/review/review.wxml', 'utf8');
  const training = readFileSync('miniprogram/pages/training/training.wxml', 'utf8');
  assert.ok(review.indexOf('关键失误') < review.indexOf('review-board-panel'));
  assert.doesNotMatch(review, />\s*(GOOD|NORMAL|MISTAKE|BLUNDER)\s|\{\{item.category\}\}/);
  for (const [template, tokens] of [[review, ['item.scoreLoss', 'item.searchDepth', 'review.reviewConfigVersion', 'replayVersion']],
    [training, ['answer.bestScore', 'answer.scoreLoss', 'answer.searchDepth']]] as const) {
    for (const token of tokens) {
      const at = template.indexOf(token);
      assert.ok(at >= 0, `preserve ${token}`);
      assert.ok(template.lastIndexOf('<expandable-details', at) > template.lastIndexOf('</expandable-details>', at), `collapse ${token}`);
    }
  }
  assert.match(training, /反馈原因|原因：|解题要点/);
  assert.match(training, /推荐走法/);
  assert.ok(training.indexOf('id="training-feedback"') < training.indexOf('class="challenge-board"'));
});
