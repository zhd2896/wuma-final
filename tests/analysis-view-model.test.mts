import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { RuleEngine, createInitialGameState } from '../miniprogram/domain/index.ts';
import type { GameState } from '../miniprogram/domain/index.ts';

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

const { analyzePosition } = await import('../miniprogram/ai/position-analysis.ts');
const { mapPositionAnalysis } = await import(
  '../miniprogram/pages/analysis/analysis-view-model.ts');

test('maps a real position into board, score rows, occupied key pieces and candidates', () => {
  const state = createInitialGameState();
  const analysis = analyzePosition(state,
    { maxDepth: 1, timeLimitMs: 1000, now: () => 0 });
  const view = mapPositionAnalysis(state, analysis);

  assert.equal(view.board.pieces.length, 10);
  assert.equal(view.perspective, state.current_player);
  assert.equal(view.score, analysis.evaluationBefore.score);
  assert.equal(view.bestScore, analysis.bestScore);
  assert.deepEqual(view.breakdown.map((row: any) => row.key), [
    'material', 'reserve', 'mobility', 'templeControl',
    'captureOpportunity', 'vulnerability', 'trapRisk',
  ]);
  assert.deepEqual(view.candidates.map((row: any) => row.score),
    analysis.candidateMoves.map((row: any) => row.score));
  assert.deepEqual(view.candidates.map((row: any) => row.notation),
    analysis.candidateMoves.map((row: any) => `${row.move.from} → ${row.move.to}`));
  assert.ok(view.keyPieces.length > 0);
  assert.ok(view.keyPieces.every((row: any) =>
    state.board.occupancy[row.nodeId] !== null));
  assert.equal(view.board.recommendedFrom, analysis.bestMove?.from);
  assert.equal(view.board.recommendedTo, analysis.bestMove?.to);
});

test('terminal analysis has no invented recommendation or candidates', () => {
  const initial = createInitialGameState();
  const terminal: GameState = { ...initial, game_status: 'FINISHED', winner: 'A',
    winner_reason: 'CAPTURE_ALL' };
  const analysis = analyzePosition(terminal,
    { maxDepth: 1, timeLimitMs: 1000, now: () => 0 });
  const view = mapPositionAnalysis(terminal, analysis);

  assert.equal(view.terminal, true);
  assert.equal(view.bestMove, null);
  assert.deepEqual(view.candidates, []);
  assert.equal(view.board.recommendedFrom, undefined);
  assert.equal(view.board.recommendedTo, undefined);
});

test('explains a lone-piece disadvantage with facts and equal alternatives, without implying loss', async () => {
  const { evaluatePosition } = await import('../miniprogram/ai/evaluation.ts');
  const initial = createInitialGameState();
  const occupancy = Object.fromEntries(Object.keys(initial.board.occupancy).map(id => [id, null]));
  occupancy.P29 = 'A';
  for (const id of ['P03', 'P27', 'P01', 'P05', 'P06', 'P10', 'P16', 'P20', 'P25']) occupancy[id] = 'B';
  const state = { ...initial, board: { ...initial.board, occupancy },
    players: { ...initial.players, A: { ...initial.players.A, reserve_count: 4 },
      B: { ...initial.players.B, reserve_count: 0 } } } as GameState;
  const evaluation = evaluatePosition(state, 'A');
  const base = analyzePosition(initial, { maxDepth: 1, timeLimitMs: 1000, now: () => 0 });
  const analysis = { ...base, evaluationBefore: evaluation, evaluationBreakdown: evaluation.breakdown,
    bestScore: -809.5, bestMove: { from: 'P29', to: 'P26' }, threats: [], searchDepth: 2,
    candidateMoves: ['P26', 'P28'].map((to, index) => ({ move: { from: 'P29', to },
      score: -809.5, rank: index + 1, scorePerspective: 'A', isBest: index === 0 })) } as any;
  const view = mapPositionAnalysis(state, analysis, 'A');
  assert.equal(view.presentation.title, '你处于明显劣势');
  assert.ok(view.presentation.reasons.some((reason: string) => /盘上.*少 8 颗/.test(reason)));
  assert.ok(view.presentation.reasons.some((reason: string) => /孤棋.*2 个合法走法/.test(reason)));
  assert.doesNotMatch(JSON.stringify(view.presentation), /必输|已输|胜率/);
  assert.equal(view.candidates[1].assessment, '当前分析下相当');
  assert.doesNotMatch(view.candidates[1].detail, /引擎评分/);
  assert.match(view.bestMove!.detail, /宝顶.*庙宇左翼/);
  assert.equal(view.scoreText, evaluation.score.toFixed(1));
  assert.equal(view.perspectiveLabel, '你');
  assert.equal(mapPositionAnalysis(state, analysis, 'B').perspectiveLabel, 'AI');
});

