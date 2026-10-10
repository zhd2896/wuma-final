import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, resolve, relative } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
registerHooks({ resolve(s,c,next) { try { return next(s,c); } catch(e) {
  if(s.startsWith('.') && c.parentURL && existsSync(new URL(`${s}.ts`,c.parentURL))) return next(new URL(`${s}.ts`,c.parentURL).href,c);
  throw e;
} } });
const { getApiBaseUrl } = await import('../miniprogram/config/api.ts');
const { createInitialGameState } = await import('../miniprogram/domain/index.ts');
const { createWxDeviceHistoryStore, HISTORY_STORAGE_KEY } = await import('../miniprogram/services/device-history.ts');
const { TrialController } = await import('../miniprogram/guide/trial-controller.ts');
const { openTab } = await import('../miniprogram/utils/navigation.ts');
const { isPublicRoute, safeReturnRoute } = await import('../miniprogram/services/auth-navigation.ts');
let definition:any;
(globalThis as any).Page = (d:any) => definition=d;
await import('../miniprogram/pages/index/index.ts');
const homeDefinition=definition;

test('home starts with only the main package loaded, before visiting guide pages',()=>{
  const mini=resolve('miniprogram');
  const app=JSON.parse(readFileSync(`${mini}/app.json`,'utf8'));
  const roots=app.subPackages.map((pkg:any)=>`${pkg.root}/`);
  const modules=new Map<string,any>();
  let home:any;
  function load(file:string):any {
    const id=relative(mini,file).replaceAll('\\','/');
    assert.ok(!roots.some((root:string)=>id.startsWith(root)),`module '${id}' is unavailable before its subpackage loads`);
    if(modules.has(file)) return modules.get(file).exports;
    const module={exports:{}};modules.set(file,module);
    const code=ts.transpileModule(readFileSync(file,'utf8'),{
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
    }).outputText;
    runInNewContext(code,{
      module,exports:module.exports,
      require:(specifier:string)=>load(resolve(dirname(file),`${specifier}.ts`)),
      Page:(value:any)=>{home=value;},
      wx:{getStorageSync:()=>'',getAccountInfoSync:()=>({miniProgram:{envVersion:'develop'}})},
    },{filename:id});
    return module.exports;
  }
  load(resolve(mini,'pages/index/index.ts'));
  assert.ok(home,'home page must register successfully');
  home.setData=(patch:any)=>Object.assign(home.data,patch);
  home.onShow();
  assert.equal(home.data.continuations.length,0);
});
function environment(loggedIn=false) {
  const storage=new Map<string,unknown>(); const routes:string[]=[];
  let current='pages/index/index'; let version='develop';
  (globalThis as any).getCurrentPages=()=>[{route:current,options:{}}];
  (globalThis as any).wx={
    getAccountInfoSync:()=>({miniProgram:{envVersion:version}}),
    getStorageSync:(key:string)=>storage.get(key)??'',
    setStorageSync:(key:string,value:unknown)=>storage.set(key,value),
    removeStorageSync:(key:string)=>storage.delete(key),
    navigateTo:(o:any)=>routes.push(o.url), reLaunch:(o:any)=>{routes.push(o.url);o.complete?.();},
    request:()=>{throw Error('browse must not fetch');},login:()=>{throw Error('browse must not log in');},
  };
  if(loggedIn) storage.set(`wuma:wechat-session:v1:${getApiBaseUrl()}`,{token:'a'.repeat(64),expiresAt:'2099-01-01T00:00:00Z'});
  const page={...homeDefinition,data:{...homeDefinition.data},setData(patch:any){this.data={...this.data,...patch};}};
  return {storage,routes,page,setRoute(v:string){current=v;},release(){version='release';}};
}
function local(id='local-valid-game',updated=100) {
  const row=createWxDeviceHistoryStore().record({id,mode:'local',state:createInitialGameState(),turns:0});
  return {...row,startedAt:updated,updatedAt:updated};
}
function rows(records:any[]){(globalThis as any).wx.setStorageSync(HISTORY_STORAGE_KEY,{version:1,records});}
function server(id:string,mode='ai',updated=200){return {id,mode,aiLevel:mode==='ai'?'BEGINNER':undefined,startedAt:updated,updatedAt:updated,turns:6,status:'PLAYING',winner:null,winnerReason:null};}

