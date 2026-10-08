import { RuleEngine, STANDARD_GRAPH, TEMPLE_NODES, countPieces, getPlayerNodes } from '../domain/index';
import type { GameState, Move, NodeId, Player, WinnerReason } from '../domain/index';

export interface BlockadeProof {
  readonly winner: Player;
  readonly maxPlies: number;
  /** One finish for every legal defender reply, never just a cooperative line. */
  readonly lines: readonly (readonly Move[])[];
  readonly winnerReasons: readonly WinnerReason[];
}
export interface BlockadeControl {
  readonly checkTimeout?: () => void;
  readonly onNodeVisited?: () => void;
}
const blockadeReasons = new Set<WinnerReason>(['TEMPLE_TRAP', 'LONE_PIECE_IMMOBILIZED', 'ALL_PIECES_IMMOBILIZED']);

function compactTarget(state: GameState): { attacker: Player; target: NodeId } | null {
  if (state.game_status !== 'PLAYING') return null;
  for (const defender of ['A', 'B'] as const) {
    const attacker = defender === 'A' ? 'B' : 'A';
    const nodes = getPlayerNodes(state.board, defender);
    if (nodes.length === 1 && countPieces(state.board, attacker) >= 3 &&
        TEMPLE_NODES.includes(nodes[0]) && RuleEngine.getAllLegalMovesForPlayer(state, defender).length <= 4) {
      return { attacker, target: nodes[0] };
    }
  }
  return null;
}
function turn(state: GameState, move: Move, control: BlockadeControl): GameState {
  control.checkTimeout?.();
  const child = RuleEngine.executeTurn(state, move).state;
  control.onNodeVisited?.();
  control.checkTimeout?.();
  return child;
}
function isBlockadeWin(state: GameState, attacker: Player): boolean {
  return state.game_status === 'FINISHED' && state.winner === attacker &&
    state.winner_reason !== null && blockadeReasons.has(state.winner_reason);
}
function immediateFinish(state: GameState, attacker: Player, control: BlockadeControl): BlockadeProof | null {
  control.checkTimeout?.();
  let moves = RuleEngine.getAllLegalMoves(state);
  const defender = attacker === 'A' ? 'B' : 'A';
  const targets = getPlayerNodes(state.board, defender);
  if (targets.length === 1) {
    // The last opposing piece cannot be captured. A one-move seal must close
    // its only open adjacent point without moving away another adjacent seal.
    // This is only a prefilter; the full real turn still proves the terminal.
    const neighbors = STANDARD_GRAPH.neighbors(targets[0]);
    const openings = neighbors.filter(node => state.board.occupancy[node] !== attacker);
    if (openings.length !== 1) return null;
    moves = moves.filter(move => move.to === openings[0] && !neighbors.includes(move.from));
  }
  for (const move of moves) {
    const child = turn(state, move, control);
    if (isBlockadeWin(child, attacker)) return { winner: attacker, maxPlies: 1,
      lines: [[move]], winnerReasons: [child.winner_reason!] };
  }
  return null;
}
function everyReply(state: GameState, attacker: Player, control: BlockadeControl): BlockadeProof | null {
  const replies = RuleEngine.getAllLegalMoves(state);
  if (!replies.length) return null; // Missing adjudication is not a proof.
  const lines: Move[][] = []; const reasons = new Set<WinnerReason>();
  for (const reply of replies) {
    const child = turn(state, reply, control);
    if (child.game_status !== 'PLAYING') return null;
    const finish = immediateFinish(child, attacker, control);
    if (!finish) return null;
    lines.push([reply, ...finish.lines[0]]);
    finish.winnerReasons.forEach(reason => reasons.add(reason));
  }
  return { winner: attacker, maxPlies: 2, lines, winnerReasons: [...reasons] };
}

/** Selective leaf extension: at most two plies, restricted to compact temple endgames. */
export function extendBlockade(state: GameState, control: BlockadeControl = {}): BlockadeProof | null {
  const target = compactTarget(state);
  if (!target) return null;
  return state.current_player === target.attacker
    ? immediateFinish(state, target.attacker, control) : everyReply(state, target.attacker, control);
}

/** Verify a specific recommended preparation, including every legal opponent reply. */
export function proveBlockadeMove(state: GameState, move: Move,
                                  control: BlockadeControl = {}): BlockadeProof | null {
  const target = compactTarget(state);
  if (!target || target.attacker !== state.current_player || !RuleEngine.validateMove(state, move)) return null;
  const child = turn(state, move, control);
  if (isBlockadeWin(child, target.attacker)) return { winner: target.attacker, maxPlies: 1,
    lines: [[move]], winnerReasons: [child.winner_reason!] };
  if (child.game_status !== 'PLAYING') return null;
  const finish = everyReply(child, target.attacker, control);
  return finish ? { ...finish, maxPlies: 3, lines: finish.lines.map(line => [move, ...line]) } : null;
}

/** Static sealed-region heuristic; ignores future captures and never adjudicates a game. */
export function blockadePressure(state: GameState, attacker: Player): number {
  const defender = attacker === 'A' ? 'B' : 'A';
  const nodes = getPlayerNodes(state.board, defender);
  if (nodes.length !== 1 || countPieces(state.board, attacker) < 3) return 0;
  const reachable = new Set<NodeId>(nodes); const boundary = new Set<NodeId>();
  const queue = [...nodes];
  for (let index = 0; index < queue.length; index++) {
    for (const neighbor of STANDARD_GRAPH.neighbors(queue[index])) {
      if (state.board.occupancy[neighbor] === attacker) boundary.add(neighbor);
      else if (!reachable.has(neighbor)) { reachable.add(neighbor); queue.push(neighbor); }
    }
  }
  return boundary.size / reachable.size;
}
