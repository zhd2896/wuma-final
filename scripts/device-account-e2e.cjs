/** Shared anonymous account for fixture API calls and the WeChat simulator. */
async function createDeviceAccount(apiBase) {
  const response = await fetch(`${apiBase}/api/v1/auth/device`, {
    method: 'POST', signal: AbortSignal.timeout(10000),
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0 || !/^[0-9a-f]{64}$/.test(payload.data?.token || '')) {
    throw new Error('Could not create isolated E2E device account');
  }
  return payload.data.token;
}

async function seedMiniAccount(mini, apiBase, token) {
  await mini.callWxMethod('setStorageSync',
    `wuma:device-account-token:v1:${apiBase.replace(/\/$/, '')}`, token);
}

module.exports = { createDeviceAccount, seedMiniAccount };
