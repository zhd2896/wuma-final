import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync,readFileSync } from 'node:fs';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(s.startsWith('.')&&c.parentURL&&(e as any).code==='ERR_MODULE_NOT_FOUND'){const u=new URL(`${s}.ts`,c.parentURL);if(existsSync(u))return n(u.href,c);}throw e;}}});
const values=new Map<string,unknown>(),routes:string[]=[];
let definition:any;
(globalThis as any).Page=p=>{definition=p;};
(globalThis as any).wx={getAccountInfoSync:()=>({miniProgram:{envVersion: 'develop'}}),getStorageSync:k=>values.get(k)??'',setStorageSync:(k,v)=>values.set(k,structuredClone(v)),removeStorageSync:k=>values.delete(k),showToast:()=>{},navigateTo:o=>routes.push(o.url)};
await import('../miniprogram/pages/game/game.ts');
const gameDefinition=definition;
const make=(d:any)=>({...d,data:structuredClone(d.data),setData(p){this.data={...this.data,...p};}});
const {createWxDeviceHistoryStore}=await import('../miniprogram/services/device-history.ts');
const tap=(p:any,id:string)=>p.onNode({detail:{id}});

test('real local Page persists exact undo branch, reload, and blocks stale-page mutations when sync is pending',async()=>{
 values.clear();const p=make(gameDefinition);p.onLoad({mode:'local'});const id=p.data.localGameId;
 tap(p,'P01');tap(p,'P02');tap(p,'P05');tap(p,'P04');await p.confirmUndo();tap(p,'P10');tap(p,'P09');
 const store=createWxDeviceHistoryStore();const row=store.get(id);
 assert.deepEqual(row.localScore.moves,[{from:'P01',to:'P02'},{from:'P10',to:'P09'}]);
 p.onUnload();const reopened=make(gameDefinition);reopened.onLoad({mode:'local',gameId:id});
 assert.deepEqual(reopened.data.localSession.score,row.localScore);
 store.beginLocalSync(id,'original-owner','http://127.0.0.1:8000');
 const snapshot=structuredClone(reopened.data.localSession),beforeCount=store.list().length;
 tap(reopened,'P02');tap(reopened,'P01');await reopened.confirmUndo();await reopened.confirmResign();
 assert.deepEqual(reopened.data.localSession,snapshot);
 assert.equal(store.list().length,beforeCount);assert.equal(store.get(id).localSync.status,'pending');
 const frozen=structuredClone(store.get(id));reopened.restartLocalGame();
 assert.notEqual(reopened.data.localGameId,id);assert.equal(store.list().length,beforeCount+1);assert.deepEqual(store.get(id),frozen);
});

test('real history Page exposes catchtap sync and opens linked finished rows with server ID',async()=>{
 values.clear();routes.length=0;
 const p=make(gameDefinition);p.onLoad({mode:'local'});await p.confirmResign();const id=p.data.localGameId;
 const store=createWxDeviceHistoryStore();const pending=store.beginLocalSync(id,'owner','http://127.0.0.1:8000').localSync;
 store.linkLocalSync(id,pending,'d'.repeat(32));
 await import('../miniprogram/pages/history/history.ts');const h=make(definition);h.onLoad({});
 assert.equal(h.data.records.length,1);h.openRecord({currentTarget:{dataset:{id:h.data.records[0].id}}});
 assert.equal(routes.at(-1),`/pages/review/review?gameId=${'d'.repeat(32)}`);
 const wxml=readFileSync(new URL('../miniprogram/pages/history/history.wxml',import.meta.url),'utf8');
 assert.match(wxml,/catchtap="syncRecord"/);
});

