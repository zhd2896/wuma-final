import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { profile, skill } from './fixtures/player-skill.mts';
registerHooks({ resolve(s, c, next) { try { return next(s, c); } catch (e) {
  if (s.startsWith('.') && c.parentURL && existsSync(new URL(s + '.ts', c.parentURL))) return next(new URL(s + '.ts', c.parentURL).href, c);
  throw e;
} } });

test('real profile editor preserves failed drafts, saves, cancels and ignores retired session replies', async () => {
  let definition: any; const pending: any[] = []; let token = 'a'.repeat(64);
  (globalThis as any).Page = (p: any) => { definition = p; };
  (globalThis as any).wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getStorageSync: (key: string) => key.startsWith('wuma:wechat-session:') ? { token, expiresAt: '2099-01-01T00:00:00Z' } : '',
    request: (o: any) => pending.push(o), removeStorageSync() {}, reLaunch() {},
  };
  await import('../miniprogram/pages/profile/profile.ts');
  const page = { ...definition, data: { ...definition.data }, setData(p: any) { this.data = { ...this.data, ...p }; } };
  const reply = (o: any, data: any) => o.success({ statusCode: 200, data: { code: 0, data } });
  const load = page.load(); await new Promise(r => setImmediate(r));
  reply(pending.shift(), { ...profile(skill()), avatar: 'piece_v1_shi' }); await load;
  page.editProfile(); page.nicknameInput({ detail: { value: '  新😀昵称  ' } });
  page.selectAvatar({ currentTarget: { dataset: { avatar: 'piece_v1_ma' } } });
  const failed = page.saveProfile(); await new Promise(r => setImmediate(r));
  pending.shift().fail({}); await failed;
  assert.equal(page.data.editing, true); assert.equal(page.data.draftNickname, '  新😀昵称  '); assert.ok(page.data.saveError);
  const save = page.saveProfile(); await new Promise(r => setImmediate(r));
  const request = pending.shift(); assert.deepEqual(request.data, { nickname: '新😀昵称', avatar: 'piece_v1_ma' });
  reply(request, { ...profile(skill()), nickname: '新😀昵称', avatar: 'piece_v1_ma' }); await save;
  assert.equal(page.data.name, '新😀昵称'); assert.equal(page.data.editing, false);
  page.editProfile(); page.nicknameInput({ detail: { value: 'discard' } }); page.cancelEdit(); assert.equal(page.data.name, '新😀昵称');
  page.editProfile(); const stale = page.saveProfile(); await new Promise(r => setImmediate(r));
  token = 'b'.repeat(64); reply(pending.shift(), { ...profile(skill()), nickname: '旧异步', avatar: 'piece_v1_pao' }); await stale;
  assert.notEqual(page.data.name, '旧异步');
  page.onHide(); assert.equal(page.data.editing, false);
  for (const lifecycle of ['onHide', 'onUnload', 'logout']) {
    // A returning/new profile page reloads before editing; hidden account data is cleared.
    const reloaded = page.load(); await new Promise(r => setImmediate(r));
    reply(pending.shift(), { ...profile(skill()), nickname: '新😀昵称', avatar: 'piece_v1_ma' }); await reloaded;
    page.data.saving = false; page.editProfile(); const pendingSave = page.saveProfile();
    await new Promise(r => setImmediate(r)); const oldReply = pending.shift();
    page[lifecycle](); const currentName = page.data.name;
    reply(oldReply, { ...profile(skill()), nickname: '退休回复', avatar: 'piece_v1_pao' }); await pendingSave;
    assert.equal(page.data.name, currentName, lifecycle);
    if (lifecycle === 'logout') assert.equal(page.data.name, '');
  }
});
