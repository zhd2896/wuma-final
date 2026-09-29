import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

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

const { NODE_IDS, RuleEngine, createInitialGameState } =
  await import('../miniprogram/domain/index.ts');
const { buildPositionSuite, replaySequence } =
  await import('../scripts/benchmark/positions.mts');
const { runFixedDepth, runTimeBudget, fixedScoreMismatches } =
  await import('../scripts/benchmark/search-harness.mts');
const { runSelfPlay, classifySelfPlayError } =
  await import('../scripts/benchmark/selfplay-harness.mts');
const { RuleAmbiguityError } = await import('../miniprogram/ai/minimax.ts');
const { allocatePairedGames } = await import('../scripts/benchmark/matchups.mts');
const { SEARCH_COLUMNS, SELFPLAY_COLUMNS, encodeCsv, decodeCsv, summarizeSearch,
  summarizeSelfPlay, computeAblations, collectMetadata, writeSearchArtifacts,
  writeSelfPlayArtifacts, verifyArtifacts } =
  await import('../scripts/benchmark/reporting.mts');

test('position suite replays eight legal live states with evidence for required categories', () => {
  const first = buildPositionSuite();
  const second = buildPositionSuite();
  assert.equal(first.length, 8);
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map(item => item.id)).size, first.length);
  const tags = new Set(first.flatMap(item => item.tags));
  for (const tag of ['OPENING', 'MIDGAME', 'CAPTURE_AVAILABLE', 'TACTICAL',
    'TEMPLE_RELATED', 'LONE_PIECE_RISK', 'FORCED_WIN', 'DEFENSIVE']) {
    assert.ok(tags.has(tag), `missing ${tag}`);
  }
  for (const item of first) {
    assert.equal(item.expectedStatus, 'PLAYING');
    assert.equal(item.state.game_status, 'PLAYING');
    assert.equal(item.state.current_player, item.currentPlayer);
    assert.ok(RuleEngine.getAllLegalMoves(item.state).length > 0);
    assert.ok(item.source);
  }
  assert.throws(() => replaySequence([{ from: 'P01', to: 'P01' }]), /invalid|move/i);
});

test('fixed-depth harness excludes warm-ups and verifies real algorithm scores', () => {
  const positions = buildPositionSuite().slice(0, 1);
  const rows = runFixedDepth({ positions, depths: [1], repetitions: 2, warmups: 1,
    benchmarkId: 'unit-fixed' });
  assert.equal(rows.length, 8);
  assert.deepEqual(new Set(rows.map(row => row.algorithm)),
    new Set(['MINIMAX', 'ALPHA_BETA', 'ORDERED_ALPHA_BETA', 'ALPHA_BETA_TT']));
  assert.ok(rows.every(row => row.status === 'COMPLETED' && row.searchDepth === 1 &&
    row.nodesSearched !== null && row.nodesSearched > 0 &&
    row.scorePerspective === row.rootPlayer && row.timedOut === false &&
    row.candidateBestEquivalent === true));
  assert.equal(fixedScoreMismatches(rows).length, 0);
});

test('targeted fixed-depth run measures only selected existing algorithms', () => {
  const rows = runFixedDepth({ positions: buildPositionSuite().slice(0, 1),
    depths: [1], repetitions: 2, warmups: 1, benchmarkId: 'unit-targeted',
    algorithms: ['ALPHA_BETA_TT'] });
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.algorithm === 'ALPHA_BETA_TT' &&
    row.repetition >= 1 && row.repetition <= 2));
  assert.throws(() => runFixedDepth({ positions: buildPositionSuite().slice(0, 1),
    depths: [1], repetitions: 1, warmups: 0, benchmarkId: 'invalid-targeted',
    algorithms: [] }), /algorithm/i);
});

test('search CLI records Phase 26 algorithm selection and baseline identity', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wuma-phase26-cli-'));
  try {
    const run = spawnSync(process.execPath, ['scripts/benchmark-ai.mts',
      '--profile', 'smoke', '--algorithms', 'ALPHA_BETA_TT',
      '--optimization-version', 'phase26-test', '--baseline-run-id', 'search-20260927-044020',
      '--depth', '1', '--repetitions', '1', '--warmups', '0',
      '--budgets', '1', '--budget-repetitions', '1', '--max-depth', '1',
      '--output-dir', directory], { cwd: resolve('.'), encoding: 'utf8', timeout: 30000 });
    assert.equal(run.status, 0, run.stderr);
    const output = JSON.parse(run.stdout.trim().split('\n').at(-1)!);
    assert.equal(output.fixedRows, 8);
    assert.equal(output.mismatches, null);
    assert.equal(output.scoreReference, 'NOT_IN_RUN');
    const metadata = JSON.parse(readFileSync(output.files.metadataJson, 'utf8'));
    assert.deepEqual(metadata.benchmarkConfig.fixedAlgorithms, ['ALPHA_BETA_TT']);
    assert.equal(metadata.benchmarkConfig.optimizationVersion, 'phase26-test');
    assert.equal(metadata.benchmarkConfig.baselineRunId, 'search-20260927-044020');
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('time-budget rows report completed depth separately from configured budget', () => {
  const rows = runTimeBudget({ positions: buildPositionSuite().slice(0, 1),
    budgetsMs: [10], repetitions: 2, warmups: 0, maxDepth: 2,
    benchmarkId: 'unit-budget' });
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.experiment === 'TIME_BUDGET' && row.budgetMs === 10 &&
    row.searchDepth !== null && row.searchDepth <= 2 &&
    row.thinkingTimeMs >= 0 && row.algorithm === 'ITERATIVE_DEEPENING'));
});