test('learning is registered, public, and preserved as a login return destination',()=>{
  const app=JSON.parse(readFileSync('miniprogram/app.json','utf8'));
  assert.ok(app.pages.includes('pages/learning/learning'));
  assert.equal(isPublicRoute('/pages/learning/learning'),true);
  assert.equal(safeReturnRoute('/pages/learning/learning'),'/pages/learning/learning');
  const nav=readFileSync('miniprogram/components/bottom-nav/bottom-nav.wxml','utf8');
  assert.match(nav,/data-route="\/pages\/learning\/learning"/);
  assert.match(readFileSync('miniprogram/pages/coach/coach.wxml','utf8'),/bottom-nav current="learning"/);
});
test('tapping the current bottom route preserves page context',()=>{
  const env=environment();openTab('/pages/index/index');assert.deepEqual(env.routes,[]);
  env.setRoute('guide/pages/tutorial/tutorial');openTab('/pages/index/index');assert.deepEqual(env.routes,['/pages/index/index']);
});
test('a newcomer can browse tutorial and trial in release without an API deployment',()=>{
  const env=environment();env.release();env.page.onShow();
  assert.deepEqual(env.page.data.continuations,[]);
  env.page.openTutorial();env.page.openTrial();
  assert.deepEqual(env.routes,['/guide/pages/tutorial/tutorial','/guide/pages/trial/trial']);
  const wxml=readFileSync('miniprogram/pages/index/index.wxml','utf8');
  assert.match(wxml,/<button[^>]*id="tutorial-primary"[^>]*bindtap="openTutorial"/);
  assert.match(wxml,/<button[^>]*id="guest-trial"[^>]*bindtap="openTrial"/);
  assert.equal(/<view wx:if="{{!loggedIn}}"[^>]*>[\s\S]*id="guest-trial"[\s\S]*?<\/view>/.test(wxml),false);
});
test('valid tutorial checkpoints continue the actual lesson and completed/invalid data makes no card',()=>{
  const env=environment();env.storage.set('wuma:tutorial:v2',{version:2,stepIndex:4});env.page.onShow();
  assert.equal(env.page.data.continuations[0].kind,'tutorial');assert.match(env.page.data.continuations[0].detail,/5.*7/);
  for(const value of [{version:2,stepIndex:7},{version:2,stepIndex:8},{version:2,stepIndex:1.5},{version:1,stepIndex:2},'bad']){
    env.storage.set('wuma:tutorial:v2',value);env.page.onShow();assert.deepEqual(env.page.data.continuations,[]);
  }
});
test('a completed legacy three-lesson checkpoint continues the first added lesson',()=>{
  const env=environment();env.storage.set('wuma:tutorial:v1',{version:1,stepIndex:3});env.page.onShow();
  assert.match(env.page.data.continuations[0].detail,/4.*7/);
});
test('trial continuation uses replay-validated drafts, and hides archived or finished trials',()=>{
  const env=environment();const trial=new TrialController();trial.tap('P11');trial.tap('P12');
  env.storage.set('wuma:trial-draft:v1',trial.draft);env.page.onShow();
  assert.equal(env.page.data.continuations[0].kind,'trial');assert.match(env.page.data.continuations[0].detail,/电脑试玩.*2 手/);
  const session=trial.session;createWxDeviceHistoryStore().record({id:trial.id,mode:'local',state:session.gameState,turns:session.score!.moves.length,localScore:session.score});
  env.page.onShow();assert.deepEqual(env.page.data.continuations,[],'any archived trial is locked by the trial page');
  env.storage.delete(HISTORY_STORAGE_KEY);trial.resign();env.storage.set('wuma:trial-draft:v1',trial.draft);env.page.onShow();assert.deepEqual(env.page.data.continuations,[]);
  env.storage.set('wuma:trial-draft:v1',{version:1,id:'trial-invalid-id',score:{version:1,firstPlayer:'A',moves:[{from:'P01',to:'P05'}],resigningPlayer:null}});
  env.page.onShow();assert.deepEqual(env.page.data.continuations,[]);
});
test('only the recent valid playable local row is offered, with an explicit ID and login gate',()=>{
  const env=environment();const recent=local('local-recent-game',200),older=local('local-older-game',100);rows([older,recent]);
  env.storage.set('activeLocalGameId','missing-garbage');env.page.onShow();
  assert.equal(env.page.data.continuations.length,1);const card=env.page.data.continuations[0];
  assert.equal(card.route,'/pages/game/game?mode=local&gameId=local-recent-game');assert.match(card.detail,/同机双人.*0 手/);
  env.page.continueActivity({currentTarget:{dataset:{id:card.id}}});
  assert.equal(new URL(`https://local${env.routes[0]}`).searchParams.get('next'),card.route);
});
test('linked or pending local scores cannot be offered as playable, even through active keys',()=>{
  const env=environment();const row=local();
  for(const sync of [{status:'linked',ownerId:'owner',apiRoot:'https://example.test',cloudGameId:'a'.repeat(32)},
    {status:'pending',ownerId:'owner',apiRoot:'https://example.test',payload:{clientGameId:row.id,firstPlayer:'A',moves:[],resigningPlayer:null}}]){
    rows([{...row,localScore:{version:1,firstPlayer:'A',moves:[],resigningPlayer:null},localSync:sync}]);
    env.storage.set('activeLocalGameId',row.id);env.page.onShow();assert.deepEqual(env.page.data.continuations,[]);
  }
});
test('server continuations require authentication, valid history, and valid server IDs',()=>{
  const id='b'.repeat(32);const env=environment();rows([server(id)]);env.storage.set('activeAiGameId',id);env.page.onShow();assert.deepEqual(env.page.data.continuations,[]);
  const authenticated=environment(true);rows([server(id),server('not-server-uuid','ai',300)]);authenticated.storage.set('activeAiGameId',id);authenticated.page.onShow();
  assert.equal(authenticated.page.data.continuations[0].route,`/pages/game/game?mode=ai&gameId=${id}`);
  assert.match(authenticated.page.data.continuations[0].detail,/与电脑.*入门.*6 手/);
  authenticated.storage.set('activeAiGameId','missing');authenticated.page.onShow();assert.deepEqual(authenticated.page.data.continuations,[]);
});
test('valid active online rows open the existing room without creating a game',()=>{
  const env=environment(true),id='c'.repeat(32);rows([server(id,'online')]);env.storage.set('wuma:online:active',id);env.page.onShow();
  assert.equal(env.page.data.continuations[0].route,`/pages/online/online?gameId=${id}`);
});
test('storage damage is isolated from teaching and trial browsing',()=>{
  const env=environment();env.storage.set('wuma:tutorial:v2',{version:2,stepIndex:2});env.storage.set(HISTORY_STORAGE_KEY,{version:1,records:'broken'});
  env.page.onShow();assert.equal(env.page.data.continuations[0].kind,'tutorial');
  (globalThis as any).wx.getStorageSync=()=>{throw Error('storage unavailable');};env.page.onShow();assert.deepEqual(env.page.data.continuations,[]);
  env.page.openTutorial();assert.equal(env.routes.pop(),'/guide/pages/tutorial/tutorial');
});
test('continue actions ignore stale IDs and revalidate a newly archived trial',()=>{
  const env=environment();const trial=new TrialController();env.storage.set('wuma:trial-draft:v1',trial.draft);env.page.onShow();const id=env.page.data.continuations[0].id;
  const session=trial.session;createWxDeviceHistoryStore().record({id:trial.id,mode:'local',state:session.gameState,turns:0,localScore:session.score});
  env.page.continueActivity({currentTarget:{dataset:{id}}});env.page.continueActivity({currentTarget:{dataset:{id:'forged'}}});assert.deepEqual(env.routes,[]);
});
test('learning gateway opens public lessons and trial for guests and protects coach and training',async()=>{
  assert.ok(existsSync('miniprogram/pages/learning/learning.ts'),'public learning gateway must exist');
  const env=environment();env.release();await import('../miniprogram/pages/learning/learning.ts');
  definition.openRules();definition.openTutorial();definition.openTrial();definition.openTraining();definition.openCoach();
  assert.deepEqual(env.routes.slice(0,3),['/guide/pages/rules/rules','/guide/pages/tutorial/tutorial','/guide/pages/trial/trial']);
  assert.equal(new URL(`https://local${env.routes[3]}`).searchParams.get('next'),'/pages/training/training?source=CURATED');
  assert.equal(new URL(`https://local${env.routes[4]}`).searchParams.get('next'),'/pages/coach/coach');
});
test('home mode labels describe players and the computer entry explicitly starts a new game',()=>{
  const env=environment();
  assert.equal(env.page.data.features.find((f:any)=>f.id==='game').title,'与电脑');
  assert.match(env.page.data.features.find((f:any)=>f.id==='game').route,/mode=ai&new=1/);
  assert.equal(env.page.data.features.find((f:any)=>f.id==='local').title,'同机双人');
  assert.equal(env.page.data.features.find((f:any)=>f.id==='remote').title,'联机对弈');
});
