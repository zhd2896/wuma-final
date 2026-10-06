/** Pure string validation: available in the native mini runtime without browser URL. */
export const SERVICE_UNOPENED = '服务暂未开放，请稍后再试';
export class ApiConfigurationError extends Error {
  constructor() { super(SERVICE_UNOPENED); this.name = 'ApiConfigurationError'; }
}
export function normalizeApiRoot(value: unknown, publicOnly = true): string {
  const invalid = () => { throw new ApiConfigurationError(); };
  if (typeof value !== 'string' || !value || value !== value.trim() || /[\s\\?#@]/.test(value)) return invalid();
  const match = /^(https?):\/\/([^/:]+)(?::([0-9]{1,5}))?(\/[^?#]*)?$/.exec(value);
  if (!match || (publicOnly && match[1] !== 'https')) return invalid();
  const host = match[2].toLowerCase();
  if (match[3] && (Number(match[3]) < 1 || Number(match[3]) > 65535)) return invalid();
  if (!/^[a-z0-9.-]+$/.test(host) || host.length > 253 || host.split('.').some(label =>
      !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return invalid();
  // Public builds use a DNS hostname; all IP literals and local-only names are refused.
  if (publicOnly && (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      !host.includes('.') || /^[0-9.]+$/.test(host) || !/^[a-z][a-z0-9-]*$/.test(host.split('.').pop()!))) return invalid();
  if (match[4]) {
    let decoded: string;
    try { decoded = decodeURIComponent(match[4]); } catch { return invalid(); }
    if (/[^\x21-\x7e]|[\\?#@]/.test(decoded) || decoded.split('/').some(part => part === '.' || part === '..') || decoded.includes('//')) return invalid();
  }
  return value.replace(/\/+$/, '');
}
