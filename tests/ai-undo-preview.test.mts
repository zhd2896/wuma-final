import test from 'node:test';
import assert from 'node:assert/strict';
import { aiUndoCount } from '../miniprogram/utils/ai-undo-preview.ts';
test('AI undo previews zero before the first human move and one or two after it for either side',()=>{
 for(const human of ['A','B'] as const) {
  const ai=human==='A'?'B':'A';
  assert.equal(aiUndoCount({first_player:ai,current_player:human},1,human),0);
  assert.equal(aiUndoCount({first_player:ai,current_player:ai},2,human),1);
  assert.equal(aiUndoCount({first_player:ai,current_player:human},3,human),2);
  assert.equal(aiUndoCount({first_player:human,current_player:ai},1,human),1);
  assert.equal(aiUndoCount({first_player:human,current_player:human},2,human),2);
  assert.equal(aiUndoCount({first_player:human,current_player:human},0,human),0);
 }
});
