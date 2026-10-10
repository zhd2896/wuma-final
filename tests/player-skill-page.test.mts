import { API_BASE_URLS } from '../miniprogram/config/api-roots.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { profile, skill } from './fixtures/player-skill.mts';
registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (specifier.startsWith('.') && context.parentURL && (error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return nextResolve(url.href, context);
    }
    throw error;
  }
} });
let definition: Record<string, any>;
async function harness(deferred = false, payload: any = profile()) {
  const storage = new Map<string, unknown>(); const requests: any[] = [];
  (globalThis as any).Page = (page: Record<string, any>) => { definition = page; };
  (globalThis as any).wx = {
    getStorageSync: (key: string) => storage.get(key) ?? '',
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    request: (options: any) => {
      requests.push(options);
      if (!deferred) options.success({ statusCode: 200, data: { code: 0, data: payload } });
    },
  };
  await import('../miniprogram/pages/profile/profile.ts');
  const page = { ...definition, data: { ...definition.data },
    setData(patch: Record<string, unknown>) { this.data = { ...this.data, ...patch }; } };
  storage.set(`wuma:wechat-session:v1:${API_BASE_URLS.development}`, { token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' });
  return { page, requests };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function succeed(request: any, data: any) { request.success({ statusCode: 200, data: { code: 0, data } }); }
test('real page renders zero, hundred, API seal and both review gates', async () => {
  const { page } = await harness(); await page.load();
  assert.equal(page.data.state, 'success'); assert.equal(page.data.skillProfile.seal, '熟');
  assert.equal(page.data.abilities.length, 6);
  assert.equal(page.data.abilities[0].valueText, '0 分'); assert.equal(page.data.abilities[0].hasValue, true);
  assert.equal(page.data.abilities[0].progress, 0);
  assert.equal(page.data.abilities[1].valueText, '100 分'); assert.equal(page.data.abilities[1].progress, 100);
  assert.equal(page.data.abilities[1].sampleText, '复盘局数 3/3 局 · 复盘着数 15/15 手');
  assert.equal(page.data.abilities[5].sampleText, '训练作答 5/5 次');
  const wxml = readFileSync(new URL('../miniprogram/pages/profile/profile.wxml', import.meta.url), 'utf8');
  assert.doesNotMatch(wxml, /演示数据|level-seal">初/);
  assert.match(wxml, /skillProfile\.seal/); assert.match(wxml, /item\.sampleText/);
  assert.match(wxml, /skillProfile\.overall !== null/);
});
test('partial readiness keeps true single scores while overall stays pending', async () => {
  const { page } = await harness(false, profile(skill(true))); await page.load();
  assert.equal(page.data.skillProfile.overall, null); assert.equal(page.data.skillProfile.seal, '待');
  assert.equal(page.data.abilities[0].valueText, '0 分'); assert.equal(page.data.abilities[1].valueText, '数据不足');
  assert.equal(page.data.abilities[1].hasValue, false);
  assert.equal(page.data.abilities[1].sampleText, '复盘局数 2/3 局 · 复盘着数 14/15 手');
  assert.equal(page.data.abilities[5].valueText, '80 分');
});
test('latest load wins; errors clear previous account data and retry works', async () => {
  const { page, requests } = await harness(true);
  const old = page.load(); await tick(); const newest = page.load(); await tick();
  succeed(requests[1], { ...profile(skill(true)), nickname: '新账号', games: 10 }); await newest;
  succeed(requests[0], profile()); await old;
  assert.equal(page.data.name, '新账号'); assert.equal(page.data.skillProfile.seal, '待');
  const failed = page.load(); await tick();
  assert.equal(page.data.skillProfile, null); assert.deepEqual(page.data.abilities, []);
  requests[2].fail({ errMsg: 'network' }); await failed;
  assert.equal(page.data.state, 'error'); assert.equal(page.data.cloudGames, 0);
  page.retry(); await tick(); succeed(requests[3], profile()); await tick();
  assert.equal(page.data.state, 'success'); assert.equal(page.data.skillProfile.seal, '熟');
});
test('hide and unload invalidate pending profile writes', async () => {
  for (const lifecycle of ['onHide', 'onUnload']) {
    const { page, requests } = await harness(true); const load = page.load(); await tick();
    page[lifecycle](); succeed(requests[0], profile()); await load;
    assert.equal(page.data.skillProfile, null); assert.notEqual(page.data.state, 'success');
  }
});
test('missing fields and missing review gates produce explicit contract errors', async () => {
  for (const payload of [
    { ...profile(), skillProfile: undefined },
    { ...profile(), skillProfile: { ...skill(), evidence: undefined } },
    { ...profile(), skillProfile: { ...skill(), metrics: skill().metrics.slice(0, 5) } },
    { ...profile(), skillProfile: { ...skill(), metrics: skill().metrics.map((m, i) => i === 1 ? { ...m, sampleDetails: m.sampleDetails.slice(1) } : m) } },
  ]) {
    const { page } = await harness(false, payload); await page.load();
    assert.equal(page.data.state, 'error'); assert.equal(page.data.skillProfile, null);
    assert.match(page.data.errorMessage, /个人棋力数据异常/);
  }
});

test('chart modes switch the same profile without requests and retain only a display preference', async()=>{
  const {page,requests}=await harness(false,profile());await page.load();
  const original=JSON.stringify(page.data.skillProfile);
  const persisted:any[]=[];
  (globalThis as any).wx.setStorageSync=(key:string,value:any)=>persisted.push({key,value});
  assert.equal(page.data.chartMode,'radar');
  for(const mode of ['bar','line','radar'])page.changeChart({currentTarget:{dataset:{mode}}});
  assert.equal(page.data.chartMode,'radar');
  assert.equal(JSON.stringify(page.data.skillProfile),original);
  assert.equal(requests.length,1,'switching adds no requests beyond initial profile load');
  assert.equal(persisted.length,3);
  assert.deepEqual(persisted[1],{key:'wuma:skill-chart-mode:v1',value:'line'});
  page.changeChart({currentTarget:{dataset:{mode:'pie'}}});
  assert.equal(persisted.length,3);
  (globalThis as any).wx.setStorageSync=()=>{throw Error('full');};
  page.changeChart({currentTarget:{dataset:{mode:'bar'}}});
  assert.equal(page.data.chartMode,'bar','failed preference save does not block in-session switch');
  const wxml=readFileSync('miniprogram/pages/profile/profile.wxml','utf8');
  assert.match(wxml,/<skill-chart/);assert.match(wxml,/metrics="\{\{skillProfile.metrics\}\}"/);
});

test('chart preference restores safely; hiding and logout clear scored data',async()=>{
  const {page}=await harness(false,profile());
  const base=(globalThis as any).wx.getStorageSync;
  (globalThis as any).wx.getStorageSync=(key:string)=>key==='wuma:skill-chart-mode:v1'?'line':base(key);
  page.onLoad();assert.equal(page.data.chartMode,'line');await page.load();
  page.onHide();assert.equal(page.data.skillProfile,null);assert.deepEqual(page.data.abilities,[]);
  (globalThis as any).wx.getStorageSync=(key:string)=>key==='wuma:skill-chart-mode:v1'?'invalid':base(key);
  page.onLoad();assert.equal(page.data.chartMode,'radar');
  (globalThis as any).wx.getStorageSync=()=>{throw Error('storage');};
  page.onLoad();assert.equal(page.data.chartMode,'radar');
  (globalThis as any).wx.getStorageSync=base;
  (globalThis as any).wx.removeStorageSync=()=>{};
  (globalThis as any).wx.reLaunch=()=>{};
  await page.load();page.logout();assert.equal(page.data.skillProfile,null);
});
