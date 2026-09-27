/** Paired, seeded AI self-play through the canonical TypeScript RuleEngine. */
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

const { runSelfPlay } = await import('./benchmark/selfplay-harness.mts');
const { allocatePairedGames } = await import('./benchmark/matchups.mts');
const { collectMetadata, writeSelfPlayArtifacts } = await import('./benchmark/reporting.mts');

const MATCHUPS = {
  'random-minimax': ['RANDOM', 'MINIMAX'],
  'random-tt': ['RANDOM', 'ALPHA_BETA_TT'],
  'minimax-ab': ['MINIMAX', 'ALPHA_BETA'],
  'ab-tt': ['ALPHA_BETA', 'ALPHA_BETA_TT'],
  'tt-iterative': ['ALPHA_BETA_TT', 'ITERATIVE_DEEPENING'],
} as const;

function flags(arguments_: readonly string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    if (!key?.startsWith('--') || !arguments_[index + 1]) throw new Error(`Expected --flag value near ${key}`);
    if (!['profile', 'games', 'seed', 'max-plies', 'matchup', 'depth',
      'time-budget', 'output-dir'].includes(key.slice(2))) throw new Error(`Unknown flag ${key}`);
    parsed[key.slice(2)] = arguments_[index + 1];
  }
  return parsed;
}
function integer(value: string | undefined, fallback: number, label: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid ${label}`);
  return parsed;
}

const args = flags(process.argv.slice(2));
const profile = args.profile ?? 'smoke';
if (!['smoke', 'standard', 'large'].includes(profile)) throw new Error('Unknown self-play profile');
if (profile === 'large' && args.games === undefined) throw new Error('Large profile requires --games');
const games = integer(args.games, profile === 'smoke' ? 8 : 100, 'games');
const seed = integer(args.seed, 25, 'seed');
const maxPlies = integer(args['max-plies'], profile === 'smoke' ? 24 : 60, 'max plies');
const fixedDepth = integer(args.depth, 1, 'depth');
const timeBudgetMs = integer(args['time-budget'], 100, 'time budget');
if (games < 2 || games % 2 || maxPlies < 1 || fixedDepth < 1) {
  throw new Error('Self-play requires an even game count, positive depth and max plies');
}
const choice = args.matchup ?? 'all';
if (choice !== 'all' && !(choice in MATCHUPS)) throw new Error(`Unknown matchup ${choice}`);
const selected = choice === 'all'
  ? ['random-minimax', 'random-tt', 'minimax-ab', 'ab-tt'] as const
  : [choice as keyof typeof MATCHUPS];
const allocatedGames = allocatePairedGames(games, selected.length);
const outputDir = resolve(args['output-dir'] ?? 'results');
const runId = `selfplay-${new Date().toISOString().replace(/[-:.Z]/g, '').replace('T', '-')}`;
const config = { profile, gamesTotal: games, allocatedGames, seed, maxPlies, fixedDepth,
  timeBudgetMs, selectedMatchups: selected, sideSwap: 'adjacent paired games',
  firstPlayer: 'A', drawRule: 'none' };
const started = performance.now();
const rows = selected.flatMap((name, matchupIndex) => runSelfPlay({
  matchup: MATCHUPS[name], games: allocatedGames[matchupIndex],
  seed: seed + matchupIndex * 100000,
  maxPlies, fixedDepth, timeBudgetMs, benchmarkId: runId,
}));
const metadata = collectMetadata('selfplay', config);
const files = writeSelfPlayArtifacts(outputDir, runId, rows, metadata);
const outcomes = rows.reduce<Record<string, number>>((counts, row) => {
  counts[row.terminationReason] = (counts[row.terminationReason] ?? 0) + 1;
  return counts;
}, {});
console.log(JSON.stringify({ runId, configHash: metadata.configHash,
  games: rows.length, seed, matchups: selected, outcomes,
  elapsedMs: performance.now() - started, files }));
if (rows.some(row => row.terminationReason === 'ENGINE_ERROR')) process.exitCode = 1;
