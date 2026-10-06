import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
registerHooks({ resolve(s,c,n) { try { return n(s,c); } catch(e) { if (s.startsWith('.') && c.parentURL && (e as any).code === 'ERR_MODULE_NOT_FOUND') { const u = new URL(`${s}.ts`,c.parentURL); if(existsSync(u)) return n(u.href,c); } throw e; } } });
const { createLocalGameSession, tapLocalGameNode, undoLocalGame, resignLocalGame } = await import('../miniprogram/pages/game/local-game.ts');
const { createDeviceHistoryStore } = await import('../miniprogram/services/device-history.ts');
function move(s:any, from:string,to:string) { return tapLocalGameNode(tapLocalGameNode(s,from).session,to).session; }
test('complete local score retains exact valid branch and resignation across reopen without shared references', () => {
  let s = createLocalGameSession('A');
  assert.deepEqual(s.score, { version:1, firstPlayer:'A', moves:[], resigningPlayer:null });
  s = move(s,'P01','P02'); s = move(s,'P05','P04');
  const prior = s; s = undoLocalGame(s); s = move(s,'P10','P09');
  assert.deepEqual(s.score.moves, [{from:'P01',to:'P02'},{from:'P10',to:'P09'}]);
  assert.equal(prior.score.moves.length,2);
  s = resignLocalGame(s); assert.equal(s.score.resigningPlayer,'A');
  const values = new Map(); const storage = { get:k=>values.get(k), set:(k,v)=>values.set(k,v), remove:k=>values.delete(k) };
  let store = createDeviceHistoryStore(storage);
  store.record({id:'local-score-test',mode:'local',state:s.gameState,turns:2,localScore:s.score});
  const reopened = createDeviceHistoryStore(storage).get('local-score-test');
  assert.deepEqual(reopened.localScore,s.score);
  (s.score.moves[0] as any).to = 'P29';
  assert.equal(store.get('local-score-test').localScore.moves[0].to,'P02');
  (reopened.localScore.moves[0] as any).to = 'P29';
  assert.equal(store.get('local-score-test').localScore.moves[0].to,'P02');
});

test('pending sync freezes durable exact score and ignores UI metadata rewrites', () => {
  const values=new Map(); const storage={get:k=>values.get(k),set:(k,v)=>values.set(k,v),remove:k=>values.delete(k)};
  const store=createDeviceHistoryStore(storage); let s=move(createLocalGameSession(),'P01','P02');
  store.record({id:'local-pending-1',mode:'local',state:s.gameState,turns:1,localScore:s.score});
  const row=store.beginLocalSync('local-pending-1','owner-one','http://api-one');
  assert.equal(row.localSync.status,'pending'); assert.equal(row.localSync.payload.moves.length,1);
  assert.throws(()=>store.record({id:row.id,mode:'local',state:undoLocalGame(s).gameState,turns:0,localScore:undoLocalGame(s).score}),/同步/);
  const reopened=createDeviceHistoryStore(storage);
  assert.deepEqual(reopened.get(row.id).localSync,row.localSync);
  assert.throws(()=>reopened.beginLocalSync(row.id,'owner-two','http://api-one'),/账号/);
  assert.throws(()=>reopened.beginLocalSync(row.id,'owner-one','http://api-two'),/服务/);
  row.localSync.payload.moves[0].to='P29';
  assert.equal(reopened.get(row.id).localSync.payload.moves[0].to,'P02');
  const pending=reopened.get(row.id).localSync;
  reopened.linkLocalSync(row.id,pending,'a'.repeat(32));
  assert.equal(reopened.get(row.id).localSync.cloudGameId,'a'.repeat(32));
  assert.throws(()=>store.record({id:row.id,mode:'local',state:s.gameState,turns:1,localScore:s.score}),/云端/);
});

test('legacy snapshot remains resumable but new later moves never invent the missing score prefix', () => {
 const values=new Map();const store=createDeviceHistoryStore({get:k=>values.get(k),set:(k,v)=>values.set(k,v),remove:k=>values.delete(k)});
 let s=move(createLocalGameSession(),'P01','P02');const {score,...legacy}=s;
 store.record({id:'legacy-score-1',mode:'local',state:legacy.gameState,turns:1,lastMove:legacy.lastMove,localUndoFrame:legacy.undoFrame});
 assert.throws(()=>store.beginLocalSync('legacy-score-1','owner','http://api'),/完整棋谱/);
 const next=move(legacy,'P05','P04');assert.equal(next.score,undefined);
 assert.equal(undoLocalGame(legacy).gameState.current_player,'A');
});

