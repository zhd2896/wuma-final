import { RuleEngine, TEMPLE_NODES } from '../domain/index';
import type { GameState, Move, NodeId, TurnResult } from '../domain/index';
import { hasCaptureOpportunity } from './evaluation';

export const MoveOrderCategory = {
  IMMEDIATE_WIN: 'IMMEDIATE_WIN',
  CAPTURE: 'CAPTURE',
  CAPTURE_THREAT: 'CAPTURE_THREAT',
  TEMPLE_KEY: 'TEMPLE_KEY',
  NORMAL: 'NORMAL',
} as const;

export type MoveOrderCategory = typeof MoveOrderCategory[keyof typeof MoveOrderCategory];

const PRIORITY: Readonly<Record<MoveOrderCategory, number>> = {
  IMMEDIATE_WIN: 5,
  CAPTURE: 4,
  CAPTURE_THREAT: 3,
  TEMPLE_KEY: 2,
  NORMAL: 1,
};

/** P03 is an entrance for ordering only; TEMPLE_NODES remains P26–P29. */
const ORDERING_TEMPLE_NODES: ReadonlySet<NodeId> = new Set([...TEMPLE_NODES, 'P03']);

export interface MoveOrderInfo {
  readonly move: Move;
  readonly turn: TurnResult;
  readonly childState: GameState;
  readonly category: MoveOrderCategory;
  readonly priority: number;
  readonly captureCount: number;
  readonly originalIndex: number;
}

/** Classify legal moves with real turns, then keep each child for the search. */
export function orderMoves(
  state: GameState,
  legalMoves: readonly Move[] = RuleEngine.getAllLegalMoves(state),
): MoveOrderInfo[] {
  const movingPlayer = state.current_player;
  const turns = RuleEngine.executeTurns(state, legalMoves);
  const moves = legalMoves.map((move, originalIndex): MoveOrderInfo => {
    const turn = turns[originalIndex];
    const childState = turn.state;
    const captureCount = turn.captures.was_applied
      ? new Set(turn.captures.captured_nodes).size : 0;
    let category: MoveOrderCategory;
    if (childState.game_status === 'FINISHED' && childState.winner === movingPlayer) {
      category = MoveOrderCategory.IMMEDIATE_WIN;
    } else if (captureCount > 0) {
      category = MoveOrderCategory.CAPTURE;
    } else if (hasCaptureOpportunity(childState, movingPlayer)) {
      category = MoveOrderCategory.CAPTURE_THREAT;
    } else if (ORDERING_TEMPLE_NODES.has(move.from) || ORDERING_TEMPLE_NODES.has(move.to)) {
      category = MoveOrderCategory.TEMPLE_KEY;
    } else {
      category = MoveOrderCategory.NORMAL;
    }
    return {
      move, turn, childState, category, priority: PRIORITY[category], captureCount, originalIndex,
    };
  });
  return moves.sort((left, right) =>
    right.priority - left.priority
    || (left.category === MoveOrderCategory.CAPTURE ? right.captureCount - left.captureCount : 0)
    || left.originalIndex - right.originalIndex);
}