await import('../miniprogram/pages/history/history.ts');
const historyDefinition=definition;
const {skill}=await import('./fixtures/player-skill.mts');
const profile=(id:string)=>({id,nickname:'棋手',games:0,finishedGames:0,wins:0,losses:0,remoteGames:0,remoteWins:0,remoteLosses:0,reviewedGames:0,training:0,trainingAttempts:0,correct:0,skillProfile:skill()});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('history real API flow renders pending/syncing, resumes exact body after timeout, and cloud wins dedup',async()=>{
 values.clear();const key='wuma:wechat-session:v1:http://127.0.0.1:8000';values.set(key,{token:'a'.repeat(64),expiresAt:'2099-01-01T00:00:00Z'});
 const p=make(gameDefinition);p.onLoad({mode:'local'});const id=p.data.localGameId;
 const sent:any[]=[];let importRequest:any;let cloud:any[]=[];
 (globalThis as any).wx.request=o=>{
  if(o.url.endsWith('/me/profile'))o.success({statusCode:200,data:{code:0,data:profile('owner')}});
  else if(o.url.includes('/me/games'))o.success({statusCode:200,data:{code:0,data:{items:cloud,nextCursor:null}}});
  else {importRequest=o;sent.push(structuredClone(o.data));}
 };
 const h=make(historyDefinition);h.onLoad({});await tick();
 const task=h.syncRecord({currentTarget:{dataset:{localId:id}}});await tick();
 assert.equal(createWxDeviceHistoryStore().get(id).localSync.status,'pending');
 assert.equal(h.data.records[0].syncLabel,'同步中');
 importRequest.fail({errMsg:'timeout'});await task;
 assert.equal(h.data.records[0].syncLabel,'重试同步');
 h.onUnload();const reopened=make(historyDefinition);reopened.onLoad({});await tick();
 const retry=reopened.syncRecord({currentTarget:{dataset:{localId:id}}});await tick();assert.deepEqual(sent[0],sent[1]);
 cloud=[{gameId:'e'.repeat(32),mode:'LOCAL',status:'PLAYING',winner:null,startedAt:'2026-10-06T00:00:00Z',finishedAt:null,turns:7,reviewAvailable:false}];
 importRequest.success({statusCode:200,data:{code:0,data:{game_id:'e'.repeat(32),mode:'LOCAL',version:0,ply_count:0}}});await retry;await tick();
 assert.equal(reopened.data.records.length,1);assert.equal(reopened.data.records[0].turns,7,'server continuation is authoritative');
 const old=make(gameDefinition);old.onLoad({mode:'local',gameId:id});await tick();
 assert.equal(old.data.mode,'remote');assert.ok(old.remoteController);old.onUnload();
 delete (globalThis as any).wx.request;
});

test('history ignores out-of-order account/filter responses and hidden-page results',async()=>{
 values.clear();const key='wuma:wechat-session:v1:http://127.0.0.1:8000';values.set(key,{token:'a'.repeat(64),expiresAt:'2099-01-01T00:00:00Z'});
 const pending:any[]=[];(globalThis as any).wx.request=o=>pending.push(o);
 const h=make(historyDefinition);h.onLoad({});await tick();const old=pending.shift();
 h.setData({filter:'finished'});h.load();await tick();const fresh=pending.shift();
 const entry=(id,status)=>({gameId:id,mode:'LOCAL',status,winner:status==='FINISHED'?'A':null,startedAt:'2026-10-06T00:00:00Z',finishedAt:null,turns:4,reviewAvailable:false});
 fresh.success({statusCode:200,data:{code:0,data:{items:[entry('new-account','FINISHED')],nextCursor:null}}});await tick();
 old.success({statusCode:200,data:{code:0,data:{items:[entry('old-filter','PLAYING')],nextCursor:null}}});await tick();
 assert.deepEqual(h.data.records.map(r=>r.id),['new-account']);
 h.load();await tick();const fromA=pending.shift();values.set(key,{token:'b'.repeat(64),expiresAt:'2099-01-01T00:00:00Z'});h.onShow();await tick();const fromB=pending.shift();
 fromA.success({statusCode:200,data:{code:0,data:{items:[entry('account-A','FINISHED')],nextCursor:null}}});await tick();assert.equal(h.data.records.length,0);
 fromB.success({statusCode:200,data:{code:0,data:{items:[entry('account-B','FINISHED')],nextCursor:null}}});await tick();assert.equal(h.data.records[0].id,'account-B');
 h.load();await tick();const hidden=pending.shift();h.onHide();hidden.success({statusCode:200,data:{code:0,data:{items:[entry('hidden','FINISHED')],nextCursor:null}}});await tick();assert.equal(h.data.records.length,0);
 delete (globalThis as any).wx.request;
});

