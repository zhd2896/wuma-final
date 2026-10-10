import { NODE_IDS, RuleEngine, createInitialGameState } from '../domain/index';
import type { CaptureResult, GameState, Move, NodeId, Player } from '../domain/index';

import { TUTORIAL_LESSONS } from '../services/tutorial-lessons';
export { TUTORIAL_LESSONS } from '../services/tutorial-lessons';

function lessonState(index: number): GameState {
  const initial = createInitialGameState();
  const lesson = TUTORIAL_LESSONS[Math.min(index, TUTORIAL_LESSONS.length - 1)];
  const pieces = lesson.pieces;
  if (!pieces) return initial;
  const occupancy = {} as Record<NodeId, Player | null>;
  for (const id of NODE_IDS) occupancy[id] = pieces[id] ?? null;
  return { ...initial, board: { occupancy },
    players: { ...initial.players, A: { reserve_count: lesson.reserve ?? 4 } } };
}

export interface TutorialSnapshot {
  readonly stepIndex: number;
  readonly passed: boolean;
  readonly completed: boolean;
  readonly state: GameState;
  readonly selectedNode: NodeId | null;
  readonly legalTargets: readonly NodeId[];
  readonly lastMove: Move | null;
  readonly lastCapture: CaptureResult | null;
  readonly message: string;
  readonly escapeMoves: readonly Move[];
  readonly beforeEscapeMoves: readonly Move[];
}

export class TutorialController {
  private value: TutorialSnapshot;
  constructor(index = 0) {
    const stepIndex = Number.isInteger(index) && index >= 0 && index <= TUTORIAL_LESSONS.length ? index : 0;
    this.value = this.fresh(stepIndex);
  }
  get snapshot(): TutorialSnapshot { return this.value; }
  private fresh(stepIndex: number): TutorialSnapshot {
    const state = lessonState(stepIndex);
    const escapeMoves = RuleEngine.getAllLegalMovesForPlayer(state, 'B');
    return { stepIndex, passed: false, completed: stepIndex === TUTORIAL_LESSONS.length, state,
      selectedNode: null, legalTargets: [], lastMove: null, lastCapture: null, message: '', escapeMoves, beforeEscapeMoves: escapeMoves };
  }
  tap(id: string): void {
    if (this.value.passed || this.value.completed) return;
    const lesson = TUTORIAL_LESSONS[this.value.stepIndex];
    if (this.value.state.current_player !== 'A') return;
    const node = NODE_IDS.find(node => node === id);
    if (lesson.independent && node && this.value.state.board.occupancy[node] === 'A') {
      const legalTargets = RuleEngine.getLegalMoves(this.value.state).filter(move => move.from === node).map(move => move.to);
      this.value = { ...this.value, selectedNode: node, legalTargets,
        message: legalTargets.length ? '已选黑棋，请自行选择一个合法落点。' : '这枚黑棋没有合法走法，请换一枚。' };
      return;
    }
    if (lesson.move && id === lesson.move.from) {
      this.value = { ...this.value, selectedNode: lesson.move.from, legalTargets: [lesson.move.to],
        message: `选好了！现在点空位 ${lesson.move.to}。` };
      return;
    }
    const move = node && this.value.selectedNode ? { from: this.value.selectedNode, to: node } : null;
    if (!move || !RuleEngine.validateMove(this.value.state, move)
      || (lesson.move && id !== lesson.move.to)) {
      this.value = { ...this.value, message: this.value.selectedNode
        ? lesson.move ? `这一步请走到标记的空位 ${lesson.move.to}，可以再试一次。` : '请选择合法空位，或换一枚黑棋。'
        : lesson.move ? `先点标记的黑棋 ${lesson.move.from}，再点空位 ${lesson.move.to}。` : '先选一枚黑棋，再选择合法空位。' };
      return;
    }
    const turn = RuleEngine.executeTurn(this.value.state, move);
    const escapeMoves = RuleEngine.getAllLegalMovesForPlayer(turn.state, 'B');
    const passed = lesson.goal === 'INSUFFICIENT_RESERVE'
      ? turn.captures.failure_reason === 'INSUFFICIENT_RESERVE' && turn.captures.reserve_used === 0 && !turn.game_over
      : lesson.goal === 'PARTIAL_BLOCKADE'
      ? !turn.game_over && !escapeMoves.some(move => move.from === 'P26') && escapeMoves.length > 0
      : lesson.goal === 'TEMPLE_TRAP' || lesson.goal === 'ALL_PIECES_IMMOBILIZED'
      ? turn.winner === 'A' && turn.winner_reason === lesson.goal
      : lesson.captureType === null ? turn.captures.captured_nodes.length === 0
      : turn.captures.was_applied && turn.captures.patterns.some(p => p.capture_type === lesson.captureType)
        && turn.captures.captured_nodes.length === (lesson.captureType === 'CLAMP' ? 1 : 2);
    this.value = { ...this.value, state: turn.state, passed, selectedNode: null, legalTargets: [],
      lastMove: turn.move, lastCapture: turn.captures, escapeMoves,
      message: passed ? lesson.explanation : '这步合法，但红方仍有走法，还未获胜。看看下方的红方路线，点击「重练本关」再尝试。' };
  }
  next(): void {
    if (this.value.passed && !this.value.completed) this.value = this.fresh(this.value.stepIndex + 1);
  }
  retry(): void { this.value = this.fresh(this.value.completed ? 0 : this.value.stepIndex); }
}
