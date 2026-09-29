import { RuleEngine, TEMPLE_NODES, countPieces, createInitialGameState } from '../../miniprogram/domain/index.ts';
import type { GameState, Move, NodeId, Player } from '../../miniprogram/domain/index.ts';
import { hasCaptureOpportunity } from '../../miniprogram/ai/evaluation.ts';
import { RandomAI } from '../../miniprogram/ai/random-ai.ts';
import { createSeededRng } from './seeded-rng.mts';

export const POSITION_SUITE_VERSION = 'phase25_v1';
export type PositionTag = 'OPENING' | 'MIDGAME' | 'CAPTURE_AVAILABLE' | 'TACTICAL' |
  'TEMPLE_RELATED' | 'LONE_PIECE_RISK' | 'FORCED_WIN' | 'DEFENSIVE';

export interface BenchmarkPosition {
  readonly id: string;
  readonly description: string;
  readonly source: string;
  readonly ply: number;
  readonly expectedStatus: 'PLAYING';
  readonly currentPlayer: Player;
  readonly tags: readonly PositionTag[];
  readonly state: GameState;
}

// Prefix of the canonical finished-game fixture in scripts/phase24-devtool-e2e.cjs.
const historical: readonly (readonly [NodeId, NodeId])[] = [
  ['P01', 'P19'], ['P05', 'P01'], ['P16', 'P18'], ['P01', 'P07'],
  ['P18', 'P13'], ['P07', 'P03'], ['P11', 'P17'], ['P10', 'P07'],
  ['P06', 'P11'], ['P15', 'P14'], ['P17', 'P22'], ['P14', 'P04'],
  ['P19', 'P23'], ['P20', 'P17'],
];
const temple: readonly (readonly [NodeId, NodeId])[] = [
  ['P01', 'P02'], ['P05', 'P04'], ['P02', 'P03'], ['P04', 'P09'], ['P03', 'P26'],
];

export function replaySequence(moves: readonly Move[]): GameState {
  let state = createInitialGameState();
  for (const move of moves) {
    if (state.game_status !== 'PLAYING') throw new Error('Source move follows a finished game');
    if (!RuleEngine.validateMove(state, move)) throw new Error('Invalid source move');
    state = RuleEngine.executeTurn(state, move).state;
  }
  return state;
}

function replayPairs(sequence: readonly (readonly [NodeId, NodeId])[], plies: number): GameState {
  return replaySequence(sequence.slice(0, plies).map(([from, to]) => ({ from, to })));
}

function seededPosition(seed: number, plies: number): GameState {
  const ai = new RandomAI(createSeededRng(seed));
  let state = createInitialGameState();
  for (let ply = 0; ply < plies; ply++) {
    if (state.game_status !== 'PLAYING') throw new Error('Seeded source finished too early');
    const move = ai.chooseMove(state);
    if (!move) throw new Error('Seeded source has no legal move');
    state = RuleEngine.executeTurn(state, move).state;
  }
  return state;
}

function evidence(state: GameState, ply: number): ReadonlySet<PositionTag> {
  const legal = RuleEngine.getAllLegalMoves(state);
  const captureCount = legal.filter(move => RuleEngine.executeTurn(state, move).captures.was_applied).length;
  const winCount = legal.filter(move => {
    const after = RuleEngine.executeTurn(state, move).state;
    return after.game_status === 'FINISHED' && after.winner === state.current_player;
  }).length;
  const opponent: Player = state.current_player === 'A' ? 'B' : 'A';
  const threatened = hasCaptureOpportunity(state, opponent);
  const tags = new Set<PositionTag>();
  if (ply === 0) tags.add('OPENING');
  if (ply >= 4) tags.add('MIDGAME');
  if (captureCount > 0) tags.add('CAPTURE_AVAILABLE');
  if (captureCount > 0 && threatened || winCount > 0) tags.add('TACTICAL');
  if (Object.entries(state.board.occupancy).some(([node, player]) =>
    player !== null && TEMPLE_NODES.includes(node as NodeId))) tags.add('TEMPLE_RELATED');
  if (Math.min(countPieces(state.board, 'A'), countPieces(state.board, 'B')) === 1) {
    tags.add('LONE_PIECE_RISK');
  }
  if (winCount > 0) tags.add('FORCED_WIN');
  if (threatened) tags.add('DEFENSIVE');
  return tags;
}

function position(id: string, description: string, source: string, ply: number,
                  tags: readonly PositionTag[], state: GameState): BenchmarkPosition {
  if (state.game_status !== 'PLAYING' || RuleEngine.getAllLegalMoves(state).length === 0) {
    throw new Error(`Benchmark position ${id} is not a playable canonical state`);
  }
  const observed = evidence(state, ply);
  for (const tag of tags) if (!observed.has(tag)) {
    throw new Error(`Benchmark position ${id} lacks evidence for ${tag}`);
  }
  return { id, description, source, ply, expectedStatus: 'PLAYING',
    currentPlayer: state.current_player, tags, state };
}

/** All eight states are replayed through canonical legal turns, never hand-built boards. */
export function buildPositionSuite(): BenchmarkPosition[] {
  return [
    position('opening', 'Initial five-piece position', 'canonical:initial', 0,
      ['OPENING'], createInitialGameState()),
    position('capture', 'Historical reply with capture options', 'canonical:finished_fixture#ply=1', 1,
      ['CAPTURE_AVAILABLE'], replayPairs(historical, 1)),
    position('defensive', 'Historical position facing a capture threat',
      'canonical:finished_fixture#ply=2', 2, ['DEFENSIVE'], replayPairs(historical, 2)),
    position('midgame', 'Historical middle game with capture options',
      'canonical:finished_fixture#ply=4', 4, ['MIDGAME', 'CAPTURE_AVAILABLE'],
      replayPairs(historical, 4)),
    position('tactical', 'Both sides have immediate capture options',
      'canonical:finished_fixture#ply=6', 6, ['TACTICAL', 'DEFENSIVE'],
      replayPairs(historical, 6)),
    position('temple', 'Legal entry to a temple node', 'canonical:temple_sequence#ply=5', 5,
      ['TEMPLE_RELATED'], replayPairs(temple, 5)),
    position('lone-piece', 'Seeded legal play leaves one A piece',
      'canonical:RandomAI#seed=4,ply=44', 44, ['LONE_PIECE_RISK'],
      seededPosition(4, 44)),
    position('forced-win', 'Historical position with immediate winning moves',
      'canonical:finished_fixture#ply=13', 13, ['FORCED_WIN', 'TACTICAL'],
      replayPairs(historical, 13)),
  ];
}
