import { gameService } from '../../services/index';
import type { BoardState } from '../../types/domain';
import { boardLines, boardNodes } from '../../mock/game';
import { openPage, backHome } from '../../utils/navigation';
import { createLocalGameSession, getLocalBoardView, tapLocalGameNode } from './local-game';
import type { LocalGameSession } from './local-game';
import { mapGameStateToView } from './game-state-mapper';
import type { GameViewModel } from './game-state-mapper';
import { createApiClient } from '../../services/api-client';
import { createGameApi } from '../../services/game-api';
import { RemoteGameController } from './remote-game';
import type { RemoteGameSnapshot } from './remote-game';
import { AiGameController } from './ai-game';
import type { AiGameSnapshot } from './ai-game';
import type { Player } from '../../domain/index';
import type { EvaluationBreakdown } from '../../ai/evaluation';
import type { ThreatType } from '../../ai/position-analysis';

const activeGameIdKey = 'activeRemoteGameId';
const activeAiGameIdKey = 'activeAiGameId';
const emptyBoard: BoardState = { nodes: boardNodes, lines: boardLines, pieces: [] };
const breakdownLabels: readonly { key: keyof EvaluationBreakdown; label: string }[] = [
  { key: 'material', label: '子力' }, { key: 'reserve', label: '备用子' },
  { key: 'mobility', label: '机动性' }, { key: 'templeControl', label: '庙宇控制' },
  { key: 'captureOpportunity', label: '捕获机会' },
  { key: 'vulnerability', label: '易受攻击' }, { key: 'trapRisk', label: '孤棋风险' },
];
const threatLabels: Readonly<Record<ThreatType, string>> = {
  IMMEDIATE_WIN_AVAILABLE: '存在直接获胜走法',
  CAPTURE_AVAILABLE: '存在直接捕获机会',
  CAPTURE_THREAT: '存在后续捕获威胁',
  VULNERABILITY: '对手捕获行动较多',
  LONE_PIECE_MOBILITY_RISK: '孤棋机动性较低',
};

const gameIdStorage = {
  read: (): string | null => {
    const id = wx.getStorageSync(activeGameIdKey);
    return typeof id === 'string' && id ? id : null;
  },
  write: (id: string): void => { wx.setStorageSync(activeGameIdKey, id); },
  clear: (): void => { wx.removeStorageSync(activeGameIdKey); },
};
const aiGameIdStorage = {
  read: (): string | null => {
    const id = wx.getStorageSync(activeAiGameIdKey);
    return typeof id === 'string' && id ? id : null;
  },
  write: (id: string): void => { wx.setStorageSync(activeAiGameIdKey, id); },
  clear: (): void => { wx.removeStorageSync(activeAiGameIdKey); },
};

