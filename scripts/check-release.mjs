import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { normalizeApiRoot } from '../miniprogram/config/api-root.ts';
import { API_BASE_URLS } from '../miniprogram/config/api-roots.ts';

export function preflight(args) {
  const [target, ...options] = args;
  const environments = { development: 'development', trial: 'test', release: 'production' };
  if (!Object.hasOwn(environments, target)) throw new Error('未知目标：请选择 development、trial 或 release');
  let root = API_BASE_URLS[environments[target]];
  let appid = JSON.parse(readFileSync(new URL('../project.config.json', import.meta.url), 'utf8')).appid;
  for (let i = 0; i < options.length; i += 2) {
    if (options[i + 1] === undefined) throw new Error('配置参数不完整');
    if (options[i] === '--api-root') root = options[i + 1];
    else if (options[i] === '--appid') appid = options[i + 1];
    else throw new Error('未知配置参数');
  }
  root = normalizeApiRoot(root, target !== 'development');
  if (target !== 'development' && (typeof appid !== 'string' || !/^wx[0-9a-f]{16}$/.test(appid) || /^wx(0{16}|f{16})$/.test(appid))) throw new Error('公开 AppID 格式无效或仍为占位值');
  return { target, environment: environments[target], root };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { preflight(process.argv.slice(2)); console.log('公开配置格式检查通过；不代表域名已注册或服务在线。'); }
  catch { console.error('发布配置检查失败：请配置目标的公开 HTTPS API 地址与有效 AppID。'); process.exitCode = 1; }
}
