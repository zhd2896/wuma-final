import { NODE_IDS, RuleEngine, createInitialGameState } from '../domain/index';
import type { CaptureResult, CaptureType, GameState, Move, NodeId, Player } from '../domain/index';

interface TutorialLesson {
  readonly title: string;
  readonly instruction: string;
  readonly explanation: string;
  readonly move: Move;
  readonly captureType: CaptureType | null;
  readonly pieces?: Partial<Record<NodeId, Player>>;
}

export const TUTORIAL_LESSONS: readonly TutorialLesson[] = [
  { title: '走出第一步', instruction: '先点黑棋 P11，再点空位 P12。沿直线走棋，途中不能越过其他棋子。',
    explanation: '走对了！棋子沿棋盘直线移动到空位，途中没有其他棋子。正式对局中，接下来轮到对方。',
    move: { from: 'P11', to: 'P12' }, captureType: null },
  { title: '完成一次夹吃', instruction: '先点黑棋 P08，再点空位 P13，与 P11 的黑棋一起夹住 P12 的红棋。',
    explanation: '夹吃成功！同一直线上形成「黑—红—黑」，吃掉中间一枚红棋，消耗一枚备用黑棋替换它。整条直线上不能有其他棋子，备用棋也要足够；对方最后一子不能夹吃。',
    move: { from: 'P08', to: 'P13' }, captureType: 'CLAMP',
    pieces: { P11: 'A', P08: 'A', P12: 'B', P05: 'B', P20: 'B', P25: 'B' } },
  { title: '完成一次挑吃', instruction: '先点黑棋 P08，再点空位 P13，走到 P12、P14 两枚红棋中间。',
    explanation: '挑吃成功！同一直线上形成「红—黑—红」，吃掉两侧两枚红棋，消耗两枚备用黑棋替换它们。整条直线上不能有其他棋子，备用棋要足够；对方只剩两子时不能挑吃。',
    move: { from: 'P08', to: 'P13' }, captureType: 'CARRY',
    pieces: { P08: 'A', P21: 'A', P12: 'B', P14: 'B', P05: 'B', P25: 'B' } },
];

function lessonState(index: number): GameState {
  const initial = createInitialGameState();
  const pieces = TUTORIAL_LESSONS[Math.min(index, 2)].pieces;
  if (!pieces) return initial;
  const occupancy = {} as Record<NodeId, Player | null>;
  for (const id of NODE_IDS) occupancy[id] = pieces[id] ?? null;
  return { ...initial, board: { occupancy } };
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
}

export class TutorialController {
  private value: TutorialSnapshot;
  constructor(index = 0) {
    const stepIndex = Number.isInteger(index) && index >= 0 && index <= 3 ? index : 0;
    this.value = this.fresh(stepIndex);
  }
  get snapshot(): TutorialSnapshot { return this.value; }
  private fresh(stepIndex: number): TutorialSnapshot {
    return { stepIndex, passed: false, completed: stepIndex === 3, state: lessonState(stepIndex),
      selectedNode: null, legalTargets: [], lastMove: null, lastCapture: null, message: '' };
  }
  tap(id: string): void {
    if (this.value.passed || this.value.completed) return;
    const lesson = TUTORIAL_LESSONS[this.value.stepIndex];
    if (id === lesson.move.from) {
      this.value = { ...this.value, selectedNode: lesson.move.from, legalTargets: [lesson.move.to],
        message: `选好了！现在点空位 ${lesson.move.to}。` };
      return;
    }
    if (!this.value.selectedNode || id !== lesson.move.to) {
      this.value = { ...this.value, message: this.value.selectedNode
        ? `这一步请走到标记的空位 ${lesson.move.to}，可以再试一次。`
        : `先点标记的黑棋 ${lesson.move.from}，再点空位 ${lesson.move.to}。` };
      return;
    }
    const turn = RuleEngine.executeTurn(this.value.state, lesson.move);
    const passed = lesson.captureType === null ? turn.captures.captured_nodes.length === 0
      : turn.captures.was_applied && turn.captures.patterns.some(p => p.capture_type === lesson.captureType)
        && turn.captures.captured_nodes.length === (lesson.captureType === 'CLAMP' ? 1 : 2);
    if (!passed) {
      this.value = { ...this.value, message: '还没完成本关目标，请重练本关。' };
      return;
    }
    this.value = { ...this.value, state: turn.state, passed, selectedNode: null, legalTargets: [],
      lastMove: turn.move, lastCapture: turn.captures, message: lesson.explanation };
  }
  next(): void {
    if (this.value.passed && !this.value.completed) this.value = this.fresh(this.value.stepIndex + 1);
  }
  retry(): void { this.value = this.fresh(this.value.completed ? 0 : this.value.stepIndex); }
}
