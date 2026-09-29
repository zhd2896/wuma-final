import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { NODE_IDS, RuleEngine, createInitialGameState } from '../miniprogram/domain/index.ts';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') && context.parentURL &&
          (error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') {
        const tsUrl = new URL(`${specifier}.ts`, context.parentURL);
        if (existsSync(tsUrl)) return nextResolve(tsUrl.href, context);
      }
      throw error;
    }
  },
});

const { AlphaBetaAI } = await import('../miniprogram/ai/alpha-beta.ts');
const { MinimaxAI, RuleAmbiguityError } = await import('../miniprogram/ai/minimax.ts');
const { DEFAULT_EVALUATION_CONFIG } = await import('../miniprogram/ai/evaluation.ts');
const { hashGameState, stateSignature } = await import('../miniprogram/ai/zobrist.ts');

function withPieces(pieces: Record<string, 'A' | 'B'>, currentPlayer: 'A' | 'B' = 'A') {
  const initial = createInitialGameState({ firstPlayer: currentPlayer });
  const occupancy = { ...initial.board.occupancy };
  for (const node of NODE_IDS) occupancy[node] = null;
  for (const [node, player] of Object.entries(pieces)) {
    occupancy[node as typeof NODE_IDS[number]] = player;
  }
  return { ...initial, board: { occupancy } };
}

function key(move: { from: string; to: string }) { return `${move.from}:${move.to}`; }
function scores(result: { candidateMoves: readonly { move: { from: string; to: string }; score: number }[] }) {
  return new Map(result.candidateMoves.map(item => [key(item.move), item.score]));
}

const neutralConfig = {
  ...DEFAULT_EVALUATION_CONFIG,
  materialWeight: 0, reserveWeight: 0, mobilityWeight: 0,
  templeControlWeight: 0, captureOpportunityWeight: 0,
  vulnerabilityWeight: 0, trapRiskWeight: 0,
};

test('TT search computes a full Zobrist hash only for the root', () => {
  const state = withPieces({ P01: 'A', P06: 'A', P05: 'B', P10: 'B' });
  let fullHashes = 0;
  const result = new AlphaBetaAI({ depth: 3, useMoveOrdering: true,
    useTranspositionTable: true }).search(state, state.current_player,
    { onFullHashComputed: () => { fullHashes++; } });
  assert.ok(result.nodesSearched > 1);
  assert.equal(fullHashes, 1);
  assert.equal(result.evaluationScore, new MinimaxAI({ depth: 3 }).search(state).evaluationScore);
});

test('two different real legal move sequences reach the same searchable position', () => {
  const state = withPieces({ P01: 'A', P06: 'A', P05: 'B', P10: 'B' });
  const left = [
    { from: 'P01', to: 'P02' }, { from: 'P05', to: 'P04' },
    { from: 'P06', to: 'P07' },
  ] as const;
  const right = [
    { from: 'P06', to: 'P07' }, { from: 'P05', to: 'P04' },
    { from: 'P01', to: 'P02' },
  ] as const;
  let first = state;
  let second = state;
  for (const move of left) {
    assert.equal(RuleEngine.validateMove(first, move), true);
    first = RuleEngine.executeTurn(first, move).state;
  }
  for (const move of right) {
    assert.equal(RuleEngine.validateMove(second, move), true);
    second = RuleEngine.executeTurn(second, move).state;
  }
  assert.equal(first.game_status, 'PLAYING');
  assert.deepEqual(first, second);
  assert.equal(stateSignature(first), stateSignature(second));
  assert.equal(hashGameState(first), hashGameState(second));
});

test('TT scores and every exact root candidate match all three baselines at depths 1–3', () => {
  const cases = [
    { state: withPieces({ P01: 'A', P06: 'A', P05: 'B', P10: 'B' }), depth: 1 },
    { state: withPieces({ P27: 'B', P08: 'A', P26: 'A', P28: 'A' }, 'B'), depth: 2 },
    { state: withPieces({ P26: 'B', P28: 'A', P29: 'A', P03: 'A' }), depth: 3 },
  ];
  for (const { state, depth } of cases) {
    const snapshot = structuredClone(state);
    for (const rootPlayer of ['A', 'B'] as const) {
      const minimax = new MinimaxAI({ depth }).search(state, rootPlayer);
      const plain = new AlphaBetaAI({ depth }).search(state, rootPlayer);
      const ordered = new AlphaBetaAI({ depth, useMoveOrdering: true }).search(state, rootPlayer);
      const cached = new AlphaBetaAI({
        depth, useMoveOrdering: true, useTranspositionTable: true,
      }).search(state, rootPlayer);
      assert.equal(cached.evaluationScore, minimax.evaluationScore);
      assert.equal(cached.evaluationScore, plain.evaluationScore);
      assert.equal(cached.evaluationScore, ordered.evaluationScore);
      assert.deepEqual(scores(cached), scores(minimax));
      assert.equal(cached.scorePerspective, rootPlayer);
      assert.equal(cached.algorithm, 'ALPHA_BETA');
      assert.equal(cached.candidateMoves.length, RuleEngine.getAllLegalMoves(state).length);
      assert.equal(RuleEngine.validateMove(state, cached.bestMove!), true);
      assert.equal(scores(cached).get(key(cached.bestMove!)), cached.evaluationScore);
      assert.ok(cached.ttProbes > 0);
      assert.ok(cached.ttStores > 0);
      assert.ok(cached.ttSize > 0);
      assert.equal(plain.ttHits, 0);
      assert.equal(ordered.ttHits, 0);
    }
    assert.deepEqual(state, snapshot);
  }
});

