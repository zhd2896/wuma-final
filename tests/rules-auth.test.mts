import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';

registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (specifier.startsWith('.') && context.parentURL &&
        existsSync(new URL(`${specifier}.ts`, context.parentURL)))
      return next(new URL(`${specifier}.ts`, context.parentURL).href, context);
    throw error;
  }
} });
const { getApiBaseUrl } = await import('../miniprogram/config/api.ts');
const beginnerRoute = '/pages/game/game?mode=ai&level=BEGINNER&first=human&new=1';

let definition: any;
(globalThis as any).Page = (value: any) => { definition = value; };
function environment() {
  const storage = new Map<string, unknown>();
  const destinations: string[] = [];
  (globalThis as any).getCurrentPages = () => [{ route: 'guide/pages/rules/rules', options: {} }];
  (globalThis as any).wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getStorageSync: (key: string) => storage.get(key),
    navigateBack: (options: any) => options.fail(),
    navigateTo: ({ url }: any) => destinations.push(url),
    reLaunch: ({ url, complete }: any) => { destinations.push(url); complete?.(); },
  };
  return { storage, destinations, login() {
    storage.set(`wuma:wechat-session:v1:${getApiBaseUrl()}`,
      { token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' });
  } };
}

test('guest returning from a cold-start rules page reaches the public home without login', async () => {
  const env = environment();
  await import('../miniprogram/guide/pages/rules/rules.ts');
  definition.back();
  assert.deepEqual(env.destinations, ['/pages/index/index']);
});

test('rules retains ordinary back navigation and signed-in home fallback', () => {
  const env = environment();
  const fallback = (globalThis as any).wx.navigateBack;
  (globalThis as any).wx.navigateBack = () => {};
  definition.back();
  assert.deepEqual(env.destinations, []);
  env.login();
  (globalThis as any).wx.navigateBack = fallback;
  definition.back();
  assert.deepEqual(env.destinations, ['/pages/index/index']);
});

test('rules starts AI directly only with a session, otherwise preserves the target through login', () => {
  const env = environment();
  definition.startGame();
  assert.equal(new URL(`https://local${env.destinations[0]}`).searchParams.get('next'), beginnerRoute);
  env.destinations.length = 0;
  env.login();
  definition.startGame();
  assert.deepEqual(env.destinations, [beginnerRoute]);
});
test('rules shows a separate continue entry only for a known authenticated playable computer game',()=>{
  const env=environment();env.login();const id='d'.repeat(32);
  env.storage.set('activeAiGameId',id);
  env.storage.set('wuma:history:v1',{version:1,records:[{id,mode:'ai',aiLevel:'STANDARD',startedAt:1,updatedAt:2,turns:4,status:'PLAYING',winner:null,winnerReason:null}]});
  const page={...definition,data:{...definition.data},setData(patch:any){this.data={...this.data,...patch};}};
  assert.equal(typeof page.onShow,'function');page.onShow();assert.equal(page.data.continueRoute,`/pages/game/game?mode=ai&gameId=${id}`);
  page.continueGame();assert.deepEqual(env.destinations,[`/pages/game/game?mode=ai&gameId=${id}`]);
  env.storage.set('activeAiGameId','missing');page.onShow();assert.equal(page.data.continueRoute,'');
});
