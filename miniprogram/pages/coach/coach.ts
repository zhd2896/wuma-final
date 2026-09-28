import type { CoachHintDto } from '../../services/api-contract';
import { createApiClient } from '../../services/api-client';
import { createGameApi } from '../../services/game-api';
import { boardLines, boardNodes } from '../../mock/game';
import type { BoardState } from '../../types/domain';
import { openPage, backHome } from '../../utils/navigation';
import { mapGameStateToView } from '../game/game-state-mapper';
import { IndependentCoachController } from './coach-controller';
import type { IndependentCoachSnapshot } from './coach-controller';

const activeAiGameIdKey = 'activeAiGameId';
const emptyBoard: BoardState = { nodes: boardNodes, lines: boardLines, pieces: [] };

interface CoachCardView {
  readonly level: 1 | 2 | 3;
  readonly title: string;
  readonly body: string;
  readonly detail: string;
  readonly locked: boolean;
  readonly loading: boolean;
  readonly expanded: boolean;
}

const titles = ['一级提示 · 关注什么', '二级提示 · 重点棋子', '三级提示 · 推荐走法'] as const;

function detailForHint(hint: CoachHintDto): string {
  if (hint.level === 1) {
    return hint.focusTopics.length ? `关注点：${hint.focusTopics.join('、')}` : '当前没有额外关注点';
  }
  if (hint.level === 2) {
    return hint.candidateFromNodes.length
      ? `候选棋子：${hint.candidateFromNodes.join('、')}` : '当前没有候选棋子';
  }
  return hint.bestMove
    ? `推荐走法：${hint.bestMove.from} → ${hint.bestMove.to}` : '当前没有合法推荐走法';
}

function mapCards(snapshot: IndependentCoachSnapshot, selectedLevel: number): CoachCardView[] {
  return ([1, 2, 3] as const).map(level => {
    const hint = snapshot.hints.find(item => item.level === level);
    const locked = level > snapshot.hints.length + 1;
    return {
      level,
      title: titles[level - 1],
      body: hint?.hintText ?? (locked ? '完成上一级提示后解锁' : '点击获取当前局面的真实提示'),
      detail: hint ? detailForHint(hint) : locked ? '尚未解锁' : '按需查看，避免过早揭示答案',
      locked,
      loading: snapshot.loadingLevel === level,
      expanded: selectedLevel === level && hint !== undefined,
    };
  });
}

Page({
  data: {
    state: 'idle' as IndependentCoachSnapshot['state'],
    gameId: '', gameVersion: null as number | null,
    gameState: null as IndependentCoachSnapshot['gameState'],
    humanPlayer: '', aiPlayer: '', currentPlayer: '',
    board: emptyBoard,
    hints: [] as readonly CoachHintDto[],
    cards: [] as CoachCardView[],
    selectedLevel: 0,
    loadingLevel: null as 1 | 2 | 3 | null,
    errorMessage: '', notice: '', terminalText: '',
  },
  controller: null as IndependentCoachController | null,
  skipNextShow: true,
  onLoad(options: { gameId?: string }) {
    this.skipNextShow = true;
    this.controller = new IndependentCoachController({
      api: createGameApi(createApiClient()),
      readActiveAiId: () => {
        const id = wx.getStorageSync(activeAiGameIdKey);
        return typeof id === 'string' && id ? id : null;
      },
      writeActiveAiId: id => { wx.setStorageSync(activeAiGameIdKey, id); },
      onChange: snapshot => this.render(snapshot),
    });
    void this.controller.enter(options.gameId ? { gameId: options.gameId } : {});
  },
  onShow() {
    if (this.skipNextShow) {
      this.skipNextShow = false;
      return;
    }
    void this.controller?.refresh();
  },
  onUnload() {
    this.controller?.dispose();
    this.controller = null;
  },
  render(snapshot: IndependentCoachSnapshot) {
    const gameView = snapshot.gameState ? mapGameStateToView(snapshot.gameState) : null;
    const previousHints = (this.data.hints as readonly CoachHintDto[]).length;
    let selectedLevel = this.data.selectedLevel as number;
    if (snapshot.hints.length > previousHints) {
      selectedLevel = snapshot.hints[snapshot.hints.length - 1].level;
    } else if (!snapshot.hints.some(item => item.level === selectedLevel)) {
      selectedLevel = 0;
    }
    this.setData({
      state: snapshot.state,
      gameId: snapshot.gameId ?? '',
      gameVersion: snapshot.gameVersion,
      gameState: snapshot.gameState,
      humanPlayer: snapshot.humanPlayer ?? '',
      aiPlayer: snapshot.aiPlayer ?? '',
      currentPlayer: snapshot.gameState?.current_player ?? '',
      board: gameView?.board ?? emptyBoard,
      hints: snapshot.hints,
      cards: mapCards(snapshot, selectedLevel),
      selectedLevel,
      loadingLevel: snapshot.loadingLevel,
      errorMessage: snapshot.errorMessage,
      notice: snapshot.notice,
      terminalText: gameView?.gameOver
        ? `胜方 ${gameView.winner ?? '-'} 方 · ${gameView.winnerMessage}` : '',
    });
  },
  selectHint(event: WechatMiniprogram.CustomEvent<{ level: number }>) {
    const level = event.detail.level as 1 | 2 | 3;
    const snapshot = this.controller?.snapshot;
    if (!snapshot) return;
    if (snapshot.hints.some(item => item.level === level)) {
      const selectedLevel = this.data.selectedLevel === level ? 0 : level;
      this.setData({ selectedLevel, cards: mapCards(snapshot, selectedLevel) });
      return;
    }
    void this.controller?.requestLevel(level);
  },
  retry() { void this.controller?.retry(); },
  back() { backHome(); },
  startAiGame() { openPage('/pages/game/game?mode=ai'); },
  continueAiGame() {
    if (!this.data.gameId) return;
    openPage(`/pages/game/game?mode=ai&gameId=${encodeURIComponent(this.data.gameId)}`);
  },
  openHistory() { openPage('/pages/history/history'); },
  openReview() { openPage('/pages/history/history?filter=reviewable'); },
});