test('warm-up ambiguity still produces measured error rows', () => {
  const initial = createInitialGameState({ firstPlayer: 'B' });
  const occupancy = { ...initial.board.occupancy };
  for (const node of NODE_IDS) occupancy[node] = null;
  for (const [node, player] of Object.entries({ P03: 'B', P13: 'B', P02: 'A',
    P04: 'A', P27: 'A', P08: 'A', P09: 'A', P07: 'A', P26: 'A', P28: 'A',
    P12: 'A', P14: 'A', P18: 'A', P19: 'A', P17: 'A' })) {
    occupancy[node as typeof NODE_IDS[number]] = player as 'A' | 'B';
  }
  const state = { ...initial, board: { occupancy } };
  assert.deepEqual(RuleEngine.getAllLegalMoves(state), []);
  const positions = [{ id: 'ambiguity-test', description: 'Test-only ambiguity',
    source: 'test fixture', ply: 0, expectedStatus: 'PLAYING' as const,
    currentPlayer: 'B' as const, tags: [] as const, state }];
  const fixed = runFixedDepth({ positions, depths: [1], repetitions: 1,
    warmups: 1, benchmarkId: 'ambiguity-test' });
  assert.equal(fixed.length, 4);
  assert.ok(fixed.every(row => row.status === 'RULE_AMBIGUITY'));
  const timed = runTimeBudget({ positions, budgetsMs: [20], maxDepth: 2,
    repetitions: 1, warmups: 1, benchmarkId: 'ambiguity-test' });
  assert.equal(timed.length, 1);
  assert.equal(timed[0].status, 'RULE_AMBIGUITY');
});

test('seeded self-play is reproducible and swaps sides in pairs', () => {
  const options = { matchup: ['RANDOM', 'MINIMAX'] as const, games: 2, seed: 17,
    maxPlies: 4, fixedDepth: 1, timeBudgetMs: 10, benchmarkId: 'unit-selfplay' };
  const first = runSelfPlay(options);
  const second = runSelfPlay(options);
  assert.equal(first.length, 2);
  assert.deepEqual(first.map(row => row.moveSequenceHash),
    second.map(row => row.moveSequenceHash));
  assert.deepEqual(first.map(row => [row.algorithmA, row.algorithmB]),
    [['RANDOM', 'MINIMAX'], ['MINIMAX', 'RANDOM']]);
  assert.deepEqual(first.map(row => row.pairSeed), [17, 17]);
  assert.ok(first.every(row => row.firstPlayer === 'A' && row.plies <= 4));
});

test('max plies and rule ambiguity never become draws or losses', () => {
  const rows = runSelfPlay({ matchup: ['RANDOM', 'RANDOM'], games: 2, seed: 11,
    maxPlies: 1, fixedDepth: 1, timeBudgetMs: 10, benchmarkId: 'unit-cap' });
  assert.ok(rows.every(row => row.terminationReason === 'MAX_PLIES_REACHED' &&
    row.winner === null && row.winnerAlgorithm === null && row.draws === 0));
  assert.deepEqual(classifySelfPlayError(new RuleAmbiguityError()),
    { terminationReason: 'RULE_AMBIGUITY', error: 'RULE_AMBIGUITY' });
  assert.throws(() => runSelfPlay({ matchup: ['RANDOM', 'RANDOM'], games: 3,
    seed: 1, maxPlies: 1, fixedDepth: 1, timeBudgetMs: 10,
    benchmarkId: 'unpaired' }), /even/);
});

test('100, 500, and 1000 requested games distribute as paired total games', () => {
  assert.deepEqual(allocatePairedGames(100, 4), [26, 26, 24, 24]);
  assert.deepEqual(allocatePairedGames(500, 4), [126, 126, 124, 124]);
  assert.deepEqual(allocatePairedGames(1000, 4), [250, 250, 250, 250]);
  assert.throws(() => allocatePairedGames(7, 4), /even|pair/i);
});

