import { NODE_IDS, RuleEngine } from '../../domain/index';
import type { CaptureResult, GameState, Move, NodeId, Player, TurnResult } from '../../domain/index';
import type { BoardState as BoardView } from '../../types/domain';
import { mapGameStateToView } from './game-state-mapper';

/** GameState is the sole authority; the other fields only describe the current UI interaction. */
export interface LocalScore {
  readonly version: 1;
  readonly firstPlayer: Player;
  readonly moves: readonly Move[];
  readonly resigningPlayer: Player | null;
}

export interface LocalGameSession {
  /** Last live turn only; snapshots without capture metadata never invent it. */
  readonly lastCapture?: CaptureResult | null;
  /** Absent on legacy snapshot-only saves: a missing prefix is never invented. */
  readonly score?: LocalScore;
  readonly gameState: GameState;
  readonly selectedNode: NodeId | null;
  readonly legalDestinations: readonly NodeId[];
  readonly lastMove: Move | null;
  readonly undoFrame: LocalUndoFrame | null;
}

export interface LocalUndoFrame {
  readonly gameState: GameState;
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
    score: { version: 1, firstPlayer, moves: [], resigningPlayer: null },
    selectedNode: null,
    legalDestinations: [],
    lastMove: null,
    undoFrame: null,
  };
}

function copyMove(move: Move | null): Move | null {
  return move === null ? null : { from: move.from, to: move.to };
}

function copyGameState(state: GameState): GameState {
  return {
    ...state,
    board: { occupancy: { ...state.board.occupancy } },
    players: {
      A: { reserve_count: state.players.A.reserve_count },
      B: { reserve_count: state.players.B.reserve_count },
    },
  };
}

export function getLocalBoardView(session: LocalGameSession,
                                  showLegalTargets = true, showCaptureNotice = true): BoardView {
  return mapGameStateToView(session.gameState, {
    selectedNode: session.selectedNode,
    legalTargets: session.legalDestinations, showLegalTargets,
    lastMove: copyMove(session.lastMove),
    lastCapture: showCaptureNotice ? session.lastCapture : null,
  }).board;
}

export function undoLocalGame(session: LocalGameSession): LocalGameSession {
  if (session.gameState.game_status !== 'PLAYING' || session.undoFrame === null) return session;
  return {
    score: session.score ? { ...session.score,
      moves: session.score.moves.slice(0, -1).map(move => ({ ...move })) } : undefined,
    gameState: copyGameState(session.undoFrame.gameState),
    selectedNode: null,
    legalDestinations: [],
    lastMove: copyMove(session.undoFrame.lastMove),
    undoFrame: null,
  };
}

export function resignLocalGame(session: LocalGameSession): LocalGameSession {
  if (session.gameState.game_status !== 'PLAYING') return session;
  const loser = session.gameState.current_player;
  return {
    gameState: {
      ...copyGameState(session.gameState),
      game_status: 'FINISHED',
      winner: loser === 'A' ? 'B' : 'A',
      winner_reason: 'RESIGN',
    },
    selectedNode: null,
    legalDestinations: [],
    score: session.score ? { ...session.score,
      moves: session.score.moves.map(move => ({ ...move })), resigningPlayer: loser } : undefined,
    lastMove: copyMove(session.lastMove),
    undoFrame: null,
  };
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
        score: session.score ? { ...session.score,
          moves: [...session.score.moves.map(move => ({ ...move })), { ...turn.move }] } : undefined,
        gameState: turn.state,
        selectedNode: null,
        legalDestinations: [],
        lastMove: turn.move,
        lastCapture: turn.captures,
        undoFrame: {
          gameState: copyGameState(session.gameState),
          lastMove: copyMove(session.lastMove),
        },
      },
      turn,
      error: null,
    };
  } catch {
    return { session, turn: null, error: '落子失败，请重新选择棋子' };
  }
}