test('keeps finite-search caveats and only declares a winner for adjudicated positions', () => {
  const state = createInitialGameState();
  const base = analyzePosition(state, { maxDepth: 1, timeLimitMs: 1000, now: () => 0 });
  const limited = mapPositionAnalysis(state, { ...base, searchDepth: 0, timedOut: true });
  assert.match(limited.presentation.quality, /分析有限/);
  assert.doesNotMatch(limited.presentation.title, /获胜|必胜/);
  const huge = mapPositionAnalysis(state, { ...base, bestScore: 1_000_000 });
  assert.doesNotMatch(huge.presentation.title, /获胜|必胜/);
  const finished = { ...state, game_status: 'FINISHED', winner: 'B',
    winner_reason: 'ALL_PIECES_IMMOBILIZED' } as GameState;
  const terminal = mapPositionAnalysis(finished, analyzePosition(finished), 'A');
  assert.equal(terminal.presentation.title, 'AI 获胜');
  assert.match(terminal.presentation.reasons.join(''), /所有棋子.*合法走法/);
  assert.match(terminal.presentation.reasons[0], /^你/);
  assert.equal(terminal.bestMove, null);
});

test('separates a proved blockade from a static risk and displays proof length', () => {
  const state = createInitialGameState();
  const base = analyzePosition(state, { maxDepth: 1, timeLimitMs: 1000, now: () => 0 });
  const proved = mapPositionAnalysis(state, { ...base, threats: [{
    type: 'FORCED_BLOCKADE_AVAILABLE', player: 'A', relatedMove: base.bestMove!,
    evidence: { maxPlies: 5 },
  }] });
  assert.equal(proved.presentation.title, '黑方可强制围堵获胜');
  assert.match(proved.presentation.reasons.join(''), /最多 5 手/);
  assert.doesNotMatch(proved.presentation.title, /已获胜/);
  const verifiedWithoutBaseSearch = mapPositionAnalysis(state, { ...base, searchDepth: 0,
    threats: [{ type: 'FORCED_BLOCKADE_AVAILABLE', player: 'A', relatedMove: base.bestMove!,
      evidence: { maxPlies: 5 } }] });
  assert.match(verifiedWithoutBaseSearch.presentation.basisLabel, /已验证/);
  assert.doesNotMatch(verifiedWithoutBaseSearch.presentation.quality, /尚未完成前瞻搜索/);
});

test('display bands preserve score direction and rounded scores do not create false ties', () => {
  const state = createInitialGameState();
  const base = analyzePosition(state, { maxDepth: 1, timeLimitMs: 1000, now: () => 0 });
  for (const [score, title] of [[149.9, '双方局面接近'], [150, '黑方稍占优势'],
    [400, '黑方占明显优势'], [-150, '黑方稍处劣势'], [-400, '黑方处于明显劣势']] as const) {
    assert.equal(mapPositionAnalysis(state, { ...base,
      evaluationBefore: { ...base.evaluationBefore, score } }).presentation.title, title);
  }
  const move = base.candidateMoves[1].move;
  const different = mapPositionAnalysis(state, { ...base, bestScore: 400,
    candidateMoves: [{ ...base.candidateMoves[0], score: 400 },
      { move, score: 399.99, rank: 2, isBest: false, scorePerspective: 'A' }] });
  assert.equal(different.candidates[1].scoreText, '400.0');
  assert.equal(different.candidates[1].assessment, '备选走法');
  assert.ok(different.alternatives.every((candidate: any) => candidate.id !== different.bestMove!.id));
});

test('current position verdict and reasons do not borrow an unexplained future search score', () => {
  const state = createInitialGameState();
  const base = analyzePosition(state, { maxDepth: 1, timeLimitMs: 1000, now: () => 0 });
  const staticScore = base.evaluationBefore.score;
  const changed = mapPositionAnalysis(state, { ...base, threats: [], bestScore: -850 });
  const current = mapPositionAnalysis(state, { ...base, threats: [], bestScore: staticScore });
  assert.equal(changed.presentation.title, current.presentation.title);
  assert.match(changed.presentation.outlook, /后续.*黑方.*劣势/);
  assert.doesNotMatch(current.presentation.outlook, /劣势/);
  assert.equal(mapPositionAnalysis(state, { ...base, threats: [], bestScore: -850,
    searchDepth: 0 }).presentation.outlook, '');
});

