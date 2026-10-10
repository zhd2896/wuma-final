import { NODE_IDS } from '../domain/index';
import type { Move, NodeId } from '../domain/index';
import { createLocalGameSession, tapLocalGameNode, resignLocalGame } from '../pages/game/local-game';
import type { LocalGameSession, LocalScore } from '../pages/game/local-game';

export interface TrialDraft { readonly version: 1; readonly id: string; readonly score: LocalScore; }
export const MAX_TRIAL_MOVES = 2048;
const damaged = () => new Error('试玩草稿损坏，请重新开始试玩');
function moveShape(value: unknown): value is Move {
  if (!value || typeof value !== 'object') return false;
  const move = value as Partial<Move>;
  return NODE_IDS.includes(move.from as NodeId) && NODE_IDS.includes(move.to as NodeId);
}
export function restoreTrialDraft(value: unknown): { id: string; session: LocalGameSession } {
  if (!value || typeof value !== 'object') throw damaged();
  const draft = value as Partial<TrialDraft>;
  const score = draft.score;
  if (draft.version !== 1 || typeof draft.id !== 'string' || !/^trial-[A-Za-z0-9_-]{8,58}$/.test(draft.id) ||
      !score || score.version !== 1 || score.firstPlayer !== 'A' || !Array.isArray(score.moves) ||
      score.moves.length > MAX_TRIAL_MOVES || !score.moves.every(moveShape) ||
      (score.resigningPlayer !== null && score.resigningPlayer !== 'A')) throw damaged();
  let session = createLocalGameSession();
  for (const move of score.moves) {
    const result = tapLocalGameNode(tapLocalGameNode(session, move.from).session, move.to);
    if (!result.turn || result.error) throw damaged();
    session = result.session;
  }
  if (score.resigningPlayer === 'A') {
    if (session.gameState.current_player !== 'A' || session.gameState.game_status !== 'PLAYING') throw damaged();
    session = resignLocalGame(session);
  }
  if (session.gameState.game_status === 'PLAYING' && session.gameState.current_player !== 'A') throw damaged();
  return { id: draft.id, session };
}