test('raw CSV preserves columns and summaries recompute from decoded raw rows', () => {
  const search = runFixedDepth({ positions: buildPositionSuite().slice(0, 1),
    depths: [1], repetitions: 2, warmups: 1, benchmarkId: 'csv-test' });
  const csv = encodeCsv(search, SEARCH_COLUMNS);
  assert.deepEqual(decodeCsv(csv)[0], SEARCH_COLUMNS);
  assert.equal(decodeCsv(csv).length, search.length + 1);
  assert.deepEqual(summarizeSearch(decodeCsv(csv).slice(1)), summarizeSearch(search));
  const summary = summarizeSearch(search);
  assert.ok(summary.every(row => Number(row.minTimeMs) <= Number(row.medianTimeMs) &&
    Number(row.medianTimeMs) <= Number(row.maxTimeMs)));
  const ablations = computeAblations(search);
  assert.equal(ablations.filter(row => row.positionId === 'ALL').length, 3);
  assert.equal(ablations.filter(row => row.positionId === 'opening').length, 3);
  const games = runSelfPlay({ matchup: ['RANDOM', 'RANDOM'], games: 2, seed: 1,
    maxPlies: 1, fixedDepth: 1, timeBudgetMs: 10, benchmarkId: 'csv-self' });
  const gameCsv = encodeCsv(games, SELFPLAY_COLUMNS);
  assert.deepEqual(decodeCsv(gameCsv)[0], SELFPLAY_COLUMNS);
  assert.deepEqual(summarizeSelfPlay(decodeCsv(gameCsv).slice(1)), summarizeSelfPlay(games));
  assert.equal(summarizeSelfPlay(games)[0].maxPliesReached, 2);
  assert.equal(summarizeSelfPlay(games)[0].draws, 0);
});

test('metadata and artifacts are created with traceable deterministic config hash', () => {
  const config = { profile: 'unit', depths: [1], repetitions: 1, seed: 7 };
  const metadata = collectMetadata('search', config);
  assert.ok(metadata.timestamp && metadata.os && metadata.cpu &&
    metadata.cores > 0 && metadata.ramBytes > 0 && metadata.nodeVersion &&
    metadata.evaluationConfig && metadata.positionSuiteVersion && metadata.configHash);
  assert.equal(collectMetadata('search', config).configHash, metadata.configHash);
  assert.notEqual(collectMetadata('search', config,
    { ...metadata.evaluationConfig, materialWeight: 101 }).configHash,
  metadata.configHash);
  const directory = mkdtempSync(join(tmpdir(), 'wuma-benchmark-test-'));
  try {
    const rows = runFixedDepth({ positions: buildPositionSuite().slice(0, 1),
      depths: [1], repetitions: 1, warmups: 0, benchmarkId: 'artifact-test' });
    const files = writeSearchArtifacts(directory, 'unit-run', rows, metadata);
    assert.ok(readFileSync(files.rawCsv, 'utf8').includes('benchmarkId'));
    assert.deepEqual(summarizeSearch(decodeCsv(readFileSync(files.rawCsv, 'utf8')).slice(1)),
      summarizeSearch(rows));
    assert.ok(readFileSync(files.summaryCsv, 'utf8').includes('medianTimeMs'));
    assert.ok(readFileSync(files.metadataJson, 'utf8').includes(metadata.configHash));
    assert.ok(readFileSync(files.reportMd, 'utf8').includes('MCTS: NOT_IMPLEMENTED'));
    assert.equal(verifyArtifacts(files, 'search').rawRows, rows.length);
    const originalRaw = readFileSync(files.rawCsv, 'utf8');
    assert.throws(() => writeSearchArtifacts(directory, 'unit-run', [], metadata),
      /exist|overwrite|collision/i);
    assert.equal(readFileSync(files.rawCsv, 'utf8'), originalRaw);
    writeFileSync(files.summaryCsv, 'incorrect summary\n');
    assert.throws(() => verifyArtifacts(files, 'search'), /summary/i);
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('self-play writer refuses to replace an existing run ID', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wuma-selfplay-collision-'));
  try {
    const metadata = collectMetadata('selfplay', { profile: 'unit', seed: 25 });
    const files = writeSelfPlayArtifacts(directory, 'same-run', [], metadata);
    const originalRaw = readFileSync(files.rawCsv, 'utf8');
    assert.throws(() => writeSelfPlayArtifacts(directory, 'same-run', [], metadata),
      /exist|overwrite|collision/i);
    assert.equal(readFileSync(files.rawCsv, 'utf8'), originalRaw);
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  }
});
