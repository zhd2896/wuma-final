import type { Player } from '../domain/index';
/** Effective plies alternate; the undo anchors at the most recent human move. */
export function aiUndoCount(state: { first_player: Player; current_player: Player } | null,
                            plyCount: number, human: Player | null): number {
  if (!state || !human || !Number.isInteger(plyCount) || plyCount < 1 ||
      (state.first_player !== human && plyCount === 1)) return 0;
  return state.current_player === human ? Math.min(2, plyCount) : 1;
}
