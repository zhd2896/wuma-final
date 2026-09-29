import { NODE_IDS } from '../domain/index';
import type { GameState, NodeId, Player, TurnResult } from '../domain/index';

/** Two uint32 words encoded as a fixed-width hex key; no unsafe JS 64-bit number. */
export type ZobristKey = string;

export interface ZobristWords { readonly low: number; readonly high: number }
type KeyWords = ZobristWords;

const LOW_SEED = 0x811c9dc5;
const HIGH_SEED = 0x9e3779b9;

function fnv1a(label: string, seed: number): number {
  let value = seed >>> 0;
  for (let index = 0; index < label.length; index++) {
    value = Math.imul(value ^ label.charCodeAt(index), 0x01000193) >>> 0;
  }
  return value;
}

function spread(value: number): number {
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}

/** A fixed-seed, reproducible pseudo-random key for one state feature. */
function featureKey(label: string): KeyWords {
  return {
    low: spread(fnv1a(label, LOW_SEED)),
    high: spread(fnv1a(label, HIGH_SEED)),
  };
}

const PIECE_KEYS = {} as Record<NodeId, Record<Player, KeyWords>>;
for (const node of NODE_IDS) {
  PIECE_KEYS[node] = {
    A: featureKey(`piece:${node}:A`),
    B: featureKey(`piece:${node}:B`),
  };
}

export function parseZobristHash(hash: ZobristKey): ZobristWords {
  if (!/^[0-9a-f]{16}$/.test(hash)) throw new RangeError('Invalid Zobrist hash');
  return { high: Number.parseInt(hash.slice(0, 8), 16) >>> 0,
    low: Number.parseInt(hash.slice(8), 16) >>> 0 };
}

export function formatZobristWords(words: ZobristWords): ZobristKey {
  return words.high.toString(16).padStart(8, '0') +
    words.low.toString(16).padStart(8, '0');
}

/** Search-only delta from a canonical completed turn; the turn remains the source of truth. */
export function updateZobristWords(parent: ZobristWords, turn: TurnResult): ZobristWords {
  let low = parent.low;
  let high = parent.high;
  const toggle = (key: KeyWords): void => {
    low = (low ^ key.low) >>> 0;
    high = (high ^ key.high) >>> 0;
  };
  const nodes = new Set<NodeId>([turn.move.from, turn.move.to,
    ...turn.captures.captured_nodes]);
  for (const node of nodes) {
    const before = turn.board_before.occupancy[node];
    const after = turn.board_after.occupancy[node];
    if (before === after) continue;
    if (before !== null) toggle(PIECE_KEYS[node][before]);
    if (after !== null) toggle(PIECE_KEYS[node][after]);
  }
  const change = (before: string | number, after: string | number,
                  label: (value: string | number) => string): void => {
    if (before === after) return;
    toggle(featureKey(label(before)));
    toggle(featureKey(label(after)));
  };
  change(turn.before_state.current_player, turn.state.current_player,
    value => `turn:${value}`);
  change(turn.reserve_before.A, turn.reserve_after.A, value => `reserve:A:${value}`);
  change(turn.reserve_before.B, turn.reserve_after.B, value => `reserve:B:${value}`);
  change(turn.before_state.game_status, turn.state.game_status,
    value => `status:${value}`);
  change(turn.before_state.winner ?? 'NONE', turn.state.winner ?? 'NONE',
    value => `winner:${value}`);
  change(turn.before_state.winner_reason ?? 'NONE', turn.state.winner_reason ?? 'NONE',
    value => `reason:${value}`);
  return { low, high };
}

export function updateZobristHash(parentHash: ZobristKey, turn: TurnResult): ZobristKey {
  return formatZobristWords(updateZobristWords(parseZobristHash(parentHash), turn));
}

/** Full recomputation uses canonical node order and only search-relevant state. */
export function hashGameState(state: GameState): ZobristKey {
  let low = 0;
  let high = 0;
  const add = (key: KeyWords): void => {
    low = (low ^ key.low) >>> 0;
    high = (high ^ key.high) >>> 0;
  };
  for (const node of NODE_IDS) {
    const occupant = state.board.occupancy[node];
    if (occupant !== null) add(PIECE_KEYS[node][occupant]);
  }
  add(featureKey(`turn:${state.current_player}`));
  add(featureKey(`reserve:A:${state.players.A.reserve_count}`));
  add(featureKey(`reserve:B:${state.players.B.reserve_count}`));
  add(featureKey(`status:${state.game_status}`));
  add(featureKey(`winner:${state.winner ?? 'NONE'}`));
  add(featureKey(`reason:${state.winner_reason ?? 'NONE'}`));
  return high.toString(16).padStart(8, '0') + low.toString(16).padStart(8, '0');
}

/** Collision guard: the same search-relevant fields, encoded without hashing. */
export function stateSignature(state: GameState): string {
  const board = NODE_IDS.map(node => state.board.occupancy[node] ?? '_').join('');
  return [
    board,
    state.current_player,
    state.players.A.reserve_count,
    state.players.B.reserve_count,
    state.game_status,
    state.winner ?? 'NONE',
    state.winner_reason ?? 'NONE',
  ].join('|');
}
