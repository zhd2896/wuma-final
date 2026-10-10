import test from 'node:test';
import assert from 'node:assert/strict';
import { growth } from './fixtures/growth.mts';
import { skill } from './fixtures/player-skill.mts';
import { growthPresentation, skillNextAction } from '../miniprogram/pages/profile/growth-presentation.ts';
test('attempts remain visible when every question is unsolved', () => {
  const g = growth(); g.recent.current.completed=0; g.recent.previous.completed=0;
  g.recent.previous.accuracy=null as any;
  g.daily.forEach(day=>day.completed=0);
  const view = growthPresentation(g as any).growthTrend!;
  assert.match(view.completionText,/尝试 3.*解出 0/);
  assert.ok(view.days.at(-1)!.attemptedHeight>0);
  assert.equal(view.days.at(-1)!.height,0);
  assert.match(view.accuracyText,/新.*周期|后续.*时段|继续积累/);
});
test('sample actions use real evidence types and never promise skill gains', () => {
  const metrics = skill(true).metrics;
  const reviewAction=skillNextAction(metrics[1] as any);
  assert.match(reviewAction.url,/filter=reviewable/);assert.match(reviewAction.note,/AI/);
  assert.match(skillNextAction({...metrics[0],value:null} as any).url,/mode=ai/);
  assert.match(skillNextAction({...metrics[5],value:null} as any).url,/training/);
  assert.equal(skillNextAction(metrics[0] as any).url,'');
});
