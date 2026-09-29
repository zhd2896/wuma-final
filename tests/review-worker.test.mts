import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { createInterface } from 'node:readline';
import { NODE_IDS, RuleEngine, createInitialGameState } from '../miniprogram/domain/index.ts';

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

test('Node worker returns exact historical move review without changing snapshots', async () => {
  const base = createInitialGameState({ firstPlayer: 'A' });
  const occupancy = { ...base.board.occupancy };
  for (const node of NODE_IDS) occupancy[node] = null;
  Object.assign(occupancy, { P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A' });
  const before = { ...base, board: { occupancy } };
  const move = { from: 'P19', to: 'P13' } as const;
  const after = RuleEngine.executeTurn(before, move).state;
  const original = JSON.stringify({ before, after });
  const worker = spawn(process.execPath, ['backend/engine_worker.mjs'],
    { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    const line = new Promise<string>((resolve, reject) => {
      createInterface({ input: worker.stdout }).once('line', resolve);
      worker.once('error', reject);
    });
    worker.stdin.write(JSON.stringify({ id: 1, command: 'review_move', payload: {
      state_before: before, state_after: after, actual_move: move,
      config: { max_depth: 2, time_limit_ms_per_move: 1000, candidate_limit: 3,
        good_max_loss: 0, normal_max_loss: 30, mistake_max_loss: 100 },
    } }) + '\n');
    const reply = JSON.parse(await line);
    assert.equal(reply.ok, true, JSON.stringify(reply.error));
    assert.equal(reply.data.actualMoveScore, reply.data.bestScore);
    assert.equal(reply.data.scoreLoss, 0);
    assert.equal(reply.data.category, 'GOOD');
    assert.equal(reply.data.evaluationAfter.scorePerspective, 'A');
    assert.equal(JSON.stringify({ before, after }), original);
  } finally {
    worker.kill();
  }
});
