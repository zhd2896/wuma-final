import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); } catch (error) {
    if (specifier.startsWith('.') && context.parentURL && (error as any).code === 'ERR_MODULE_NOT_FOUND') {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return nextResolve(url.href, context);
    }
    throw error;
  }
} });

test('answer route previews keep the original position and reset with the next question', async () => {
  let definition: any;
  (globalThis as any).wx = {};
  (globalThis as any).Page = (page: any) => { definition = page; };
  await import(`../miniprogram/pages/training/training.ts?preview`);
  const page = { ...definition, data: structuredClone(definition.data), controller: {},
    setData(patch: any, done?: () => void) { Object.assign(this.data, patch); done?.(); } };
  const { createInitialGameState } = await import('../miniprogram/domain/index.ts');
  const question = { id: 'q1', title: '吃子', player: 'A', stateSnapshot: createInitialGameState(), trainingTags: ['CAPTURE'],
    difficultyTag: 'EASY', sourceKind: 'CURATED', progress: { completed: false, attemptCount: 0 } };
  const answer = { id: 'a1', result: 'SUBOPTIMAL', bestMoveEquivalent: false,
    submittedMove: { from: 'P01', to: 'P02' }, bestMove: { from: 'P01', to: 'P06' } };
  const snapshot = { items: [], question, answer, selectedNode: null, legalTargets: [] };
  page.render(snapshot);
  assert.equal(typeof page.showAnswerRoute, 'function');
  const saved = structuredClone(question.stateSnapshot); const pieces = structuredClone(page.data.board.pieces);
  page.showAnswerRoute({ currentTarget: { dataset: { route: 'mine' } } });
  assert.equal(page.data.board.recommendedTo, 'P02');
  page.showAnswerRoute({ currentTarget: { dataset: { route: 'best' } } });
  assert.equal(page.data.board.recommendedTo, 'P06');
  assert.deepEqual(page.data.board.pieces, pieces); assert.deepEqual(question.stateSnapshot, saved);
  page.render({ ...snapshot, question: { ...question, id: 'q2' }, answer: null });
  assert.equal(page.data.board.recommendLine, undefined); assert.equal(page.data.boardPreviewRoute, 'before');
});