test('search-local TT gets a real hit from the commuting move sequences', t => {
  const state = withPieces({ P01: 'A', P06: 'A', P05: 'B', P10: 'B' });
  const without = new AlphaBetaAI({
    depth: 3, useMoveOrdering: true, evaluationConfig: neutralConfig,
  }).search(state);
  const withTT = new AlphaBetaAI({
    depth: 3, useMoveOrdering: true, useTranspositionTable: true,
    evaluationConfig: neutralConfig,
  }).search(state);
  assert.equal(withTT.evaluationScore, without.evaluationScore);
  assert.deepEqual(scores(withTT), scores(without));
  assert.ok(withTT.ttHits > 0);
  assert.ok(withTT.ttProbes >= withTT.ttHits);
  assert.ok(withTT.ttStores > 0);
  assert.ok(withTT.ttSize > 0);
  assert.ok(withTT.nodesSearched <= without.nodesSearched);
  t.diagnostic(JSON.stringify({
    fixture: 'commuting A moves P01→P02 and P06→P07, B P05→P04',
    depth: 3, score: withTT.evaluationScore, bestMove: withTT.bestMove,
    withoutNodes: without.nodesSearched, withoutCutoffs: without.cutoffs,
    withoutTimeMs: without.thinkingTimeMs,
    withNodes: withTT.nodesSearched, withCutoffs: withTT.cutoffs,
    probes: withTT.ttProbes, hits: withTT.ttHits, ttCutoffs: withTT.ttCutoffs,
    stores: withTT.ttStores, size: withTT.ttSize, withTimeMs: withTT.thinkingTimeMs,
  }));
});

