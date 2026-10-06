/** Writes only reviewable public API roots, after exactly the same release preflight. */
import { writeFileSync } from 'node:fs';
import { preflight } from './check-release.mjs';
import { API_BASE_URLS } from '../miniprogram/config/api-roots.ts';
try {
  const config = preflight(process.argv.slice(2));
  const roots = { ...API_BASE_URLS, [config.environment]: config.root };
  writeFileSync(new URL('../miniprogram/config/api-roots.ts', import.meta.url),
    '/** Public build configuration; review before packaging. No secrets. */\nexport const API_BASE_URLS = ' + JSON.stringify(roots, null, 2) + ' as const;\n');
  console.log('公开地址已写入 api-roots.ts，请审查差异后构建；没有发布。');
} catch { console.error('配置写入失败：请先提供有效的公开配置。'); process.exitCode = 1; }
