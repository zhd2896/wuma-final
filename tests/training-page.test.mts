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

test('training page route and actual picker handlers send source game and filter requests', async () => {
  let definition: any;
  const urls: URL[] = [];
  (globalThis as any).Page = (page: any) => { definition = page; };
  (globalThis as any).wx = {
    getStorageSync: (key: string) => key.startsWith('wuma:wechat-session:')
      ? { token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' } : '',
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    request: (options: any) => { urls.push(new URL(options.url));
      options.success({ statusCode: 200, data: { code: 0, data: { items: [], total: 0 } } }); },
  };
  await import('../miniprogram/pages/training/training.ts');
  const page = { ...definition, data: { ...definition.data },
    setData(patch: any) { Object.assign(this.data, patch); } };
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
  page.onUnload();
});