test('immediate win, defensive reply and faster mate keep their choices', () => {
  const immediate = withPieces({ P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A' });
  const win = new AlphaBetaAI({ depth: 1, useMoveOrdering: true,
    useTranspositionTable: true }).search(immediate);
  assert.equal(win.evaluationScore, DEFAULT_EVALUATION_CONFIG.mateScore - 1);
  assert.equal(RuleEngine.executeTurn(immediate, win.bestMove!).state.winner, 'A');

  const defensive = withPieces({ P27: 'B', P08: 'A', P26: 'A', P28: 'A' }, 'B');
  const defenseConfig = { ...neutralConfig, templeControlWeight: 10 };
  const defense = new AlphaBetaAI({ depth: 2, evaluationConfig: defenseConfig,
    useMoveOrdering: true, useTranspositionTable: true }).search(defensive);
  assert.deepEqual(defense.bestMove, { from: 'P27', to: 'P03' });
  assert.equal(defense.evaluationScore, -20);

  const fast = withPieces({ P26: 'B', P28: 'A', P29: 'A', P03: 'A' });
  const fastResult = new AlphaBetaAI({ depth: 3, evaluationConfig: neutralConfig,
    useMoveOrdering: true, useTranspositionTable: true }).search(fast);
  assert.deepEqual(fastResult.bestMove, { from: 'P28', to: 'P27' });
  assert.equal(fastResult.evaluationScore, neutralConfig.mateScore - 1);
  assert.equal(scores(fastResult).get('P29:P27'), neutralConfig.mateScore - 3);
});

test('depth four slow loss keeps exact candidate scores and input immutability', t => {
  const state = withPieces({
    P03: 'B', P04: 'A', P27: 'A', P08: 'A',
    P09: 'A', P07: 'A', P26: 'A', P06: 'A',
  }, 'B');
  const snapshot = structuredClone(state);
  const minimax = new MinimaxAI({ depth: 4, evaluationConfig: neutralConfig }).search(state);
  const plain = new AlphaBetaAI({ depth: 4, evaluationConfig: neutralConfig }).search(state);
  const ordered = new AlphaBetaAI({ depth: 4, evaluationConfig: neutralConfig,
    useMoveOrdering: true }).search(state);
  const cached = new AlphaBetaAI({ depth: 4, evaluationConfig: neutralConfig,
    useMoveOrdering: true, useTranspositionTable: true }).search(state);
  assert.equal(cached.evaluationScore, -neutralConfig.mateScore + 4);
  assert.equal(cached.evaluationScore, minimax.evaluationScore);
  assert.equal(cached.evaluationScore, plain.evaluationScore);
  assert.equal(cached.evaluationScore, ordered.evaluationScore);
  assert.deepEqual(scores(cached), scores(minimax));
  assert.ok(['P02', 'P28'].includes(cached.bestMove!.to));
  assert.equal(scores(cached).get(key(cached.bestMove!)), cached.evaluationScore);
  assert.ok(cached.ttHits > 0);
  assert.ok(cached.nodesSearched < ordered.nodesSearched);
  assert.deepEqual(state, snapshot);
  t.diagnostic(JSON.stringify({
    fixture: 'P03 lone B, seven A blockers', depth: 4,
    minimaxScore: minimax.evaluationScore, plainScore: plain.evaluationScore,
    orderedScore: ordered.evaluationScore, ttScore: cached.evaluationScore,
    bestMove: cached.bestMove,
    withoutNodes: ordered.nodesSearched, withoutCutoffs: ordered.cutoffs,
    withoutTimeMs: ordered.thinkingTimeMs,
    withNodes: cached.nodesSearched, withCutoffs: cached.cutoffs,
    probes: cached.ttProbes, ttHits: cached.ttHits, ttCutoffs: cached.ttCutoffs,
    stores: cached.ttStores, size: cached.ttSize, withTimeMs: cached.thinkingTimeMs,
  }));
});

test('all three finished winner reasons retain signed mate scores', () => {
  const states = [
    RuleEngine.executeTurn(withPieces({
      P11: 'A', P12: 'B', P08: 'B', P18: 'B', P19: 'A',
    }), { from: 'P19', to: 'P13' }).state,
    RuleEngine.executeTurn(withPieces({
      P27: 'B', P26: 'A', P28: 'A', P29: 'A', P03: 'A', P21: 'A',
    }), { from: 'P21', to: 'P22' }).state,
    RuleEngine.executeTurn(withPieces({
      P03: 'B', P02: 'A', P04: 'A', P27: 'A', P08: 'A',
      P09: 'A', P07: 'A', P26: 'A', P28: 'A', P21: 'A',
    }), { from: 'P21', to: 'P22' }).state,
  ];
  assert.deepEqual(states.map(state => state.winner_reason),
    ['CAPTURE_ALL', 'TEMPLE_TRAP', 'LONE_PIECE_IMMOBILIZED']);
  for (const state of states) {
    for (const rootPlayer of ['A', 'B'] as const) {
      const cached = new AlphaBetaAI({ depth: 3, useMoveOrdering: true,
        useTranspositionTable: true }).search(state, rootPlayer);
      assert.equal(cached.evaluationScore,
        (rootPlayer === state.winner ? 1 : -1) * DEFAULT_EVALUATION_CONFIG.mateScore);
      assert.equal(cached.bestMove, null);
      assert.equal(cached.nodesSearched, 1);
    }
  }
});

test('each search starts with an empty TT and different perspectives do not share scores', () => {
  const state = withPieces({ P27: 'B', P08: 'A', P26: 'A', P28: 'A' }, 'B');
  const ai = new AlphaBetaAI({ depth: 2, useMoveOrdering: true,
    useTranspositionTable: true });
  const first = ai.search(state, 'A');
  const second = ai.search(state, 'B');
  const repeat = ai.search(state, 'A');
  assert.equal(first.evaluationScore, new MinimaxAI({ depth: 2 }).search(state, 'A').evaluationScore);
  assert.equal(second.evaluationScore, new MinimaxAI({ depth: 2 }).search(state, 'B').evaluationScore);
  assert.deepEqual(first.candidateMoves, repeat.candidateMoves);
  assert.equal(first.ttProbes, repeat.ttProbes);
  assert.equal(first.ttHits, repeat.ttHits);
  assert.equal(first.ttSize, repeat.ttSize);
});

test('RULE_AMBIGUITY is still thrown and cannot become a cached score', () => {
  const state = withPieces({
    P03: 'B', P13: 'B', P02: 'A', P04: 'A', P27: 'A', P08: 'A',
    P09: 'A', P07: 'A', P26: 'A', P28: 'A', P12: 'A', P14: 'A',
    P18: 'A', P19: 'A', P17: 'A',
  }, 'B');
  const ai = new AlphaBetaAI({ depth: 1, useMoveOrdering: true,
    useTranspositionTable: true });
  assert.throws(() => ai.search(state), RuleAmbiguityError);
  assert.throws(() => ai.search(state), RuleAmbiguityError);
});
