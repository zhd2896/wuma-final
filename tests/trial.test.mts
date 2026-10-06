import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
registerHooks({ resolve(s,c,next) { try { return next(s,c); } catch(e) {
  if(s.startsWith('.') && c.parentURL && existsSync(new URL(`${s}.ts`,c.parentURL))) return next(new URL(`${s}.ts`,c.parentURL).href,c);
  throw e;
} } });

test('guest trial executes human then legal computer reply and restores from verified moves', async () => {
  const { TrialController } = await import('../miniprogram/guide/trial-controller.ts');
  const c = new TrialController(undefined, () => 0);
  c.tap('P05'); c.tap('P13');
  assert.equal(c.session.score?.moves.length,0);
  c.tap('P01'); c.tap('P02');
  assert.equal(c.session.score?.moves.length,2);
  assert.equal(c.session.gameState.current_player,'A');
  const draft=c.draft;
  const restored=new TrialController(JSON.parse(JSON.stringify(draft)),()=>0);
  assert.deepEqual(restored.session.gameState,c.session.gameState);
  assert.equal(restored.draft.id,draft.id);
  c.resign(); assert.equal(c.session.gameState.winner,'B');
  assert.equal(c.session.score?.resigningPlayer,'A');
  assert.deepEqual(new TrialController(c.draft).session.gameState,c.session.gameState);
  const ended=c.session; c.tap('P02'); assert.equal(c.session,ended);
});

test('trial rejects damaged, illegal, unfinished computer-turn and oversized drafts instead of trusting snapshots', async () => {
  const { TrialController } = await import('../miniprogram/guide/trial-controller.ts');
  const draft=new TrialController().draft;
  for(const value of [null, { ...draft, version:2 }, { ...draft, id:'bad' },
    { ...draft, score:{...draft.score, firstPlayer:'B'} },
    { ...draft, score:{...draft.score, moves:[{from:'P01',to:'P05'}]} },
    { ...draft, score:{...draft.score, moves:[{from:'P01',to:'P02'}]} },
    { ...draft, score:{...draft.score, resigningPlayer:'B'} },
    { ...draft, score:{...draft.score, moves:Array(2049).fill({from:'P01',to:'P02'})} }])
    assert.throws(()=>new TrialController(value),/试玩/);
});
