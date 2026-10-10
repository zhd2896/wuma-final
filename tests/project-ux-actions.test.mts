import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(s.startsWith('.')&&c.parentURL&&existsSync(new URL(s+'.ts',c.parentURL)))return n(new URL(s+'.ts',c.parentURL).href,c);throw e;}}});
const values=new Map<string,any>();let definition:any;
(globalThis as any).Page=(d:any)=>definition=d;
(globalThis as any).wx={getStorageSync:(k:string)=>values.get(k)??'',setStorageSync:(k:string,v:any)=>values.set(k,structuredClone(v)),removeStorageSync:(k:string)=>values.delete(k),showToast:()=>{},getAccountInfoSync:()=>({miniProgram:{envVersion:'develop'}})};
const make=()=>({...definition,data:structuredClone(definition.data),setData(p:any){Object.assign(this.data,p);}});
test('trial cancellation preserves draft and confirmed restart replaces it; resignation is explicit',async()=>{
 await import('../miniprogram/guide/pages/trial/trial.ts');values.clear();const p=make();p.onLoad();
 p.onNode({detail:{id:'P01'}});p.onNode({detail:{id:'P02'}});const original=values.get('wuma:trial-draft:v1');
 p.restart();assert.equal(p.data.showRestart,true);assert.deepEqual(values.get('wuma:trial-draft:v1'),original);
 p.cancelRestart();assert.deepEqual(values.get('wuma:trial-draft:v1'),original);
 p.restart();p.confirmRestart();assert.equal(p.data.turns,0);assert.notEqual(values.get('wuma:trial-draft:v1').id,original.id);
 p.resign();assert.equal(p.data.showResign,true);assert.equal(p.data.finished,false);p.cancelResign();assert.equal(p.data.finished,false);
 p.resign();p.confirmResign();assert.equal(p.data.finished,true);
});
test('formal restart preserves previous history and cancellation does not switch active game',async()=>{
 await import('../miniprogram/pages/game/game.ts');values.clear();const p=make();p.onLoad({mode:'local'});
 p.onNode({detail:{id:'P01'}});p.onNode({detail:{id:'P02'}});const old=p.data.localGameId;
 p.onAction({currentTarget:{dataset:{action:'restart'}}});assert.equal(p.data.showRestart,true);assert.equal(p.data.localGameId,old);
 p.cancelRestart();assert.equal(p.data.localGameId,old);p.requestRestart();p.confirmRestart();assert.notEqual(p.data.localGameId,old);
 const {createWxDeviceHistoryStore}=await import('../miniprogram/services/device-history.ts');assert.equal(createWxDeviceHistoryStore().get(old)?.turns,1);
});
test('AI undo and resignation describe the human operation, irrespective of side to move',async()=>{
 const p=make();const {createInitialGameState}=await import('../miniprogram/domain/index.ts');
 p.data.mode='ai';p.data.aiState={gameState:{...createInitialGameState(),current_player:'B'},plyCount:2,humanPlayer:'A'};
 p.undo();assert.match(p.data.undoMessage,/你.*电脑|你.*AI/);p.resign();assert.match(p.data.resignMessage,/你将认输/);
});
test('syncing a playing local score requires confirmation and cancelling keeps it editable',async()=>{
 await import('../miniprogram/pages/history/history.ts');values.clear();const p=make();
 const {createWxDeviceHistoryStore}=await import('../miniprogram/services/device-history.ts');
 const {createLocalGameSession}=await import('../miniprogram/pages/game/local-game.ts');const session=createLocalGameSession();
 const store=createWxDeviceHistoryStore();store.record({id:'local-confirm-sync',mode:'local',state:session.gameState,turns:0,localScore:session.score});
 await p.syncRecord({currentTarget:{dataset:{localId:'local-confirm-sync'}}});assert.equal(p.data.showSyncConfirm,true);assert.equal(store.get('local-confirm-sync')?.localSync,undefined);
 p.cancelSync();assert.equal(store.get('local-confirm-sync')?.localSync,undefined);
});
test('saved trial stays visibly archived instead of offering two-player continuation',async()=>{
 values.clear();const p=make();const {createWxDeviceHistoryStore}=await import('../miniprogram/services/device-history.ts');const {createLocalGameSession}=await import('../miniprogram/pages/game/local-game.ts');
 const session=createLocalGameSession();createWxDeviceHistoryStore().record({id:'trial-saved-score',mode:'local',state:session.gameState,turns:0,localScore:session.score});
 p.onLoad({});assert.equal(p.data.records[0].title,'电脑试玩棋谱');assert.equal(p.data.records[0].action,'查看棋谱');
});
test('history does not announce empty while cloud is loading; local rows survive failure and cloud retries in place', async()=>{
 const {API_BASE_URLS}=await import('../miniprogram/config/api-roots.ts');
 values.clear(); values.set(`wuma:wechat-session:v1:${API_BASE_URLS.development}`,{token:'a'.repeat(64),expiresAt:'2099-01-01T00:00:00Z'});
 const requests:any[]=[];(globalThis as any).wx.request=(o:any)=>requests.push(o);
 const p=make();p.onLoad({});assert.equal(p.data.state,'loading');assert.equal(p.data.cloudLoading,true);
 await new Promise(r=>setImmediate(r));requests.shift().fail({errMsg:'offline'});await new Promise(r=>setImmediate(r));assert.equal(p.data.cloudFailed,true);
 const {createWxDeviceHistoryStore}=await import('../miniprogram/services/device-history.ts');const {createLocalGameSession}=await import('../miniprogram/pages/game/local-game.ts');const session=createLocalGameSession();
 createWxDeviceHistoryStore().record({id:'local-survives',mode:'local',state:session.gameState,turns:0,localScore:session.score});
 p.retryCloud();assert.equal(p.data.records.length,1);assert.equal(p.data.cloudLoading,true);
 await new Promise(r=>setImmediate(r));requests.shift().success({statusCode:200,data:{code:0,data:{items:[],nextCursor:null}}});await new Promise(r=>setImmediate(r));
 assert.equal(p.data.cloudLoading,false);assert.equal(p.data.cloudFailed,false);assert.equal(p.data.records[0].id,'local-survives');
 p.changeFilter({detail:{value:'1'}});assert.equal(p.data.filter,'finished');
 delete (globalThis as any).wx.request;
});
test('retrying a partially loaded cloud list preserves it while waiting and after failure',async()=>{
 values.clear();const {API_BASE_URLS}=await import('../miniprogram/config/api-roots.ts');
 values.set(`wuma:wechat-session:v1:${API_BASE_URLS.development}`,{token:'a'.repeat(64),expiresAt:'2099-01-01T00:00:00Z'});
 const requests:any[]=[];(globalThis as any).wx.request=(o:any)=>requests.push(o);const p=make();p.onLoad({});
 await new Promise(r=>setImmediate(r));requests.shift().success({statusCode:200,data:{code:0,data:{items:[{gameId:'cloud-list',mode:'AI',status:'PLAYING',startedAt:'2026-10-09T00:00:00Z',turns:2,winner:null}],nextCursor:'next'}}});
 await new Promise(r=>setImmediate(r));assert.equal(p.data.records[0].id,'cloud-list');
 p.retryCloud();assert.equal(p.data.records[0].id,'cloud-list');await new Promise(r=>setImmediate(r));
 requests.shift().fail({errMsg:'timeout'});await new Promise(r=>setImmediate(r));assert.equal(p.data.records[0].id,'cloud-list');assert.equal(p.data.cloudFailed,true);
 delete (globalThis as any).wx.request;
});
