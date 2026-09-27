import { NODE_IDS, RuleEngine } from '../../domain/index';
import type { GameState, Move, NodeId, Player, TurnResult } from '../../domain/index';
import type { BoardState as BoardView } from '../../types/domain';
import { mapGameStateToView } from './game-state-mapper';

/** GameState is the sole authority; the other fields only describe the current UI interaction. */
export interface LocalGameSession {
  readonly gameState: GameState;
  readonly selectedNode: NodeId | null;
  readonly legalDestinations: readonly NodeId[];
  readonly lastMove: Move | null;
}

export interface LocalTapResult {
  readonly session: LocalGameSession;
  readonly turn: TurnResult | null;
  readonly error: string | null;
}

export function createLocalGameSession(firstPlayer: Player = 'A'): LocalGameSession {
  return {
    gameState: RuleEngine.initializeGame({ firstPlayer }),
    selectedNode: null,
    legalDestinations: [],
    lastMove: null,
  };
}

export function getLocalBoardView(session: LocalGameSession): BoardView {
  return mapGameStateToView(session.gameState, {
    selectedNode: session.selectedNode,
    legalTargets: session.legalDestinations,
    lastMove: session.lastMove,
  }).board;
}

export function tapLocalGameNode(session: LocalGameSession, id: string): LocalTapResult {
  const unchanged: LocalTapResult = { session, turn: null, error: null };
  if (session.gameState.game_status === 'FINISHED') return unchanged;
  if (!NODE_IDS.includes(id as NodeId)) return unchanged;

  const nodeId = id as NodeId;
  const player = session.gameState.board.occupancy[nodeId];
  if (player === session.gameState.current_player) {
    return {
      session: {
        ...session,
        selectedNode: nodeId,
        legalDestinations: RuleEngine.getAllLegalMoves(session.gameState)
          .filter(move => move.from === nodeId)
          .map(move => move.to),
      },
      turn: null,
      error: null,
    };
  }

  if (session.selectedNode === null || !session.legalDestinations.includes(nodeId)) return unchanged;
  try {
    const turn = RuleEngine.executeTurn(session.gameState, { from: session.selectedNode, to: nodeId });
    return {
      session: {
        gameState: turn.state,
        selectedNode: null,
        legalDestinations: [],
        lastMove: turn.move,
      },
      turn,
      error: null,
    };
  } catch {
    return { session, turn: null, error: '落子失败，请重新选择棋子' };
  }
}
