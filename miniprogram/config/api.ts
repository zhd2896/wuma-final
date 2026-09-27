/** Build-time API addresses. Set test/production only when those deployments exist. */
export type ApiEnvironment = 'development' | 'test' | 'production';

export const API_BASE_URLS: Readonly<Record<ApiEnvironment, string>> = {
  development: 'http://127.0.0.1:8000',
  test: '',
  production: '',
};

export function getApiEnvironment(): ApiEnvironment {
  const version = wx.getAccountInfoSync().miniProgram.envVersion;
  return version === 'release' ? 'production' : version === 'trial' ? 'test' : 'development';
}

export function getApiBaseUrl(environment: ApiEnvironment = getApiEnvironment()): string {
  const baseUrl = API_BASE_URLS[environment];
  if (!baseUrl) throw new Error(`API base URL is not configured for ${environment}`);
  return baseUrl.replace(/\/$/, '');
}
