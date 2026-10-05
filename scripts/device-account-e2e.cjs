/** Shared verified WeChat session for fixture API calls and the simulator. */
async function createWechatAccount(apiBase, mini) {
  const login = await mini.callWxMethod('login');
  if (!login?.code) throw new Error('Could not obtain a WeChat simulator login code');
  const response = await fetch(`${apiBase.replace(/\/$/, '')}/api/v1/auth/wechat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: login.code }), signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0 || !/^[0-9a-f]{64}$/.test(payload.data?.token || '') ||
      !Number.isFinite(Date.parse(payload.data?.expiresAt)) || Date.parse(payload.data.expiresAt) <= Date.now()) {
    throw new Error('Could not login to the E2E backend with WeChat; check backend AppID/AppSecret');
  }
  return payload.data;
}

async function seedMiniAccount(mini, apiBase, session) {
  await mini.callWxMethod('setStorageSync',
    `wuma:wechat-session:v1:${apiBase.replace(/\/$/, '')}`, session);
}

module.exports = { createWechatAccount, seedMiniAccount };