test('displayed purposes respect real captures and insufficient reserve', () => {
  const initial = createInitialGameState();
  const occupancy = { ...initial.board.occupancy };
  for (const id of Object.keys(occupancy)) occupancy[id as keyof typeof occupancy] = null;
  Object.assign(occupancy, { P01: 'A', P04: 'A', P02: 'B', P29: 'B' });
  const state = { ...initial, board: { occupancy } };
  const analysis = analyzePosition(state, { maxDepth: 1, timeLimitMs: 1000, now: () => 0 });
  const move = { from: 'P04', to: 'P03' } as const;
  const selected = { ...analysis, bestMove: move, candidateMoves: [{ move, rank: 1,
    score: analysis.bestScore, scorePerspective: 'A', isBest: true }] } as any;
  const saved = structuredClone(state);
  assert.match(mapPositionAnalysis(state, selected).bestMove!.purpose, /吃掉.*1 颗/);
  assert.deepEqual(state, saved);
  const noReserve = { ...state, players: { ...state.players,
    A: { ...state.players.A, reserve_count: 0 } } };
  const withoutCapture = mapPositionAnalysis(noReserve, selected);
  assert.match(withoutCapture.bestMove!.purpose, /备用棋不足.*吃子.*生效/);
  assert.doesNotMatch(withoutCapture.bestMove!.purpose, /可吃掉/);
});

test('only the route with blockade evidence gets a proven purpose', () => {
  const state = createInitialGameState();
  const base = analyzePosition(state, { maxDepth: 1, timeLimitMs: 1000, now: () => 0 });
  const proved = mapPositionAnalysis(state, { ...base, threats: [{
    type: 'FORCED_BLOCKADE_AVAILABLE', player: 'A', relatedMove: base.bestMove!,
    evidence: { maxPlies: 5 },
  }] });
  assert.match(proved.bestMove!.purpose, /围堵.*最多 5 手/);
  assert.ok(proved.alternatives.every((candidate: any) => !/已验证.*围堵/.test(candidate.purpose)));
});

test('direct immobilization purpose comes from executing a real winning turn', () => {
  const initial = createInitialGameState({ firstPlayer: 'B' });
  const occupancy = { ...initial.board.occupancy };
  for (const id of Object.keys(occupancy)) occupancy[id as keyof typeof occupancy] = null;
  Object.assign(occupancy, { P29: 'A', P26: 'B', P27: 'B', P03: 'B' });
  const state = { ...initial, board: { occupancy } };
  const analysis = analyzePosition(state, { maxDepth: 1, timeLimitMs: 1000, now: () => 0 });
  const view = mapPositionAnalysis(state, analysis, 'A');
  assert.ok(view.bestMove);
  const turn = RuleEngine.executeTurn(state, view.bestMove!.move);
  assert.equal(turn.state.game_status, 'FINISHED');
  assert.equal(turn.state.winner, 'B');
  assert.match(view.bestMove!.purpose, /使你无合法走法.*直接获胜/);
  assert.equal(state.game_status, 'PLAYING');
});

test('lone-piece purpose states actual available moves without promising escape', () => {
  const initial = createInitialGameState();
  const occupancy = { ...initial.board.occupancy };
  for (const id of Object.keys(occupancy)) occupancy[id as keyof typeof occupancy] = null;
  Object.assign(occupancy, { P29: 'A', P28: 'B', P03: 'B', P01: 'B' });
  const state = { ...initial, board: { occupancy } };
  const analysis = analyzePosition(state, { maxDepth: 1, timeLimitMs: 1000, now: () => 0 });
  const view = mapPositionAnalysis(state, analysis);
  assert.ok(view.bestMove);
  const after = RuleEngine.executeTurn(state, view.bestMove!.move).state;
  const count = RuleEngine.getAllLegalMovesForPlayer(after, 'A').length;
  assert.ok(view.bestMove!.purpose.includes(`暂有 ${count} 个合法走法`));
  assert.doesNotMatch(view.bestMove!.purpose, /保证|安全|必胜|成功脱困/);
});
