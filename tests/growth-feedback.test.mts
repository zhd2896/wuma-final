import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync,readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { profile } from './fixtures/player-skill.mts';
import { growth } from './fixtures/growth.mts';
registerHooks({resolve(s,c,n){try{return n(s,c)}catch(e){if(s.startsWith('.')&&c.parentURL&&existsSync(new URL(s+'.ts',c.parentURL)))return n(new URL(s+'.ts',c.parentURL).href,c);throw e}}});

test('profile growth tasks navigate to actual theme and level and clear on hide',async()=>{
 let definition:any;const urls:string[]=[];const storage=new Map();
 (globalThis as any).Page=(d:any)=>definition=d;
 (globalThis as any).wx={getStorageSync:(k:string)=>storage.get(k)??'',setStorageSync:(k:string,v:any)=>storage.set(k,v),getAccountInfoSync:()=>({miniProgram:{envVersion:'develop'}}),navigateTo:({url}:any)=>urls.push(url),request:(o:any)=>o.success({statusCode:200,data:{code:0,data:{...profile(),growth:growth()}}})};
 storage.set('wuma:wechat-session:v1:http://127.0.0.1:8000',{token:'a'.repeat(64),expiresAt:'2099-01-01T00:00:00Z'});
 await import('../miniprogram/pages/profile/profile.ts');
 const page:any={...definition,data:{...definition.data},setData(p:any){Object.assign(this.data,p)}};
 await page.load();
 assert.equal(page.data.state,'success');
 assert.equal(page.data.growthTasks?.[0]?.theme,'VULNERABILITY');
 assert.match(page.data.growthTasks[0].title,/再完成 2 题防守训练/);
 page.openGrowthTask({currentTarget:{dataset:{theme:'VULNERABILITY'}}});
 assert.equal(urls.at(-1),'/pages/training/training?source=CURATED&theme=VULNERABILITY&difficulty=EASY');
 assert.match(page.data.growthTrend.completionText,/多 1 题/);
 assert.match(page.data.growthTrend.accuracyText,/提高 34 个百分点/);
 page.onHide();assert.deepEqual(page.data.growthTasks,[]);assert.equal(page.data.growthTrend,null);
 page.openGrowthTask({currentTarget:{dataset:{theme:'VULNERABILITY'}}});assert.equal(urls.length,1);
 const markup=readFileSync('miniprogram/pages/profile/profile.wxml','utf8');
 assert.ok(markup.indexOf('下一步任务')<markup.indexOf('个人统计'));
 assert.match(markup,/近期训练趋势/);assert.match(markup,/openGrowthTask/);
});

test('training route synchronizes theme and difficulty pickers and backend filters',async()=>{
 let definition:any;const requests:string[]=[];
 (globalThis as any).Page=(d:any)=>definition=d;
 const storage=new Map([['wuma:wechat-session:v1:http://127.0.0.1:8000',{token:'a'.repeat(64),expiresAt:'2099-01-01T00:00:00Z'}]]);
 (globalThis as any).wx={getStorageSync:(k:string)=>storage.get(k)??'',getAccountInfoSync:()=>({miniProgram:{envVersion:'develop'}}),request:(o:any)=>{requests.push(o.url);o.success({statusCode:200,data:{code:0,data:{items:[],total:0,limit:20,offset:0}}})}};
 await import('../miniprogram/pages/training/training.ts');
 const make=()=>({...definition,data:{...definition.data},setData(p:any){Object.assign(this.data,p)}});
 const page=make();page.onLoad({source:'CURATED',theme:'VULNERABILITY',difficulty:'EASY'});
 await new Promise(r=>setImmediate(r));
 assert.equal(page.data.themeIndex,2);assert.equal(page.data.difficultyIndex,1);
 assert.match(requests.at(-1)!,/theme=VULNERABILITY/);assert.match(requests.at(-1)!,/difficulty=EASY/);
 page.onUnload();
 const invalid=make();invalid.onLoad({theme:'unknown',difficulty:'unknown'});await new Promise(r=>setImmediate(r));
 assert.equal(invalid.data.themeIndex,0);assert.equal(invalid.data.difficultyIndex,0);
 assert.doesNotMatch(requests.at(-1)!,/unknown/);invalid.onUnload();
});