test('training page route and actual picker handlers send source game and filter requests', async () => {
  let definition: any;
  const urls: URL[] = [];
  const scrolls: any[] = [];
  (globalThis as any).Page = (page: any) => { definition = page; };
  (globalThis as any).wx = {
    getStorageSync: (key: string) => key.startsWith('wuma:wechat-session:')
      ? { token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' } : '',
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    pageScrollTo: (options: any) => scrolls.push(options),
    request: (options: any) => { urls.push(new URL(options.url));
      options.success({ statusCode: 200, data: { code: 0, data: { items: [], total: 0 } } }); },
  };
  await import('../miniprogram/pages/training/training.ts');
  const page = { ...definition, data: { ...definition.data },
    setData(patch: any, done?: () => void) { Object.assign(this.data, patch); done?.(); } };
  page.onLoad({ source: 'REVIEW', gameId: 'game/one' });
  for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(urls[0].searchParams.get('source'), 'REVIEW');
  assert.equal(urls[0].searchParams.get('source_game_id'), 'game/one');
  page.changeFilter({ currentTarget: { dataset: { filter: 'sourceIndex' } }, detail: { value: '0' } });
  for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(urls.at(-1)!.searchParams.get('source'), 'CURATED');
  assert.equal(urls.at(-1)!.searchParams.has('source_game_id'), false);
  page.changeFilter({ currentTarget: { dataset: { filter: 'completedIndex' } }, detail: { value: '1' } });
  for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(urls.at(-1)!.searchParams.get('completed'), 'false');
  assert.equal(urls.at(-1)!.searchParams.get('offset'), '0');
  page.changeFilter({ currentTarget: { dataset: { filter: 'themeIndex' } }, detail: { value: '1' } });
  for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(urls.at(-1)!.searchParams.get('theme'), 'CAPTURE');
  page.changeFilter({ currentTarget: { dataset: { filter: 'difficultyIndex' } }, detail: { value: '1' } });
  for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(urls.at(-1)!.searchParams.get('difficulty'), 'EASY');
  assert.equal(urls.at(-1)!.searchParams.get('theme'), 'CAPTURE');
  assert.equal(urls.at(-1)!.searchParams.get('completed'), 'false');
  assert.equal(urls.at(-1)!.searchParams.get('offset'), '0');
  const wxml = readFileSync('miniprogram/pages/training/training.wxml', 'utf8');
  for (const filter of ['sourceIndex', 'categoryIndex', 'difficultyIndex', 'completedIndex', 'themeIndex']) {
    assert.ok(wxml.includes(`data-filter="${filter}" bindchange="changeFilter"`));
  }
  assert.match(readFileSync('miniprogram/mock/game.ts', 'utf8'), /training\/training\?source=CURATED/);
  assert.match(readFileSync('miniprogram/pages/review/review.ts', 'utf8'), /source=REVIEW&gameId=/);
  const item = { id: 'intro-1', title: '夹吃', sourceKind: 'CURATED', catalogVersion: 2,
    trainingTags: ['CAPTURE', 'ENDGAME'], difficultyTag: 'EASY',
    difficultyBasis: { kind: 'LESSON_DESIGN', legalCandidateCount: 18, scoringDepth: 2 },
    progress: { completed: false, attemptCount: 0, latestResult: null },
    learningGoal: '找到夹吃机会',
    difficultyCalibration: { sampleCount: 2, firstTryCorrectCount: 1, minimumSamples: 20,
      status: 'COLLECTING', suggestedDifficulty: null } };
  page.render({ ...page.controller.snapshot, items: [item] });
  assert.equal(page.data.recommendedItem.id, item.id);
  const attempted = { ...item, id: 'continue-1', progress: { completed: false, attemptCount: 1, latestResult: 'SUBOPTIMAL' } };
  page.render({ ...page.controller.snapshot, items: [{ ...item, progress: { completed: true, attemptCount: 2, latestResult: 'CORRECT' } }, item, attempted] });
  assert.equal(page.data.recommendedItem.id, attempted.id, 'unfinished practiced question comes first');
  assert.equal(page.data.items[0].tagsText, '吃子 · 残局');
  assert.equal(page.data.items[0].difficultyText, '入门（教学分级）');
  assert.match(page.data.items[0].calibrationText, /待试玩校准.*2\/20/);
  page.render({ ...page.controller.snapshot, items: [{ ...item,
    difficultyCalibration: { ...item.difficultyCalibration, sampleCount: 20, firstTryCorrectCount: 10,
      status: 'CALIBRATED', suggestedDifficulty: 'NORMAL' } }] });
  assert.match(page.data.items[0].calibrationText, /试玩建议：进阶.*50%/);
  assert.match(wxml, /question.learningGoal/);
  assert.match(wxml, /answer.lessonExplanation/);
  assert.match(wxml, /item.tagsText/);
  assert.deepEqual(page.data.difficultyOptions.slice(1, 3), ['入门', '进阶']);
  const { createInitialGameState } = await import('../miniprogram/domain/index.ts');
  const q = { ...item, player: 'A', stateSnapshot: createInitialGameState() };
  const result = { id: 'feedback-1', result: 'SUBOPTIMAL', bestMoveEquivalent: false,
    submittedMove: { from: 'P11', to: 'P12' }, bestMove: { from: 'P11', to: 'P13' },
    feedback: '评分损失为 200 分。', lessonExplanation: '比较推荐路线，保留后续活动空间。' };
  page.render({ ...page.controller.snapshot, question: q, answer: null });
  assert.equal(page.data.answerReasonText, ''); assert.equal(page.data.bestMoveText, '');
  page.render({ ...page.controller.snapshot, question: q, answer: result });
  assert.equal(page.data.resultText, '还有更好的走法');
  assert.equal(page.data.answerReasonText, result.lessonExplanation);
  assert.match(page.data.bestMoveText, /P13/);
  const before = structuredClone(q.stateSnapshot);
  const requestCount = urls.length;
  const pieces = structuredClone(page.data.board.pieces);
  page.showAnswerRoute({ currentTarget: { dataset: { route: 'mine' } } });
  assert.equal(page.data.board.recommendedTo, 'P12');
  page.showAnswerRoute({ currentTarget: { dataset: { route: 'best' } } });
  assert.equal(page.data.board.recommendedTo, 'P13');
  assert.deepEqual(page.data.board.pieces, pieces);
  assert.deepEqual(q.stateSnapshot, before);
  assert.equal(urls.length, requestCount);
  page.render({ ...page.controller.snapshot, question: q, answer: result });
  assert.equal(page.data.board.recommendedTo, 'P13', 'supplementary refresh preserves chosen route');
  page.showAnswerRoute({ currentTarget: { dataset: { route: 'before' } } });
  assert.equal(page.data.board.recommendLine, undefined);
  assert.deepEqual(scrolls, [{ selector: '#training-feedback', duration: 250 }]);
  page.render({ ...page.controller.snapshot, question: q, answer: result });
  assert.equal(scrolls.length, 1, 'supplementary refresh does not scroll again');
  page.render({ ...page.controller.snapshot, question: null, answer: null });
  assert.equal(page.data.answerReasonText, ''); assert.equal(page.data.bestMoveText, '');
  assert.equal(page.data.recommendationNote, ''); assert.equal(page.data.resultText, '');
  assert.equal(page.data.boardPreviewRoute, 'before');
  assert.match(wxml, /wx:if="\{\{answer\}\}" id="training-feedback"/);
  page.onUnload();
});
