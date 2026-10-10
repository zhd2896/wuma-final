import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync,readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(s.startsWith('.')&&c.parentURL&&existsSync(new URL(s+'.ts',c.parentURL)))return n(new URL(s+'.ts',c.parentURL).href,c);throw e;}}});
const values=new Map<string,any>();let definition:any;const routes:string[]=[];
(globalThis as any).Page=(d:any)=>definition=d;
(globalThis as any).wx={getStorageSync:(k:string)=>values.get(k)??'',setStorageSync:(k:string,v:any)=>values.set(k,structuredClone(v)),removeStorageSync:(k:string)=>values.delete(k),showToast:()=>{},getAccountInfoSync:()=>({miniProgram:{envVersion:'develop'}}),navigateTo:(o:any)=>routes.push(o.url)};
const {createWxDeviceHistoryStore}=await import('../miniprogram/services/device-history.ts');
const {createLocalGameSession,tapLocalGameNode}=await import('../miniprogram/pages/game/local-game.ts');
const {API_BASE_URLS}=await import('../miniprogram/config/api-roots.ts');
let recordDefinition:any;
function storeScore() {
 let s=createLocalGameSession();s=tapLocalGameNode(tapLocalGameNode(s,'P01').session,'P02').session;
 createWxDeviceHistoryStore().record({id:'trial-readonly',mode:'local',state:s.gameState,turns:1,localScore:s.score});return s;
}
test('archive replays stored moves and never changes the saved score',async()=>{
 const s=storeScore();const saved=structuredClone(createWxDeviceHistoryStore().get('trial-readonly'));
 await import('../miniprogram/pages/record/record.ts');recordDefinition=definition;const p={...definition,data:structuredClone(definition.data),setData(d:any){Object.assign(this.data,d);}};
 p.onLoad({localId:'trial-readonly'});assert.equal(p.data.state,'success');assert.equal(p.data.max,1);
 p.next();assert.ok(p.data.board.pieces.some((piece:any)=>piece.nodeId==='P02'));p.previous();assert.equal(p.data.index,0);
 assert.deepEqual(createWxDeviceHistoryStore().get('trial-readonly'),saved);
 const wxml=readFileSync('miniprogram/pages/record/record.wxml','utf8');assert.doesNotMatch(wxml,/bind:node=/);
 assert.deepEqual(p.frames[1].state,s.gameState);
});
test('success or failure after cloud archive session expiry clears the old board and exposes retry',async()=>{
 const key=`wuma:wechat-session:v1:${API_BASE_URLS.development}`;
 for(const success of [true,false]) {
 values.set(key,{token:'a'.repeat(64),expiresAt:'2099-01-01T00:00:00Z'});
 let request:any;(globalThis as any).wx.request=(o:any)=>request=o;
 const p={...recordDefinition,data:structuredClone(recordDefinition.data),setData(d:any){Object.assign(this.data,d);}};
 const id='c'.repeat(32);p.recordOptions={gameId:id};const task=p.load();await new Promise(r=>setImmediate(r));
 values.set(key,{token:'a'.repeat(64),expiresAt:'2000-01-01T00:00:00Z'});
 if(success) {
  const {createInitialGameState}=await import('../miniprogram/domain/index.ts');
  request.success({statusCode:200,data:{code:0,data:{game_id:id,version:0,ply_count:0,initial_state:createInitialGameState(),steps:[]}}});
 } else request.fail({errMsg:'timeout'});
 await task;
 assert.equal(p.data.state,'error');assert.match(p.data.error,/登录|账号/);assert.equal(p.data.board,null);assert.deepEqual(p.frames,[]);
 }
 delete (globalThis as any).wx.request;
});
test('known linked trial remains archived when an older server omits sourceKind',async()=>{
 values.clear();routes.length=0;storeScore();values.set(`wuma:wechat-session:v1:${API_BASE_URLS.development}`,{token:'a'.repeat(64),expiresAt:'2099-01-01T00:00:00Z'});
 const store=createWxDeviceHistoryStore(),pending=store.beginLocalSync('trial-readonly','owner',API_BASE_URLS.development).localSync!;
 store.linkLocalSync('trial-readonly',pending,'c'.repeat(32));
 (globalThis as any).wx.request=(o:any)=>o.success({statusCode:200,data:{code:0,data:{items:[{gameId:'c'.repeat(32),mode:'LOCAL',status:'PLAYING',winner:null,startedAt:'2026-10-09T00:00:00Z',turns:1}],nextCursor:null}}});
 await import('../miniprogram/pages/history/history.ts');const p={...definition,data:structuredClone(definition.data),setData(d:any){Object.assign(this.data,d);}};p.onLoad({});await new Promise(r=>setImmediate(r));
 assert.equal(p.data.records.length,1);assert.equal(p.data.records[0].action,'查看棋谱');p.openRecord({currentTarget:{dataset:{id:'c'.repeat(32)}}});assert.match(routes.at(-1)!,/^\/pages\/record\//);
 delete (globalThis as any).wx.request;
});
