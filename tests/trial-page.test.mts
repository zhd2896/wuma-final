import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { skill } from './fixtures/player-skill.mts';
registerHooks({ resolve(s,c,next) { try { return next(s,c); } catch(e) {
  if(s.startsWith('.') && c.parentURL && existsSync(new URL(`${s}.ts`,c.parentURL))) return next(new URL(`${s}.ts`,c.parentURL).href,c);
  throw e;
} } });
const storage=new Map<string,any>();
const routes:string[]=[];
const requests:any[]=[];
let authenticated=false, loseReply=true, definition:any;
const draftKey='wuma:trial-draft:v1';
(globalThis as any).Page=(d:any)=>definition=d;
(globalThis as any).getCurrentPages=()=>[{route:'guide/pages/trial/trial',options:{}}];
(globalThis as any).wx={
  getAccountInfoSync:()=>({miniProgram:{envVersion:'develop'}}),
  getStorageSync:(k:string)=>k.startsWith('wuma:wechat-session:') && authenticated
    ? {token:'a'.repeat(64),expiresAt:'2099-01-01T00:00:00Z'}:storage.get(k),
  setStorageSync:(k:string,v:any)=>storage.set(k,structuredClone(v)), removeStorageSync:(k:string)=>storage.delete(k),
  showToast:()=>{}, reLaunch:(o:any)=>{routes.push(o.url);o.complete?.();},navigateTo:(o:any)=>routes.push(o.url),
  request:(o:any)=>{
    assert.equal(authenticated,true,'no requests before explicit login');
    const path=new URL(o.url).pathname;
    if(path==='/api/v1/me/profile') { o.success({statusCode:200,data:{code:0,data:{id:'owner-a',nickname:'棋友',avatar:'piece_v1_shi',games:0,finishedGames:0,wins:0,losses:0,remoteGames:0,remoteWins:0,remoteLosses:0,reviewedGames:0,training:0,trainingAttempts:0,correct:0,skillProfile:skill()}}}); return; }
    assert.equal(path,'/api/v1/game/import-local');
    requests.push(structuredClone(o.data));
    if(loseReply) o.fail({errMsg:'timeout'});
    else o.success({statusCode:200,data:{code:0,data:{game_id:'b'.repeat(32),mode:'LOCAL',version:o.data.moves.length,ply_count:o.data.moves.length}}});
  },
};
const make=()=>({...definition,data:{...definition.data},setData(v:any){this.data={...this.data,...v};}});
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};

test('guest plays without history/API, logs in only for save, retries immutable original score', async()=>{
  await import('../miniprogram/guide/pages/trial/trial.ts');
  const page=make(); page.onLoad({});
  page.onNode({detail:{id:'P01'}});page.onNode({detail:{id:'P02'}});
  assert.equal(page.data.turns,2);
  assert.equal(storage.has('wuma:history:v1'),false);
  assert.equal(requests.length,0);
  const draft=storage.get(draftKey);
  await page.save();
  assert.equal(new URL(`https://local${routes.pop()}`).searchParams.get('next'),'/guide/pages/trial/trial?save=1');
  page.onUnload(); authenticated=true;
  const returned=make();returned.onLoad({save:'1'});await settle();
  assert.equal(requests.length,1);
  assert.deepEqual(requests[0].moves,draft.score.moves);
  assert.equal(requests[0].clientGameId,draft.id);
  assert.equal(returned.data.locked,true);
  assert.equal(returned.data.saved,false);
  assert.ok(returned.data.errorMessage);
  const score=storage.get(draftKey).score;
  returned.onNode({detail:{id:'P02'}});returned.restart();
  assert.deepEqual(storage.get(draftKey).score,score,'pending save cannot mutate or discard trial');
  loseReply=false;await returned.save();
  assert.deepEqual(requests[0],requests[1]);
  assert.equal(returned.data.saved,true);
  assert.equal(storage.has(draftKey),false,'saved account record must not become next guest draft');
  returned.openHistory(); assert.equal(routes.pop(),'/pages/history/history');
  returned.restart();assert.equal(returned.data.turns,0);
  assert.equal(returned.data.locked,false);
});

test('bad trial draft is preserved and cannot be saved until explicitly restarted',()=>{
  const damaged={version:1,id:'trial-damaged123',score:{version:1,firstPlayer:'A',moves:[{from:'P01',to:'P05'}],resigningPlayer:null}};
  storage.set(draftKey,damaged);
  const p=make();p.onLoad({});
  assert.ok(p.data.errorMessage);
  assert.deepEqual(storage.get(draftKey),damaged);
  p.restart();assert.equal(p.data.turns,0);assert.notDeepEqual(storage.get(draftKey),damaged);
});

test('save refuses an existing same-ID record with a different score instead of silently importing it',async()=>{
  const p=make();p.onLoad({});
  p.onNode({detail:{id:'P01'}});p.onNode({detail:{id:'P02'}});
  const {createWxDeviceHistoryStore}=await import('../miniprogram/services/device-history.ts');
  const {createLocalGameSession}=await import('../miniprogram/pages/game/local-game.ts');
  const old=createLocalGameSession();
  createWxDeviceHistoryStore().record({id:storage.get(draftKey).id,mode:'local',state:old.gameState,turns:0,localScore:old.score});
  const before=requests.length;
  await p.save();
  assert.equal(requests.length,before);
  assert.match(p.data.errorMessage,/不一致/);
});