Page({
  data: { board: gameService.getBoard(), localSession: null as LocalGameSession | null,
    remoteState: null as RemoteGameSnapshot | null, remoteView: null as GameViewModel | null,
    remoteReady: false, aiState: null as AiGameSnapshot | null,
    aiView: null as GameViewModel | null, aiReady: false,
    aiAName: '玩家 A', aiBName: '标准 AI · B',
    aiCaptureText: '',
    aiAnalysisBreakdown: [] as { label: string; score: number }[],
    aiAnalysisThreats: [] as { id: number; label: string; move: string }[],
    mode: 'ai', showHint: false, thinking: false,
    showResign: false, showSettings: false, resigned: false },
  remoteController: null as RemoteGameController | null,
  aiController: null as AiGameController | null,
  aiFirstPlayer: 'A' as Player,
  onLoad(options: { mode?: string; first?: string }) {
    if (options.mode === 'local') this.restartLocalGame();
    else if (options.mode === 'remote') {
      this.setData({ mode: 'remote', board: emptyBoard, remoteReady: false,
        showHint: false, thinking: false, showResign: false, showSettings: false });
      this.remoteController = new RemoteGameController(
        createGameApi(createApiClient()), gameIdStorage,
        snapshot => this.renderRemote(snapshot),
      );
      this.renderRemote(this.remoteController.snapshot);
      void this.remoteController.enter();
    } else {
      this.aiFirstPlayer = options.first === 'ai' ? 'B' : 'A';
      this.setData({ mode: 'ai', board: emptyBoard, aiReady: false,
        showHint: false, thinking: false, showResign: false, showSettings: false });
      this.aiController = new AiGameController(
        createGameApi(createApiClient()), aiGameIdStorage,
        snapshot => this.renderAi(snapshot),
      );
      this.renderAi(this.aiController.snapshot);
      void this.aiController.enter(this.aiFirstPlayer);
    }
  },
  onUnload() {
    this.remoteController?.dispose(); this.remoteController = null;
    this.aiController?.dispose(); this.aiController = null;
  },
  renderRemote(snapshot: RemoteGameSnapshot) {
    const view = snapshot.gameState ? mapGameStateToView(snapshot.gameState, {
      selectedNode: snapshot.selectedNode,
      legalTargets: snapshot.legalTargets,
      lastMove: snapshot.lastMove,
    }) : null;
    this.setData({ remoteState: snapshot, remoteView: view,
      remoteReady: view !== null, board: view?.board ?? emptyBoard });
  },
  renderAi(snapshot: AiGameSnapshot) {
    const view = snapshot.gameState ? mapGameStateToView(snapshot.gameState, {
      selectedNode: snapshot.selectedNode,
      legalTargets: snapshot.legalTargets,
      lastMove: snapshot.lastMove,
      lastCapture: snapshot.lastCapture,
    }) : null;
    this.setData({ aiState: snapshot, aiView: view,
      aiAnalysisBreakdown: snapshot.analysis
        ? breakdownLabels.map(({ key, label }) => ({ label,
          score: snapshot.analysis!.evaluationBreakdown[key].weightedScore })) : [],
      aiAnalysisThreats: snapshot.analysis?.threats.map((threat, id) => ({
        id,
        label: threatLabels[threat.type],
        move: threat.relatedMove ? `${threat.relatedMove.from} → ${threat.relatedMove.to}` : '',
      })) ?? [],
      aiCaptureText: snapshot.lastCapture?.was_applied
        ? `本步吃子 ${snapshot.lastCapture.captured_nodes.length} 枚，备用棋消耗 ${snapshot.lastCapture.reserve_used} 枚`
        : '',
      aiAName: snapshot.aiPlayer === 'A' ? '标准 AI · A' : '玩家 A',
      aiBName: snapshot.aiPlayer === 'B' ? '标准 AI · B' : '玩家 B',
      aiReady: view !== null, board: view?.board ?? emptyBoard });
  },
  back() { backHome(); },
  onNode(event: WechatMiniprogram.CustomEvent<{ id: string }>) {
    if (this.data.mode === 'ai') {
      void this.aiController?.tapNode(event.detail.id);
      return;
    }
    if (this.data.mode === 'remote') {
      void this.remoteController?.tapNode(event.detail.id);
      return;
    }
    if (this.data.mode === 'local') {
      const session = this.data.localSession as LocalGameSession | null;
      if (session === null) return;
      const result = tapLocalGameNode(session, event.detail.id);
      if (result.error) {
        wx.showToast({ title: result.error, icon: 'none' });
        return;
      }
      if (result.session === session) return;
      this.setData({ localSession: result.session, board: getLocalBoardView(result.session) });
      if (result.turn?.captures.failure_reason === 'INSUFFICIENT_RESERVE') {
        wx.showToast({ title: '备用棋不足，本次吃子未生效', icon: 'none' });
      }
      return;
    }
    const board = this.data.board as BoardState;
    const id = event.detail.id;
    const piece = board.pieces.find(item => item.nodeId === id);
    if (piece) this.setData({ board: { ...board, selectedId: id } });
    else wx.showToast({ title: '演示模式：尚未接入棋规', icon: 'none' });
  },
  onAction(event: WechatMiniprogram.TouchEvent) {
    const action = event.currentTarget.dataset.action as string;
    if (action === 'undo') this.undo();
    else if (action === 'hint') this.hint();
    else if (action === 'analysis') this.openAnalysis();
    else if (action === 'review') this.openReview();
    else if (action === 'resign') this.resign();
    else if (action === 'restart') {
      if (this.data.mode === 'remote') this.restartRemoteGame();
      else if (this.data.mode === 'ai') this.restartAiGame();
      else this.restartLocalGame();
    }
    else if (action === 'settings') this.settings();
  },
  restartLocalGame() {
    const session = createLocalGameSession();
    this.setData({
      mode: 'local', localSession: session, board: getLocalBoardView(session),
      showHint: false, thinking: false, showResign: false, showSettings: false, resigned: false,
    });
  },
  restartRemoteGame() { void this.remoteController?.restart(); },
  retryRemoteGame() { void this.remoteController?.enter(); },
  restartAiGame() { this.aiFirstPlayer = 'A'; void this.aiController?.restart('A'); },
  restartAiFirstGame() {
    this.aiFirstPlayer = 'B';
    this.setData({ showSettings: false });
    void this.aiController?.restart('B');
  },
  retryAiGame() { void this.aiController?.enter(this.aiFirstPlayer); },
  undo() { wx.showToast({ title: '当前暂不支持悔棋', icon: 'none' }); },
  hint() {
    if (this.data.mode === 'ai') {
      void this.aiController?.requestCoachHint();
      return;
    }
    if (this.data.mode === 'local' || this.data.mode === 'remote') {
      wx.showToast({ title: '当前对局暂不提供提示', icon: 'none' });
      return;
    }
    this.setData({ showHint: !this.data.showHint });
  },
  openAnalysis() {
    if (this.data.mode === 'ai') void this.aiController?.analyze();
    else openPage('/pages/analysis/analysis');
  },
  openReview() {
    const gameId = this.data.mode === 'ai'
      ? this.data.aiState?.gameId : this.data.remoteState?.gameId;
    if (gameId) openPage(`/pages/review/review?gameId=${encodeURIComponent(gameId)}`);
  },
  resign() {
    if (this.data.mode === 'local') return;
    this.setData({ showResign: true });
  },
  cancelResign() { this.setData({ showResign: false }); },
  confirmResign() { this.setData({ showResign: false, resigned: true }); wx.showToast({ title: '演示对局已结束', icon: 'none' }); },
  settings() { this.setData({ showSettings: !this.data.showSettings }); },
  toggleThinking() {}
});
