import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
registerHooks({ resolve(s, c, next) { try { return next(s, c); } catch (e) {
  if (s.startsWith('.') && c.parentURL && existsSync(new URL(s + '.ts', c.parentURL))) return next(new URL(s + '.ts', c.parentURL).href, c);
  throw e;
} } });
test('unopened trial never logs in or requests and real login page shows safe text', async () => {
  let definition: any; let calls = 0;
  (globalThis as any).Page = (p: any) => { definition = p; };
  (globalThis as any).wx = { getAccountInfoSync: () => ({ miniProgram: { envVersion: 'trial' } }),
    getStorageSync: () => '', login() { calls++; }, request() { calls++; }, reLaunch() {} };
  await import('../miniprogram/pages/login/login.ts');
  const page = { ...definition, data: { ...definition.data }, setData(p: any) { this.data = { ...this.data, ...p }; } };
  page.onLoad({}); await page.login();
  assert.equal(calls, 0); assert.equal(page.data.errorMessage, '服务暂未开放，请稍后再试');
  const { createApiClient, messageForApiError } = await import('../miniprogram/services/api-client.ts');
  await assert.rejects(async () => createApiClient().request('GET', '/api/v1/me/profile'), e => {
    assert.equal(messageForApiError(e), '服务暂未开放，请稍后再试'); return true;
  });
  assert.equal(calls, 0);
});

test('native runtime root validation preserves deployed prefixes and rejects invalid trial roots', async () => {
  const { API_BASE_URLS } = await import('../miniprogram/config/api.ts');
  const roots = API_BASE_URLS as any;
  const original = roots.test; const sent: string[] = [];
  (globalThis as any).wx = { getAccountInfoSync: () => ({ miniProgram: { envVersion: 'trial' } }),
    getStorageSync: () => ({ token: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' }),
    request(o: any) { sent.push(o.url); o.success({ statusCode: 200, data: { code: 0, data: { ok: true } } }); },
    reLaunch() {} };
  const { createApiClient } = await import('../miniprogram/services/api-client.ts');
  try {
    roots.test = 'https://api.example.com/wuma/';
    await createApiClient().request('GET', '/api/v1/me/profile');
    assert.equal(sent[0], 'https://api.example.com/wuma/api/v1/me/profile');
    for (const value of ['http://localhost:8000', 'https://0x7f.0x0.0x0.0x1', 'https://user:PRIVATE@example.com']) {
      roots.test = value; assert.throws(() => createApiClient(), /服务暂未开放/);
    }
    assert.equal(sent.length, 1);
  } finally { roots.test = original; }
});

test('actual app guard returns unopened releases to login without login/request', async () => {
  let app:any; const routes:string[]=[]; let network=0;
  (globalThis as any).App=(value:any)=>{app=value;};
  (globalThis as any).getCurrentPages=()=>[{route:'pages/profile/profile',options:{}}];
  (globalThis as any).wx={getAccountInfoSync:()=>({miniProgram:{envVersion:'release'}}),
    login(){network++;},request(){network++;},reLaunch(o:any){routes.push(o.url);o.complete?.();}};
  await import('../miniprogram/app.ts');app.onShow({path:'pages/profile/profile',query:{}});
  assert.match(routes[0],/^\/pages\/login\/login/);assert.equal(network,0);
});
