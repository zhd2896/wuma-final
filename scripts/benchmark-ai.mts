/** Direct TypeScript engine benchmark; no API, worker, database, or LLM. */
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

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

const { buildPositionSuite, POSITION_SUITE_VERSION } =
  await import('./benchmark/positions.mts');
const { createSeededRng } = await import('./benchmark/seeded-rng.mts');
const { runFixedDepth, runTimeBudget, fixedScoreMismatches, FIXED_ALGORITHMS } =
  await import('./benchmark/search-harness.mts');
const { collectMetadata, writeSearchArtifacts } =
  await import('./benchmark/reporting.mts');

function flags(arguments_: readonly string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    if (!key?.startsWith('--') || !arguments_[index + 1]) throw new Error(`Expected --flag value near ${key}`);
    if (!['profile', 'depth', 'repetitions', 'warmups', 'budgets', 'budget-repetitions',
      'max-depth', 'seed', 'output-dir', 'algorithms', 'optimization-version',
      'baseline-run-id'].includes(key.slice(2))) throw new Error(`Unknown flag ${key}`);
    parsed[key.slice(2)] = arguments_[index + 1];
  }
  return parsed;
}
function integer(value: string | undefined, fallback: number, label: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid ${label}`);
  return parsed;
}
function list(value: string | undefined, fallback: readonly number[], label: string): number[] {
  const parsed = value === undefined ? [...fallback] : value.split(',').map(Number);
  if (!parsed.length || parsed.some(item => !Number.isSafeInteger(item) || item <= 0)) {
    throw new Error(`Invalid ${label}`);
  }
  return parsed;
}

const args = flags(process.argv.slice(2));
const profile = args.profile ?? 'smoke';
if (!['smoke', 'standard'].includes(profile)) throw new Error('Unknown benchmark profile');
const standard = profile === 'standard';
const depths = list(args.depth, standard ? [1, 2, 3] : [1, 2], 'depth');
const budgetsMs = list(args.budgets, standard ? [100, 250, 500, 1000] : [50, 150], 'budgets');
const repetitions = integer(args.repetitions, standard ? 5 : 2, 'repetitions');
const warmups = integer(args.warmups, 1, 'warmups');
const budgetRepetitions = integer(args['budget-repetitions'], standard ? 3 : 2, 'budget repetitions');
const maxDepth = integer(args['max-depth'], standard ? 4 : 3, 'max depth');
const seed = integer(args.seed, 25, 'seed');
const algorithms = args.algorithms === undefined
  ? [...FIXED_ALGORITHMS] : args.algorithms.split(',');
if (!algorithms.length || new Set(algorithms).size !== algorithms.length ||
    algorithms.some(algorithm => !FIXED_ALGORITHMS.includes(algorithm))) {
  throw new Error('Invalid --algorithms list');
}
for (const key of ['optimization-version', 'baseline-run-id']) {
  if (args[key] !== undefined && !/^[A-Za-z0-9_-]+$/.test(args[key])) {
    throw new Error(`Invalid --${key}`);
  }
}
if (repetitions < 1 || budgetRepetitions < 1 || maxDepth < 1) throw new Error('Empty experiment');
const outputDir = resolve(args['output-dir'] ?? 'results');
const positions = buildPositionSuite();
const random = createSeededRng(seed);
for (let index = positions.length - 1; index > 0; index--) {
  const other = Math.floor(random() * (index + 1));
  [positions[index], positions[other]] = [positions[other], positions[index]];
}
const runId = `search-${new Date().toISOString().replace(/[-:.Z]/g, '').replace('T', '-')}`;
const config = { profile, depths, repetitions, warmups, budgetsMs,
  budgetRepetitions, maxDepth, seed, seedPurpose: 'position execution order',
  positionOrder: positions.map(item => item.id), positionSuiteVersion: POSITION_SUITE_VERSION,
  fixedAlgorithms: algorithms,
  ...(args['optimization-version'] ? { optimizationVersion: args['optimization-version'] } : {}),
  ...(args['baseline-run-id'] ? { baselineRunId: args['baseline-run-id'] } : {}),
  timedAlgorithm: 'ITERATIVE_DEEPENING' };
const started = performance.now();
const fixed = runFixedDepth({ positions, depths, repetitions, warmups,
  algorithms: algorithms as (typeof FIXED_ALGORITHMS)[number][], benchmarkId: runId });
const timed = runTimeBudget({ positions, budgetsMs, maxDepth, repetitions: budgetRepetitions,
  warmups, benchmarkId: runId });
const rows = [...fixed, ...timed];
const metadata = collectMetadata('search', config);
const files = writeSearchArtifacts(outputDir, runId, rows, metadata);
const mismatches = fixedScoreMismatches(fixed);
const hasScoreReference = algorithms.includes('MINIMAX');
const statuses = rows.reduce<Record<string, number>>((counts, row) => {
  counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}, {});
console.log(JSON.stringify({ runId, configHash: metadata.configHash,
  positions: positions.length, fixedRows: fixed.length, budgetRows: timed.length,
  mismatches: hasScoreReference ? mismatches.length : null, scoreReference: hasScoreReference
    ? 'MINIMAX' : 'NOT_IN_RUN', statuses, elapsedMs: performance.now() - started, files }));
if (hasScoreReference && mismatches.length || fixed.some(row => row.status !== 'COMPLETED') ||
    timed.some(row => !['COMPLETED', 'NOT_COMPLETED'].includes(row.status))) process.exitCode = 1;