test('sync service persists pending before sending, retries original body after restart, and binds account/root context', async () => {
 const values=new Map();const store=createDeviceHistoryStore({get:k=>values.get(k),set:(k,v)=>values.set(k,structuredClone(v)),remove:k=>values.delete(k)});
 const s=move(createLocalGameSession(),'P01','P02'); store.record({id:'local-service-1',mode:'local',state:s.gameState,turns:1,localScore:s.score});
 let owner='owner-one',root='http://api-one',token='a'.repeat(64),loseReply=true,failLink=false;
 const requests:any[]=[];
 const client={request:async(method,path,body)=>{
  if(path==='/api/v1/me/profile') return {id:owner};
  assert.equal(store.get('local-service-1').localSync.status,'pending'); requests.push(structuredClone(body));
  if(loseReply) throw new Error('timeout');
  return {game_id:'b'.repeat(32),mode:'LOCAL',version:1,ply_count:1};
 }};
 const module=await import('../miniprogram/services/local-score-sync.ts');
 const run=()=>module.syncLocalScore('local-service-1',{store,context:()=>({root,token}),profile:async()=>({id:owner}),client:()=>client});
 await assert.rejects(run(),/timeout/); const pending=store.get('local-service-1').localSync;
 assert.equal(JSON.stringify(pending).includes(token),false);
 owner='owner-two';token='c'.repeat(64);await assert.rejects(run(),/原账号/);assert.equal(requests.length,1);
 owner='owner-one';root='http://api-two';await assert.rejects(run(),/原服务地址/);assert.equal(requests.length,1);
 root='http://api-one';loseReply=false;
 const linked=await run(); assert.equal(linked.localSync.cloudGameId,'b'.repeat(32));assert.deepEqual(requests[0],requests[1]);
});

test('sync write failures preserve exact pending and a token/root change during identity lookup sends no import',async()=>{
 const values=new Map();let failWrite=false;const storage={get:k=>values.get(k),set:(k,v)=>{if(failWrite){failWrite=false;throw new Error('disk full');}values.set(k,structuredClone(v));},remove:k=>values.delete(k)};
 const store=createDeviceHistoryStore(storage);const s=createLocalGameSession();
 store.record({id:'local-write-fail',mode:'local',state:s.gameState,turns:0,localScore:s.score});
 let root='http://one',token='token-one',requests=0;
 const m=await import('../miniprogram/services/local-score-sync.ts');
 const options={store,context:()=>({root,token}),profile:async()=>({id:'owner'}),client:()=>({request:async()=>{requests++;failWrite=true;return {game_id:'c'.repeat(32),mode:'LOCAL',version:0,ply_count:0};}})};
 failWrite=true;await assert.rejects(m.syncLocalScore('local-write-fail',options),/disk full/);assert.equal(requests,0);assert.equal(store.get('local-write-fail').localSync,undefined);
 await assert.rejects(m.syncLocalScore('local-write-fail',options),/disk full/);assert.equal(requests,1);assert.equal(store.get('local-write-fail').localSync.status,'pending');
 const pending=store.get('local-write-fail').localSync;
 const row=await m.syncLocalScore('local-write-fail',{...options,client:()=>({request:async(_,__,body)=>{requests++;assert.deepEqual(body,pending.payload);return {game_id:'c'.repeat(32),mode:'LOCAL',version:0,ply_count:0};}})});
 assert.equal(row.localSync.status,'linked');
 store.record({id:'local-context-1',mode:'local',state:s.gameState,turns:0,localScore:s.score});
 const changed={...options,profile:async()=>{token='another-session';return {id:'owner'};}};
 await assert.rejects(m.syncLocalScore('local-context-1',changed),/账号或服务地址已改变/);assert.equal(requests,2);assert.equal(store.get('local-context-1').localSync,undefined);
});