test('history identity lookup uses captured token, shows syncing immediately, and refuses switched session before import',async()=>{
 values.clear();const key='wuma:wechat-session:v1:http://127.0.0.1:8000';values.set(key,{token:'a'.repeat(64),expiresAt:'2099-01-01T00:00:00Z'});
 const p=make(gameDefinition);p.onLoad({mode:'local'});const id=p.data.localGameId;
 let identity:any;const sent:any[]=[];(globalThis as any).wx.request=o=>{
 sent.push(o);if(o.url.endsWith('/me/profile'))identity=o;else if(o.url.includes('/me/games'))o.success({statusCode:200,data:{code:0,data:{items:[],nextCursor:null}}});
 };
 const h=make(historyDefinition);h.onLoad({});await tick();const syncing=h.syncRecord({currentTarget:{dataset:{localId:id}}});
 assert.equal(h.data.records[0].syncLabel,'同步中');await tick();assert.equal(identity.header.Authorization,`Bearer ${'a'.repeat(64)}`);
 values.set(key,{token:'b'.repeat(64),expiresAt:'2099-01-01T00:00:00Z'});
 identity.success({statusCode:200,data:{code:0,data:profile('owner-A')}});await syncing;
 assert.equal(sent.filter(o=>o.method==='POST').length,0);assert.equal(createWxDeviceHistoryStore().get(id).localSync,undefined);
 assert.equal(h.data.records[0].syncLabel,'同步棋谱');delete (globalThis as any).wx.request;
});

test('sync that outlives hide/show clears its busy projection when pending request times out',async()=>{
 values.clear();const key='wuma:wechat-session:v1:http://127.0.0.1:8000';values.set(key,{token:'a'.repeat(64),expiresAt:'2099-01-01T00:00:00Z'});
 const p=make(gameDefinition);p.onLoad({mode:'local'});const id=p.data.localGameId;let request:any;
 (globalThis as any).wx.request=o=>{
  if(o.url.endsWith('/me/profile'))o.success({statusCode:200,data:{code:0,data:profile('owner')}});
  else if(o.url.includes('/me/games'))o.success({statusCode:200,data:{code:0,data:{items:[],nextCursor:null}}});else request=o;
 };
 const h=make(historyDefinition);h.onLoad({});await tick();const task=h.syncRecord({currentTarget:{dataset:{localId:id}}});await tick();
 h.onHide();h.onShow();await tick();assert.equal(h.data.records[0].syncLabel,'同步中');
 request.fail({errMsg:'timeout'});await task;assert.equal(h.data.records[0].syncLabel,'重试同步');
 delete (globalThis as any).wx.request;
});

test('safe new local IDs never replace a frozen record even when clock and randomness repeat',()=>{
 values.clear();const savedNow=Date.now,savedRandom=Math.random;
 try {
  Date.now=()=>1000000000000;Math.random=()=>0.5;
  const p=make(gameDefinition);p.onLoad({mode:'local'});const id=p.data.localGameId;
  const store=createWxDeviceHistoryStore();store.beginLocalSync(id,'owner','http://127.0.0.1:8000');const frozen=structuredClone(store.get(id));
  p.restartLocalGame();assert.notEqual(p.data.localGameId,id);assert.deepEqual(store.get(id),frozen);assert.equal(store.list().length,2);
 } finally {Date.now=savedNow;Math.random=savedRandom;}
});

test('history cloud setup failure resolves with an error notice and keeps device rows usable',async()=>{
 values.clear();const p=make(gameDefinition);p.onLoad({mode:'local'});
 const h=make(historyDefinition);h.onLoad({});
 const wx=(globalThis as any).wx;const original=wx.getAccountInfoSync;wx.getAccountInfoSync=()=>({miniProgram:{envVersion:'release'}});
 try {await assert.doesNotReject(h.loadCloud(false));assert.equal(h.loadingCloud,false);assert.equal(h.data.records.length,1);assert.ok(h.data.errorMessage);}
 finally{wx.getAccountInfoSync=original;}
});
