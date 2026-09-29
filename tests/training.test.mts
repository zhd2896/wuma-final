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
