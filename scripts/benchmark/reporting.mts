import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_EVALUATION_CONFIG } from '../../miniprogram/ai/evaluation.ts';
import type { EvaluationConfig } from '../../miniprogram/ai/evaluation.ts';
import { POSITION_SUITE_VERSION } from './positions.mts';
import type { SearchBenchmarkRow } from './search-harness.mts';
import type { SelfPlayRow } from './selfplay-harness.mts';

export const SEARCH_COLUMNS = [
  'benchmarkId', 'experiment', 'positionId', 'positionSource', 'algorithm',
  'rootPlayer', 'depth', 'budgetMs', 'repetition', 'status', 'bestMoveFrom',
  'bestMoveTo', 'evaluationScore', 'scorePerspective', 'nodesSearched',
  'searchDepth', 'thinkingTimeMs', 'timedOut', 'candidateBestEquivalent',
  'cutoffs', 'ttProbes', 'ttHits', 'ttCutoffs', 'ttStores', 'error',
] as const;
export const SELFPLAY_COLUMNS = [
  'benchmarkId', 'matchup', 'gameIndex', 'pairIndex', 'pairSeed',
  'algorithmA', 'algorithmB', 'firstPlayer', 'winner', 'winnerAlgorithm',
  'winnerReason', 'terminationReason', 'plies', 'totalTimeMs', 'totalNodes',
  'searchMoves', 'averageDepth', 'totalTtHits', 'draws', 'moveSequenceJson',
  'moveSequenceHash', 'error',
] as const;
export const SEARCH_SUMMARY_COLUMNS = [
  'experiment', 'algorithm', 'depth', 'budgetMs', 'positions', 'samples',
  'completed', 'notCompleted', 'ruleAmbiguity', 'engineError', 'totalNodes',
  'meanNodes', 'medianNodes', 'meanTimeMs', 'medianTimeMs', 'minTimeMs', 'maxTimeMs',
  'meanCompletedDepth', 'medianCompletedDepth', 'timedOutCount',
  'ttProbes', 'ttHits', 'ttHitRate',
] as const;
export const SELFPLAY_SUMMARY_COLUMNS = [
  'matchup', 'gamesStarted', 'gamesFinished', 'winsAsA', 'winsAsB',
  'winsByAlgorithm', 'lossesByAlgorithm', 'winnerReasonCounts',
  'averagePlies', 'medianPlies', 'averageTimeMs', 'maxTimeMs',
  'averageNodes', 'averageDepth', 'ttHits', 'maxPliesReached',
  'ruleAmbiguity', 'engineError', 'draws',
] as const;

type RawRow = Record<string, unknown> | readonly string[];

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function encodeCsv(rows: readonly Record<string, unknown>[],
                          columns: readonly string[]): string {
  return [columns.join(','), ...rows.map(row => columns.map(column => cell(row[column])).join(','))]
    .join('\r\n') + '\r\n';
}

