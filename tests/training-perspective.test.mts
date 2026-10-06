import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(s.startsWith('.')&&c.parentURL&&(e as any).code==='ERR_MODULE_NOT_FOUND'){const u=new URL(`${s}.ts`,c.parentURL);if(existsSync(u))return n(u.href,c);}throw e;}}});
test('training page preserves review player through pagination and clears it on source change',async()=>{
  let def:any;const urls:URL[]=[];
  (globalThis as any).Page=(d:any)=>{def=d;};(globalThis as any).wx={getAccountInfoSync:()=>({miniProgram:{envVersion:'develop'}}),getStorageSync:(k:string)=>k.startsWith('wuma:wechat-session:')?{token:'a'.repeat(64),expiresAt:'2099-01-01T00:00:00Z'}:'',request(o:any){urls.push(new URL(o.url));o.success({statusCode:200,data:{code:0,data:{items:[],total:2}}});}};
  await import('../miniprogram/pages/training/training.ts');const p={...def,data:structuredClone(def.data),setData(d:any){Object.assign(this.data,d);}};
  const settle=async()=>{for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));};
  p.onLoad({source:'REVIEW',gameId:'g1',player:'B'});await settle();assert.equal(urls[0].searchParams.get('player'),'B');
  p.loadMore();await settle();assert.equal(urls.at(-1)!.searchParams.get('player'),'B');
  p.changeFilter({currentTarget:{dataset:{filter:'categoryIndex'}},detail:{value:'1'}});await settle();assert.equal(urls.at(-1)!.searchParams.get('player'),'B');
  p.changeFilter({currentTarget:{dataset:{filter:'sourceIndex'}},detail:{value:'0'}});await settle();
  assert.equal(urls.at(-1)!.searchParams.has('player'),false);assert.equal(urls.at(-1)!.searchParams.has('source_game_id'),false);
  p.changeFilter({currentTarget:{dataset:{filter:'sourceIndex'}},detail:{value:'1'}});await settle();assert.equal(urls.at(-1)!.searchParams.has('player'),false);p.onUnload();
});

test('controller source change drops obsolete review game and perspective filters', async()=>{
  const {TrainingController}=await import('../miniprogram/pages/training/training-controller.ts');
  const calls:any[]=[];const controller=new TrainingController({list:async(_limit:number,_offset:number,filters:any)=>{calls.push(filters);return{items:[],total:0};}} as any,()=>{});
  await controller.setFilters({source:'REVIEW',source_game_id:'g1',player:'B',category:'BLUNDER'});
  await controller.setFilters({...controller.snapshot.filters,source:'CURATED'});
  assert.deepEqual(calls.at(-1),{source:'CURATED'});assert.equal(controller.snapshot.filters.player,undefined);
  controller.dispose();
});
