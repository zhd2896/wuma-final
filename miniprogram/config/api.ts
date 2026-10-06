/** Build-time API addresses. Set test/production only when those deployments exist. */
export type ApiEnvironment = 'development' | 'test' | 'production';
import { API_BASE_URLS } from './api-roots';
import { normalizeApiRoot, ApiConfigurationError } from './api-root';
export { API_BASE_URLS } from './api-roots';

export function getApiEnvironment(): ApiEnvironment {
  const version = wx.getAccountInfoSync().miniProgram.envVersion;
  return version === 'release' ? 'production' : version === 'trial' ? 'test' : 'development';
}

export function getApiBaseUrl(environment: ApiEnvironment = getApiEnvironment()): string {
  if (!Object.prototype.hasOwnProperty.call(API_BASE_URLS, environment)) throw new ApiConfigurationError();
  return normalizeApiRoot(API_BASE_URLS[environment], environment !== 'development');
}