test('growth rejects inconsistent totals and uses raw ratios for borderline practice',async()=>{
 const {parseGrowth}=await import('../miniprogram/services/growth-contract.ts');
 const {growthPresentation}=await import('../miniprogram/pages/profile/growth-presentation.ts');
 for(const mutate of [
  (g:any)=>g.recent.current.completed=0,
  (g:any)=>g.recent.current.attempted=10,
  (g:any)=>g.themes[0].completedThisWeek=10,
 ]) {const g=growth();mutate(g);assert.throws(()=>parseGrowth(g));}
 const g=growth();Object.assign(g.themes[0],{attempts:51,correct:38,accuracy:75,recommendedDifficulty:'EASY'});
 const parsed=parseGrowth(g);assert.ok(parsed);
 const task=growthPresentation(parsed).growthTasks.find(t=>t.theme==='CAPTURE')!;
 assert.equal(task.priority,true);assert.match(task.reason,/74.5%/);
 const priority=growthPresentation({...parsed!,themes:parsed!.themes.map(t=>t.theme==='VULNERABILITY'?{...t,remaining:0,completedThisWeek:2}:t)}).growthTasks;
 assert.equal(priority[0].theme,'VULNERABILITY','weak themes stay ahead of stronger unfinished tasks');
 assert.equal(parseGrowth(undefined),null);
 const days=growthPresentation(parsed).growthTrend!.days;
 assert.equal(days[12].label,'');assert.equal(days[13].label,'10/07');
});

test('late growth responses never repopulate a hidden or switched account; old servers stay usable',async()=>{
 let definition:any;const requests:any[]=[];
 const storage=new Map();const tokenKey='wuma:wechat-session:v1:http://127.0.0.1:8000';
 storage.set(tokenKey,{token:'a'.repeat(64),expiresAt:'2099-01-01T00:00:00Z'});
 (globalThis as any).Page=(d:any)=>definition=d;
 (globalThis as any).wx={getStorageSync:(k:string)=>storage.get(k)??'',removeStorageSync:(k:string)=>storage.delete(k),getAccountInfoSync:()=>({miniProgram:{envVersion:'develop'}}),reLaunch:()=>{},request:(o:any)=>requests.push(o)};
 await import('../miniprogram/pages/profile/profile.ts?growth-races');
 const page:any={...definition,data:{...definition.data},setData(p:any){Object.assign(this.data,p)}};
 const respond=(r:any,g:any)=>r.success({statusCode:200,data:{code:0,data:{...profile(),growth:g}}});
 let pending=page.load();await new Promise(r=>setImmediate(r));
 page.onHide();respond(requests.at(-1),growth());await pending;
 assert.deepEqual(page.data.growthTasks,[]);assert.equal(page.data.growthTrend,null);
 pending=page.load();await new Promise(r=>setImmediate(r));
 storage.set(tokenKey,{token:'b'.repeat(64),expiresAt:'2099-01-01T00:00:00Z'});
 respond(requests.at(-1),growth());await pending;
 assert.deepEqual(page.data.growthTasks,[]);
 pending=page.load();await new Promise(r=>setImmediate(r));respond(requests.at(-1),undefined);await pending;
 assert.equal(page.data.state,'success');assert.deepEqual(page.data.growthTasks,[]);
 pending=page.load();await new Promise(r=>setImmediate(r));respond(requests.at(-1),growth());await pending;
 assert.equal(page.data.growthTasks.length,3);page.logout();
 assert.deepEqual(page.data.growthTasks,[]);assert.equal(page.data.growthTrend,null);
});
