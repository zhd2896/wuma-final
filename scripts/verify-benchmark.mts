/** Recompute a saved benchmark summary from its raw CSV. */
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (specifier.startsWith('.') && context.parentURL &&
        (error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return nextResolve(url.href, context);
    }
    throw error;
  }
} });

const { verifyArtifacts, refreshSearchDerivedArtifacts,
  refreshSelfPlayDerivedArtifacts } = await import('./benchmark/reporting.mts');
const arguments_ = process.argv.slice(2);
const refresh = arguments_[0] === '--refresh';
const args = refresh ? arguments_.slice(1) : arguments_;
if (args.length !== 4 || !['search', 'selfplay'].includes(args[0])) {
  throw new Error('Usage: npm run benchmark:verify -- [--refresh] search|selfplay RAW.csv SUMMARY.csv METADATA.json');
}
const [kind, rawCsv, summaryCsv, metadataJson] = args;
const files = { rawCsv: resolve(rawCsv), summaryCsv: resolve(summaryCsv),
  metadataJson: resolve(metadataJson) };
if (refresh) {
  const rawName = basename(files.rawCsv);
  const rawPrefix = kind === 'search' ? 'benchmark_search_raw_' : 'selfplay_raw_';
  if (!rawName.startsWith(rawPrefix) || !/^[A-Za-z0-9_-]+\.csv$/.test(rawName.slice(rawPrefix.length))) {
    throw new Error('--refresh requires a standard raw CSV filename');
  }
  const reportPrefix = kind === 'search' ? 'benchmark_report_' : 'selfplay_report_';
  const reportName = rawName.replace(rawPrefix, reportPrefix)
    .replace(/\.csv$/, '.md');
  const derivedFiles = { ...files, reportMd: join(dirname(files.rawCsv), reportName) };
  if (kind === 'search') refreshSearchDerivedArtifacts(derivedFiles);
  else refreshSelfPlayDerivedArtifacts(derivedFiles);
}
const result = verifyArtifacts(files, kind as 'search' | 'selfplay');
console.log(JSON.stringify({ kind, refreshed: refresh, ...result }));