/** Parse the CSV that this harness writes, including quoted JSON and embedded commas. */
export function decodeCsv(csv: string): string[][] {
  const result: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < csv.length; index++) {
    const char = csv[index];
    if (char === '"') {
      if (quoted && csv[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(value); value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && csv[index + 1] === '\n') index++;
      row.push(value); value = '';
      result.push(row); row = [];
    } else value += char;
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (row.length || value) { row.push(value); result.push(row); }
  return result;
}

function objectRow(row: RawRow, columns: readonly string[]): Record<string, unknown> {
  return Array.isArray(row)
    ? Object.fromEntries(columns.map((column, index) => [column, row[index] ?? '']))
    : row as Record<string, unknown>;
}
function number(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function string(value: unknown): string { return value === null || value === undefined ? '' : String(value); }
function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function numbers(rows: readonly Record<string, unknown>[], key: string): number[] {
  return rows.map(row => number(row[key])).filter((value): value is number => value !== null);
}

export function summarizeSearch(input: readonly RawRow[]): Record<string, unknown>[] {
  const rows = input.map(row => objectRow(row, SEARCH_COLUMNS));
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = [row.experiment, row.algorithm, row.depth, row.budgetMs].join(':');
    const group = groups.get(key) ?? [];
    group.push(row); groups.set(key, group);
  }
  return [...groups.values()].map(group => {
    const first = group[0];
    const budget = string(first.experiment) === 'TIME_BUDGET';
    const measured = group.filter(row => budget
      ? ['COMPLETED', 'NOT_COMPLETED'].includes(string(row.status))
      : string(row.status) === 'COMPLETED');
    const nodeValues = numbers(measured, 'nodesSearched');
    const timeValues = numbers(measured, 'thinkingTimeMs');
    const depths = numbers(measured, 'searchDepth');
    const probes = numbers(measured, 'ttProbes').reduce((a, b) => a + b, 0);
    const hits = numbers(measured, 'ttHits').reduce((a, b) => a + b, 0);
    return {
      experiment: first.experiment, algorithm: first.algorithm,
      depth: number(first.depth), budgetMs: number(first.budgetMs),
      positions: new Set(group.map(row => row.positionId)).size,
      samples: group.length,
      completed: group.filter(row => row.status === 'COMPLETED').length,
      notCompleted: group.filter(row => row.status === 'NOT_COMPLETED').length,
      ruleAmbiguity: group.filter(row => row.status === 'RULE_AMBIGUITY').length,
      engineError: group.filter(row => row.status === 'ENGINE_ERROR').length,
      totalNodes: nodeValues.reduce((a, b) => a + b, 0),
      meanNodes: mean(nodeValues), medianNodes: median(nodeValues),
      meanTimeMs: mean(timeValues), medianTimeMs: median(timeValues),
      minTimeMs: timeValues.length ? Math.min(...timeValues) : null,
      maxTimeMs: timeValues.length ? Math.max(...timeValues) : null,
      meanCompletedDepth: mean(depths), medianCompletedDepth: median(depths),
      timedOutCount: measured.filter(row => row.timedOut === true || row.timedOut === 'true').length,
      ttProbes: probes, ttHits: hits, ttHitRate: probes ? hits / probes : null,
    };
  }).sort((a, b) => [a.experiment, a.depth, a.budgetMs, a.algorithm].join(':')
    .localeCompare([b.experiment, b.depth, b.budgetMs, b.algorithm].join(':')));
}

export interface AblationRow {
  readonly depth: number;
  readonly positionId: string;
  readonly baseline: string;
  readonly optimized: string;
  readonly pairedSamples: number;
  readonly baselineTotalNodes: number;
  readonly optimizedTotalNodes: number;
  readonly nodeReductionPct: number | null;
}

export function computeAblations(input: readonly RawRow[]): AblationRow[] {
  const rows = input.map(row => objectRow(row, SEARCH_COLUMNS));
  const pairs = [
    ['MINIMAX', 'ALPHA_BETA'],
    ['ALPHA_BETA', 'ORDERED_ALPHA_BETA'],
    ['ORDERED_ALPHA_BETA', 'ALPHA_BETA_TT'],
  ] as const;
  const depths = [...new Set(rows.filter(row => row.experiment === 'FIXED_DEPTH')
    .map(row => number(row.depth)).filter((depth): depth is number => depth !== null))];
  const results: AblationRow[] = [];
  for (const depth of depths) for (const [baseline, optimized] of pairs) {
    const keyed = (algorithm: string) => new Map(rows.filter(row =>
      row.experiment === 'FIXED_DEPTH' && row.algorithm === algorithm &&
      number(row.depth) === depth && row.status === 'COMPLETED')
      .map(row => [`${row.positionId}:${row.rootPlayer}:${row.repetition}`, row]));
    const left = keyed(baseline);
    const right = keyed(optimized);
    const joined = [...left].filter(([key]) => right.has(key));
    const append = (positionId: string, samples: typeof joined) => {
      const baselineTotalNodes = samples.reduce((sum, [, row]) =>
        sum + (number(row.nodesSearched) ?? 0), 0);
      const optimizedTotalNodes = samples.reduce((sum, [key]) =>
        sum + (number(right.get(key)?.nodesSearched) ?? 0), 0);
      results.push({ depth, positionId, baseline, optimized, pairedSamples: samples.length,
        baselineTotalNodes, optimizedTotalNodes,
        nodeReductionPct: baselineTotalNodes
          ? (baselineTotalNodes - optimizedTotalNodes) / baselineTotalNodes * 100 : null });
    };
    append('ALL', joined);
    for (const positionId of [...new Set(joined.map(([, row]) => string(row.positionId)))].sort()) {
      append(positionId, joined.filter(([, row]) => row.positionId === positionId));
    }
  }
  return results;
}

export function summarizeSelfPlay(input: readonly RawRow[]): Record<string, unknown>[] {
  const rows = input.map(row => objectRow(row, SELFPLAY_COLUMNS));
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = string(row.matchup);
    const group = groups.get(key) ?? [];
    group.push(row); groups.set(key, group);
  }
  return [...groups].map(([matchup, group]) => {
    const finished = group.filter(row => row.terminationReason === 'COMPLETED');
    const algorithms = new Set(group.flatMap(row => [string(row.algorithmA), string(row.algorithmB)]));
    const winsByAlgorithm: Record<string, number> = {};
    const lossesByAlgorithm: Record<string, number> = {};
    for (const algorithm of algorithms) {
      winsByAlgorithm[algorithm] = finished.filter(row => row.winnerAlgorithm === algorithm).length;
      lossesByAlgorithm[algorithm] = finished.filter(row => row.winnerAlgorithm !== algorithm &&
        [row.algorithmA, row.algorithmB].includes(algorithm)).length;
    }
    const winnerReasonCounts: Record<string, number> = {};
    for (const row of finished) {
      const reason = string(row.winnerReason);
      winnerReasonCounts[reason] = (winnerReasonCounts[reason] ?? 0) + 1;
    }
    const searchMoves = numbers(group, 'searchMoves').reduce((a, b) => a + b, 0);
    const depths = group.reduce((sum, row) =>
      sum + (number(row.averageDepth) ?? 0) * (number(row.searchMoves) ?? 0), 0);
    const times = numbers(group, 'totalTimeMs');
    return { matchup, gamesStarted: group.length, gamesFinished: finished.length,
      winsAsA: finished.filter(row => row.winner === 'A').length,
      winsAsB: finished.filter(row => row.winner === 'B').length,
      winsByAlgorithm, lossesByAlgorithm, winnerReasonCounts,
      averagePlies: mean(numbers(group, 'plies')), medianPlies: median(numbers(group, 'plies')),
      averageTimeMs: mean(times), maxTimeMs: times.length ? Math.max(...times) : null,
      averageNodes: searchMoves ? numbers(group, 'totalNodes').reduce((a, b) => a + b, 0) / searchMoves : null,
      averageDepth: searchMoves ? depths / searchMoves : null,
      ttHits: numbers(group, 'totalTtHits').reduce((a, b) => a + b, 0),
      maxPliesReached: group.filter(row => row.terminationReason === 'MAX_PLIES_REACHED').length,
      ruleAmbiguity: group.filter(row => row.terminationReason === 'RULE_AMBIGUITY').length,
      engineError: group.filter(row => row.terminationReason === 'ENGINE_ERROR').length,
      draws: 0,
    };
  }).sort((a, b) => string(a.matchup).localeCompare(string(b.matchup)));
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

export function collectMetadata(kind: 'search' | 'selfplay', config: Record<string, unknown>,
                                evaluationConfig: EvaluationConfig = DEFAULT_EVALUATION_CONFIG) {
  let gitCommit: string | null = null;
  try { gitCommit = execFileSync('git', ['rev-parse', 'HEAD'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { /* The imported workspace may have no commit. */ }
  const benchmarkConfig = stable(config);
  const configHash = hashConfig(kind, benchmarkConfig, evaluationConfig, POSITION_SUITE_VERSION);
  return { timestamp: new Date().toISOString(), kind, gitCommit,
    os: `${platform()} ${release()}`, cpu: cpus()[0]?.model ?? null,
    cores: cpus().length, ramBytes: totalmem(), nodeVersion: process.version,
    benchmarkConfig, configHash, evaluationConfig,
    positionSuiteVersion: POSITION_SUITE_VERSION,
    nodeSemantics: 'visited positions including root; iterative totals every completed/partial iteration',
    mcts: 'NOT_IMPLEMENTED', drawRule: 'NO_GENERAL_DRAW_RULE' };
}

function hashConfig(kind: string, benchmarkConfig: unknown, evaluationConfig: unknown,
                    positionSuiteVersion: string): string {
  return createHash('sha256').update(JSON.stringify(stable({ kind, benchmarkConfig,
    evaluationConfig, positionSuiteVersion }))).digest('hex');
}

function safeRunId(runId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(runId)) throw new Error('Invalid run ID');
  return runId;
}
function display(value: unknown): string {
  return typeof value === 'number' ? value.toFixed(3) : value === null ? 'unavailable' : String(value);
}

function searchReport(summary: readonly Record<string, unknown>[],
                      ablations: readonly AblationRow[], metadata: Record<string, unknown>): string {
  const lines = [
    '# AI Search Benchmark', '',
    `Run: ${metadata.timestamp}`, `Config hash: ${metadata.configHash}`,
    `Environment: ${metadata.os}; ${metadata.cpu}; Node ${metadata.nodeVersion}`,
    'MCTS: NOT_IMPLEMENTED', '',
    'Fixed-depth and time-budget rows are separate experiments. Time is measured by the Node high-resolution wall clock.',
    '', '| Experiment | Algorithm | Depth | Budget ms | Positions | Samples | Mean nodes | Median nodes | Median ms | Max ms | Mean completed depth | Timeouts | TT hit rate |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const row of summary) lines.push(`| ${row.experiment} | ${row.algorithm} | ${display(row.depth)} | ${display(row.budgetMs)} | ${row.positions} | ${row.samples} | ${display(row.meanNodes)} | ${display(row.medianNodes)} | ${display(row.medianTimeMs)} | ${display(row.maxTimeMs)} | ${display(row.meanCompletedDepth)} | ${row.timedOutCount} | ${display(row.ttHitRate)} |`);
  lines.push('', '## Fixed-depth ablation', '',
    'Each reduction pairs the same position, root player, depth, configuration, and repetition.', '',
    '| Depth | Position | Baseline | Optimized | Paired samples | Baseline nodes | Optimized nodes | Node reduction % |',
    '|---:|---|---|---|---:|---:|---:|---:|');
  for (const row of ablations) lines.push(`| ${row.depth} | ${row.positionId} | ${row.baseline} | ${row.optimized} | ${row.pairedSamples} | ${row.baselineTotalNodes} | ${row.optimizedTotalNodes} | ${display(row.nodeReductionPct)} |`);
  lines.push('', 'Results describe this run and hardware only. Short searches may have high timing noise.');
  return lines.join('\n') + '\n';
}

function selfPlayReport(summary: readonly Record<string, unknown>[],
                        metadata: Record<string, unknown>): string {
  const lines = ['# AI Self-Play Benchmark', '', `Run: ${metadata.timestamp}`,
    `Config hash: ${metadata.configHash}`, 'MCTS: NOT_IMPLEMENTED',
    'Games are paired with swapped A/B assignments. A max-ply stop or rule ambiguity is not a draw.',
    'Average plies, time, nodes and search depth use all started games, including capped or interrupted games; wins use completed games only.', '',
    '| Matchup | Started | Finished | Wins A | Wins B | Max plies | Rule ambiguity | Engine error | Average plies |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|'];
  for (const row of summary) lines.push(`| ${row.matchup} | ${row.gamesStarted} | ${row.gamesFinished} | ${row.winsAsA} | ${row.winsAsB} | ${row.maxPliesReached} | ${row.ruleAmbiguity} | ${row.engineError} | ${display(row.averagePlies)} |`);
  lines.push('', 'Winner counts and every move sequence are preserved in the raw CSV.');
  return lines.join('\n') + '\n';
}

export function writeSearchArtifacts(outputDir: string, runId: string,
  rows: readonly SearchBenchmarkRow[], metadata: Record<string, unknown>) {
  mkdirSync(outputDir, { recursive: true });
  const suffix = safeRunId(runId);
  const rawCsv = join(outputDir, `benchmark_search_raw_${suffix}.csv`);
  const summaryCsv = join(outputDir, `benchmark_search_summary_${suffix}.csv`);
  const metadataJson = join(outputDir, `benchmark_metadata_${suffix}.json`);
  const reportMd = join(outputDir, `benchmark_report_${suffix}.md`);
  if ([rawCsv, summaryCsv, metadataJson, reportMd].some(existsSync)) {
    throw new Error(`Benchmark run ${suffix} already exists`);
  }
  writeFileSync(rawCsv, encodeCsv(rows, SEARCH_COLUMNS), { flag: 'wx' });
  writeFileSync(metadataJson, JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' });
  refreshSearchDerivedArtifacts({ rawCsv, summaryCsv, metadataJson, reportMd });
  return { rawCsv, summaryCsv, metadataJson, reportMd };
}

/** Rebuild derived search files from the saved raw CSV after schema/report updates. */
export function refreshSearchDerivedArtifacts(files: { rawCsv: string; summaryCsv: string;
  metadataJson: string; reportMd: string }) {
  const parsed = decodeCsv(readFileSync(files.rawCsv, 'utf8'));
  if (JSON.stringify(parsed[0]) !== JSON.stringify(SEARCH_COLUMNS)) {
    throw new Error('Raw CSV columns differ');
  }
  const rows = parsed.slice(1);
  const summary = summarizeSearch(rows);
  const metadata = JSON.parse(readFileSync(files.metadataJson, 'utf8'));
  writeFileSync(files.summaryCsv, encodeCsv(summary, SEARCH_SUMMARY_COLUMNS));
  writeFileSync(files.reportMd, searchReport(summary, computeAblations(rows), metadata));
}

export function writeSelfPlayArtifacts(outputDir: string, runId: string,
  rows: readonly SelfPlayRow[], metadata: Record<string, unknown>) {
  mkdirSync(outputDir, { recursive: true });
  const suffix = safeRunId(runId);
  const rawCsv = join(outputDir, `selfplay_raw_${suffix}.csv`);
  const summaryCsv = join(outputDir, `selfplay_summary_${suffix}.csv`);
  const metadataJson = join(outputDir, `benchmark_metadata_${suffix}.json`);
  const reportMd = join(outputDir, `selfplay_report_${suffix}.md`);
  if ([rawCsv, summaryCsv, metadataJson, reportMd].some(existsSync)) {
    throw new Error(`Benchmark run ${suffix} already exists`);
  }
  writeFileSync(rawCsv, encodeCsv(rows, SELFPLAY_COLUMNS), { flag: 'wx' });
  writeFileSync(metadataJson, JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' });
  refreshSelfPlayDerivedArtifacts({ rawCsv, summaryCsv, metadataJson, reportMd });
  return { rawCsv, summaryCsv, metadataJson, reportMd };
}

/** Rebuild self-play summary and report from the saved game rows. */
export function refreshSelfPlayDerivedArtifacts(files: { rawCsv: string; summaryCsv: string;
  metadataJson: string; reportMd: string }) {
  const parsed = decodeCsv(readFileSync(files.rawCsv, 'utf8'));
  if (JSON.stringify(parsed[0]) !== JSON.stringify(SELFPLAY_COLUMNS)) {
    throw new Error('Raw CSV columns differ');
  }
  const summary = summarizeSelfPlay(parsed.slice(1));
  const metadata = JSON.parse(readFileSync(files.metadataJson, 'utf8'));
  writeFileSync(files.summaryCsv, encodeCsv(summary, SELFPLAY_SUMMARY_COLUMNS));
  writeFileSync(files.reportMd, selfPlayReport(summary, metadata));
}

/** Recompute saved summaries and config identity from exported files, without rerunning search. */
export function verifyArtifacts(files: { rawCsv: string; summaryCsv: string;
  metadataJson: string }, kind: 'search' | 'selfplay') {
  const parsed = decodeCsv(readFileSync(files.rawCsv, 'utf8'));
  const columns = kind === 'search' ? SEARCH_COLUMNS : SELFPLAY_COLUMNS;
  if (JSON.stringify(parsed[0]) !== JSON.stringify(columns)) throw new Error('Raw CSV columns differ');
  const rows = parsed.slice(1);
  const expectedSummary = kind === 'search'
    ? encodeCsv(summarizeSearch(rows), SEARCH_SUMMARY_COLUMNS)
    : encodeCsv(summarizeSelfPlay(rows), SELFPLAY_SUMMARY_COLUMNS);
  if (readFileSync(files.summaryCsv, 'utf8') !== expectedSummary) {
    throw new Error('Saved summary differs from raw CSV recomputation');
  }
  const metadata = JSON.parse(readFileSync(files.metadataJson, 'utf8'));
  if (metadata.kind !== kind || metadata.configHash !== hashConfig(kind,
    metadata.benchmarkConfig, metadata.evaluationConfig, metadata.positionSuiteVersion)) {
    throw new Error('Metadata config hash differs from saved configuration');
  }
  return { rawRows: rows.length, summaryRows: decodeCsv(expectedSummary).length - 1,
    configHash: metadata.configHash };
}
