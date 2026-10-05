import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { createInitialGameState } from '../miniprogram/domain/index.ts';
import type { Move } from '../miniprogram/domain/index.ts';
import type { TrainingAnswerDto, TrainingQuestionDto } from '../miniprogram/services/api-contract.ts';

registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (specifier.startsWith('.') && context.parentURL &&
        (error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return nextResolve(url.href, context);
    }
    throw error;
  }
} });

const { TrainingController } = await import('../miniprogram/pages/training/training-controller.ts');

const question: TrainingQuestionDto = {
  id: 'training-1', player: 'A', stateSnapshot: createInitialGameState({ firstPlayer: 'A' }),
  sourceTurn: 1, sourceCategory: 'BLUNDER', trainingType: 'BEST_MOVE',
  trainingTags: ['CAPTURE'], difficultyTag: 'UNCALIBRATED',
};
const bestMove: Move = { from: 'P01', to: 'P02' };
const answer: TrainingAnswerDto = {
  id: 'record-1', trainingId: question.id, clientAttemptId: 'attempt-123',
  submittedMove: bestMove, legal: true, bestMoveEquivalent: true,
  bestMove, bestScore: 10, submittedMoveScore: 10, scoreLoss: 0,
  result: 'CORRECT', feedback: '达到最佳评分', searchDepth: 2,
  timedOut: false, hintLevelUsed: null, answeredAt: new Date().toISOString(),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('training question hides answer until server scores a legal board move', async () => {
  const pending = deferred<TrainingAnswerDto>();
  const submissions: { move: Move; attemptId: string }[] = [];
  const api = {
    list: async () => ({ items: [question], total: 1 }),
    get: async () => question,
    legalMoves: async () => ({ moves: [bestMove] }),
    answer: async (_id: string, move: Move, attemptId: string) => {
      submissions.push({ move, attemptId }); return pending.promise;
    },
    generate: async () => ({ items: [], total: 0 }),
  };
  const controller = new TrainingController(api, () => {}, () => 'attempt-123');
  await controller.enter();
  await controller.open(question.id);
  assert.equal(controller.snapshot.question?.id, question.id);
  assert.equal(controller.snapshot.answer, null);
  assert.equal(JSON.stringify(controller.snapshot.question).includes('bestMove'), false);
  await controller.tapNode(bestMove.from);
  assert.deepEqual(controller.snapshot.legalTargets, [bestMove.to]);
  const submission = controller.tapNode(bestMove.to);
  await controller.tapNode(bestMove.to);
  assert.equal(submissions.length, 1);
  assert.equal(controller.snapshot.answer, null);
  pending.resolve(answer);
  await submission;
  assert.equal(controller.snapshot.answer?.result, 'CORRECT');
  assert.equal(controller.snapshot.answer?.scoreLoss, 0);
  controller.dispose();
});

test('failed submission retries with the same attempt ID and leaves source snapshot unchanged', async () => {
  const attempts: string[] = [];
  const original = JSON.stringify(question.stateSnapshot);
  const api = {
    list: async () => ({ items: [question], total: 1 }),
    get: async () => question,
    legalMoves: async () => ({ moves: [bestMove] }),
    answer: async (_id: string, _move: Move, attemptId: string) => {
      attempts.push(attemptId);
      if (attempts.length === 1) throw new Error('network');
      return answer;
    },
    generate: async () => ({ items: [], total: 0 }),
  };
  const controller = new TrainingController(api, () => {}, () => 'attempt-123');
  await controller.enter();
  await controller.open(question.id);
  await controller.tapNode(bestMove.from);
  await controller.tapNode(bestMove.to);
  assert.equal(controller.snapshot.answer, null);
  assert.ok(controller.snapshot.errorMessage);
  await controller.retryAnswer();
  assert.deepEqual(attempts, ['attempt-123', 'attempt-123']);
  assert.equal(controller.snapshot.answer?.result, 'CORRECT');
  assert.equal(JSON.stringify(question.stateSnapshot), original);
  await controller.retryQuestion();
  assert.equal(controller.snapshot.answer, null);
  controller.dispose();
});

test('failed legal-target request can be retried from the question', async () => {
  let calls = 0;
  const api = {
    list: async () => ({ items: [question], total: 1 }),
    get: async () => question,
    legalMoves: async () => {
      calls++;
      if (calls === 1) throw new Error('network');
      return { moves: [bestMove] };
    },
    answer: async () => answer,
    generate: async () => ({ items: [], total: 0 }),
  };
  const controller = new TrainingController(api, () => {});
  await controller.enter();
  await controller.open(question.id);
  await controller.tapNode(bestMove.from);
  assert.ok(controller.snapshot.errorMessage);
  await controller.retry();
  assert.equal(calls, 2);
  assert.deepEqual(controller.snapshot.legalTargets, [bestMove.to]);
  controller.dispose();
});

test('more than twenty questions remain reachable from list and next action', async () => {
  const questions = Array.from({ length: 21 }, (_, index) => ({
    ...question, id: `training-${index + 1}`,
  }));
  const calls: number[] = [];
  const api = {
    list: async (limit = 20, offset = 0) => {
      calls.push(offset);
      return { items: questions.slice(offset, offset + limit), total: questions.length };
    },
    get: async (id: string) => questions.find(item => item.id === id)!,
    legalMoves: async () => ({ moves: [bestMove] }),
    answer: async () => answer,
    generate: async () => ({ items: [], total: 0 }),
  };
  const controller = new TrainingController(api, () => {});
  await controller.enter();
  assert.equal(controller.snapshot.items.length, 20);
  await controller.loadMore();
  assert.equal(controller.snapshot.items.length, 21);
  assert.deepEqual(calls, [0, 20]);
  await controller.open(questions[19].id);
  await controller.next();
  assert.equal(controller.snapshot.question?.id, questions[20].id);
  controller.dispose();
});

test('filter reset isolates stale initial list replies', async () => {
  const stale = deferred<any>();
  const calls: any[] = [];
  const api = {
    list: async (_limit = 20, offset = 0, filters: any = {}) => {
      calls.push({ offset, filters });
      if (calls.length === 1) return stale.promise;
      return { items: [{ ...question, id: 'fresh' }], total: 1 };
    },
    get: async () => question, legalMoves: async () => ({ moves: [bestMove] }),
    answer: async () => answer, generate: async () => ({ items: [], total: 0 }),
  };
  const controller = new TrainingController(api, () => {});
  const first = controller.enter();
  await controller.setFilters({ source: 'REVIEW', category: 'BLUNDER', source_game_id: 'game-a' });
  stale.resolve({ items: [question], total: 20 });
  await first;
  assert.deepEqual(controller.snapshot.items.map(item => item.id), ['fresh']);
  assert.equal(calls[1].offset, 0);
  assert.deepEqual(calls[1].filters, { source: 'REVIEW', category: 'BLUNDER', source_game_id: 'game-a' });
});

test('filter reset isolates stale pagination and clears the old load-more state', async () => {
  const more = deferred<any>();
  const oldItems = Array.from({ length: 20 }, (_, index) => ({ ...question, id: `old-${index}` }));
  const api = {
    list: async (_limit = 20, offset = 0, filters: any = {}) => {
      if (filters.source === 'REVIEW') return { items: [{ ...question, id: 'review-fresh' }], total: 1 };
      return offset ? more.promise : { items: oldItems, total: 21 };
    },
    get: async () => question, legalMoves: async () => ({ moves: [bestMove] }),
    answer: async () => answer, generate: async () => ({ items: [], total: 0 }),
  };
  const controller = new TrainingController(api, () => {});
  await controller.enter();
  const oldPage = controller.loadMore();
  await controller.setFilters({ source: 'REVIEW' });
  more.resolve({ items: [{ ...question, id: 'old-late' }], total: 21 });
  await oldPage;
  assert.deepEqual(controller.snapshot.items.map(item => item.id), ['review-fresh']);
  assert.equal(controller.snapshot.isLoadingMore, false);
});

test('answer syncs progress and next skips completed pages with an explicit end message', async () => {
  const completed = { ...question, id: 'done', progress: { attemptCount: 1, latestResult: 'CORRECT', completed: true } };
  const fresh = { ...question, id: 'fresh', progress: { attemptCount: 0, latestResult: null, completed: false } };
  const calls: number[] = [];
  const api = {
    list: async (_limit = 20, offset = 0) => {
      calls.push(offset);
      return offset ? { items: [fresh], total: 3 } : { items: [question, completed], total: 3 };
    },
    get: async (id: string) => id === 'fresh' ? fresh : question,
    legalMoves: async () => ({ moves: [bestMove] }), answer: async () => answer,
    generate: async () => ({ items: [], total: 0 }),
  };
  const controller = new TrainingController(api, () => {}, () => 'attempt-123');
  await controller.enter(); await controller.open(question.id);
  await controller.tapNode(bestMove.from); await controller.tapNode(bestMove.to);
  assert.equal(controller.snapshot.items[0].progress?.completed, true);
  assert.equal(controller.snapshot.items[0].progress?.attemptCount, 1);
  await controller.next();
  assert.equal(controller.snapshot.question?.id, 'fresh');
  assert.deepEqual(calls, [0, 2]);
  await controller.next();
  assert.equal(controller.snapshot.question, null);
  assert.match(controller.snapshot.noticeMessage || '', /暂无其他未完成/);
});

test('next from the final question wraps to an earlier incomplete question', async () => {
  const last = { ...question, id: 'last' };
  const api = { list: async () => ({ items: [question, last], total: 2 }),
    get: async (id: string) => id === 'last' ? last : question,
    legalMoves: async () => ({ moves: [bestMove] }), answer: async () => answer,
    generate: async () => ({ items: [], total: 0 }) };
  const controller = new TrainingController(api, () => {});
  await controller.enter(); await controller.open('last'); await controller.next();
  assert.equal(controller.snapshot.question?.id, question.id);
});

test('completing an incomplete filtered page keeps the following page first question reachable', async () => {
  const questions = Array.from({ length: 21 }, (_, index) => ({ ...question, id: `filtered-${index}`,
    progress: { attemptCount: 0, latestResult: null, completed: false } }));
  const calls: number[] = [];
  let answered = false;
  const api = {
    list: async (limit = 20, offset = 0) => {
      calls.push(offset);
      const remaining = answered ? questions.slice(1) : questions;
      return { items: remaining.slice(offset, offset + limit), total: remaining.length };
    },
    get: async (id: string) => questions.find(q => q.id === id)!,
    legalMoves: async () => ({ moves: [bestMove] }),
    answer: async () => { answered = true; return { ...answer, trainingId: questions[0].id }; },
    generate: async () => ({ items: [], total: 0 }),
  };
  const controller = new TrainingController(api, () => {});
  await controller.setFilters({ source: 'CURATED', completed: false });
  await controller.open(questions[0].id);
  await controller.tapNode(bestMove.from); await controller.tapNode(bestMove.to);
  await controller.open(questions[19].id); await controller.next();
  assert.equal(controller.snapshot.question?.id, questions[20].id);
  assert.deepEqual(calls, [0, 19]);
});
