import { RandomAI } from '../ai/random-ai';
import { createLocalGameSession, tapLocalGameNode, resignLocalGame } from '../pages/game/local-game';
import type { LocalGameSession } from '../pages/game/local-game';
import { restoreTrialDraft as restore, MAX_TRIAL_MOVES as MAX_MOVES } from '../services/trial-draft';
import type { TrialDraft } from '../services/trial-draft';
export type { TrialDraft } from '../services/trial-draft';

export class TrialController {
  readonly id: string;
  private value: LocalGameSession;
  private readonly computer: RandomAI;
  message = '你执黑棋先走，先点一枚黑棋，再点标记的空位。';
  constructor(draft?: unknown, random: () => number = Math.random) {
    const restored = draft === undefined ? null : restore(draft);
    this.id = restored?.id ?? `trial-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    this.value = restored?.session ?? createLocalGameSession();
    this.computer = new RandomAI(random);
  }
  get session(): LocalGameSession { return this.value; }
  get draft(): TrialDraft {
    const score = this.value.score!;
    return { version: 1, id: this.id, score: { ...score, moves: score.moves.map(move => ({ ...move })) } };
  }
  tap(id: string): void {
    if (this.value.gameState.game_status !== 'PLAYING') return;
    if (this.value.score!.moves.length >= MAX_MOVES) { this.message = '试玩步数已达上限，请保存棋谱或重新开始。'; return; }
    const result = tapLocalGameNode(this.value, id);
    if (result.error) { this.message = result.error; return; }
    if (!result.turn) { this.value = result.session; return; }
    let next = result.session;
    const notices: string[] = [];
    if (result.turn.captures.was_applied) notices.push(`你吃了 ${result.turn.captures.captured_nodes.length} 枚红棋`);
    if (next.gameState.game_status === 'PLAYING') {
      const move = this.computer.chooseMove(next.gameState);
      if (!move) { this.message = '电脑暂时无合法走法，请保存当前棋谱或重新开始。'; return; }
      const reply = tapLocalGameNode(tapLocalGameNode(next, move.from).session, move.to);
      if (!reply.turn) { this.message = '电脑落子失败，请重试。'; return; }
      next = reply.session;
      if (reply.turn.captures.was_applied) notices.push(`电脑吃了 ${reply.turn.captures.captured_nodes.length} 枚黑棋`);
    }
    this.value = next;
    this.message = notices.length ? `${notices.join('；')}。吃子消耗备用棋并替换被吃位置。`
      : '电脑已走，轮到你继续。沿直线走到空位，途中不能越子。';
  }
  resign(): void { this.value = resignLocalGame(this.value); }
}
