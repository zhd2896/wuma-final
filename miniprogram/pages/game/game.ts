import { AI_LEVEL_LABELS, isAiLevel, type AiLevel } from '../../services/api-contract';
import { gameService } from '../../services/index';
import type { BoardState } from '../../types/domain';
import { boardLines, boardNodes } from '../../mock/game';
import { openPage, backHome } from '../../utils/navigation';
import { aiUndoCount } from '../../utils/ai-undo-preview';
import {
  createLocalGameSession, getLocalBoardView, resignLocalGame,
  tapLocalGameNode, undoLocalGame,
} from './local-game';
import type { LocalScore, LocalGameSession } from './local-game';
import { mapGameStateToView } from './game-state-mapper';
import type { GameViewModel } from './game-state-mapper';
import { createApiClient } from '../../services/api-client';
import { createGameApi } from '../../services/game-api';
import { RemoteGameController } from './remote-game';
import type { RemoteGameSnapshot } from './remote-game';
import { AiGameController } from './ai-game';
import type { AiGameSnapshot } from './ai-game';
import type { Player } from '../../domain/index';
import { getApiBaseUrl } from '../../config/api';
import { createWxDeviceHistoryStore } from '../../services/device-history';
import type { GameIdStorage } from './remote-game';
import { mapPositionAnalysis } from '../analysis/analysis-view-model';
import type { AnalysisViewModel } from '../analysis/analysis-view-model';
import { highlightBoardMove } from '../../utils/board-guidance';
import {
  DEFAULT_GAME_SETTINGS, createWxGameSettingsStore, vibrateForSuccessfulAction,
} from '../../services/game-settings';
import type { GameSettings } from '../../services/game-settings';

const activeGameIdKey = 'activeRemoteGameId';
const activeAiGameIdKey = 'activeAiGameId';
const activeLocalGameIdKey = 'activeLocalGameId';
const emptyBoard: BoardState = { nodes: boardNodes, lines: boardLines, pieces: [] };

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

function storageForRoute(base: GameIdStorage, requestedId?: string): GameIdStorage {
  let requested = requestedId || null;
  return {
    read: () => requested ?? base.read(),
    write: id => { base.write(id); requested = null; },
    clear: () => {
      const missing = requested ?? base.read();
      if (missing) {
        try { createWxDeviceHistoryStore().remove(missing); } catch { /* keep game recovery available */ }
      }
      if (!requested || base.read() === requested) base.clear();
    },
  };
}

/** A new game takes over the active slot only after successful server creation. */
function storageForNewGame(base: GameIdStorage): GameIdStorage {
  let created = false;
  return {
    read: () => created ? base.read() : null,
    write: id => { base.write(id); created = true; },
    clear: () => { if (created) base.clear(); },
  };
}

Page({
  data: { board: gameService.getBoard(), localSession: null as LocalGameSession | null,
    localGameId: '', localTurns: 0, localErrorMessage: '', localWinnerMessage: '',
    remoteState: null as RemoteGameSnapshot | null, remoteView: null as GameViewModel | null,
    remoteReady: false, aiState: null as AiGameSnapshot | null,
    aiView: null as GameViewModel | null, aiReady: false, aiUndoPlies: 0,
    aiAName: '你', aiBName: 'AI', aiLevelLabel: '',
    remoteCaptureText: '', aiCaptureText: '',
    localView: null as GameViewModel | null, aiGuidanceText: '',
    aiAnalysisView: null as AnalysisViewModel | null,
    analysisPreviewId: '', analysisPreviewText: '', analysisPreviewPurpose: '',
    mode: 'ai', thinking: false,
    showUndoConfirm: false, showResign: false, showSettings: false, showRestart: false,
    undoMessage: '撤销最近一手。', resignMessage: '', restartMessage: '',
    operationBusy: false, resigned: false,
    settings: { ...DEFAULT_GAME_SETTINGS } as GameSettings },
  remoteController: null as RemoteGameController | null,
  aiController: null as AiGameController | null,
  aiFirstPlayer: 'A' as Player,
  onLoad(options: { mode?: string; first?: string; gameId?: string; level?: string; new?: string }) {
    let settings = { ...DEFAULT_GAME_SETTINGS };
    try { settings = createWxGameSettingsStore().read(); }
    catch { wx.showToast({ title: '设置读取失败，已使用默认设置', icon: 'none' }); }
    this.setData({ settings });
    if (options.mode === 'local') {
      if (options.new === '1' && !options.gameId) this.restartLocalGame();
      else this.enterLocalGame(options.gameId);
    }
    else if (options.mode === 'remote') {
      this.setData({ mode: 'remote', board: emptyBoard, remoteReady: false,
        thinking: false, showResign: false, showSettings: false });
      this.remoteController = new RemoteGameController(
        createGameApi(createApiClient()), storageForRoute(gameIdStorage, options.gameId),
        snapshot => this.renderRemote(snapshot),
        { createOnMissing: !options.gameId },
      );
      this.renderRemote(this.remoteController.snapshot);
      void this.remoteController.enter();
    } else {
      const newGame = options.new === '1' && !options.gameId;
      let initialAiLevel = newGame && isAiLevel(options.level) ? options.level : null;
      this.aiFirstPlayer = options.first === 'ai' ? 'B'
        : options.first === 'human' ? 'A' : settings.aiFirstPlayer;
      this.setData({ mode: 'ai', board: emptyBoard, aiReady: false,
        thinking: false, showResign: false, showSettings: false });
      this.aiController = new AiGameController(
        createGameApi(createApiClient()), newGame ? storageForNewGame(aiGameIdStorage)
          : storageForRoute(aiGameIdStorage, options.gameId),
        snapshot => {
          this.renderAi(snapshot);
          if (snapshot.gameId) initialAiLevel = null;
        },
        { createOnMissing: !options.gameId, getAiLevel: () => initialAiLevel ?? this.data.settings.defaultAiLevel },
      );
      this.renderAi(this.aiController.snapshot);
      void this.aiController.enter(this.aiFirstPlayer);
    }
  },
  onShow() {
    if (this.data.mode === 'local' && this.data.localGameId) this.enterLocalGame(this.data.localGameId);
  },
  localMutationAllowed(): boolean {
    if (this.data.mode !== 'local' || !this.data.localGameId) return true;
    try {
      const entry = createWxDeviceHistoryStore().get(this.data.localGameId);
      if (!entry) throw new Error('本地棋局不存在');
      if (entry.localSync) {
        wx.showToast({ title: entry.localSync.status === 'pending'
          ? '同步结果待确认，请从历史对局重试' : '棋谱已同步，请从云端继续对弈', icon: 'none' });
        return false;
      }
      return true;
    } catch {
      wx.showToast({ title: '本地记录读取失败，暂不能修改棋局', icon: 'none' }); return false;
    }
  },
  onUnload() {
    this.remoteController?.dispose(); this.remoteController = null;
    this.aiController?.dispose(); this.aiController = null;
  },
  renderRemote(snapshot: RemoteGameSnapshot) {
    const previous = this.data.remoteState as RemoteGameSnapshot | null;
    if (snapshot.gameId && snapshot.gameState) {
      this.saveHistory(snapshot.gameId, 'remote', snapshot.gameState,
        snapshot.plyCount);
    }
    const view = snapshot.gameState ? mapGameStateToView(snapshot.gameState, {
      selectedNode: snapshot.selectedNode,
      legalTargets: snapshot.legalTargets, showLegalTargets: this.data.settings.showLegalTargets,
      lastMove: snapshot.lastMove,
      lastCapture: this.data.settings.showCaptureNotice ? snapshot.lastCapture : null,
    }) : null;
    if (previous?.gameId === snapshot.gameId && snapshot.plyCount > previous.plyCount &&
        snapshot.lastMove) vibrateForSuccessfulAction(this.data.settings);
    this.setData({ remoteState: snapshot, remoteView: view,
      operationBusy: snapshot.isOperating,
      remoteCaptureText: this.data.settings.showCaptureNotice
        ? view?.captureText ?? ''
        : '',
      remoteReady: view !== null, board: view?.board ?? emptyBoard });
  },
  renderAi(snapshot: AiGameSnapshot) {
    const previous = this.data.aiState as AiGameSnapshot | null;
    if (snapshot.gameId && snapshot.gameState) {
      this.saveHistory(snapshot.gameId, 'ai', snapshot.gameState,
        snapshot.plyCount, null, null, undefined, snapshot.aiLevel ?? undefined);
    }
    const view = snapshot.gameState ? mapGameStateToView(snapshot.gameState, {
      selectedNode: snapshot.selectedNode,
      legalTargets: snapshot.legalTargets, showLegalTargets: this.data.settings.showLegalTargets,
      lastMove: snapshot.lastMove,
      lastCapture: this.data.settings.showCaptureNotice ? snapshot.lastCapture : null,
    }, snapshot.humanPlayer) : null;
    const analysisView = snapshot.analysis && snapshot.gameState
      ? mapPositionAnalysis(snapshot.gameState, snapshot.analysis, snapshot.humanPlayer ?? undefined) : null;
    if (previous?.gameId === snapshot.gameId && snapshot.plyCount > previous.plyCount &&
        snapshot.lastMove) vibrateForSuccessfulAction(this.data.settings);
    this.setData({ aiState: snapshot, aiView: view,
      aiUndoPlies: aiUndoCount(snapshot.gameState, snapshot.plyCount, snapshot.humanPlayer),
      operationBusy: snapshot.isOperating,
      aiAnalysisView: analysisView,
      analysisPreviewId: '', analysisPreviewText: '', analysisPreviewPurpose: '',
      aiGuidanceText: view?.guidanceText.replace(/对手/g, 'AI') ?? '',
      aiCaptureText: this.data.settings.showCaptureNotice
        ? view?.captureText.replace(/对手/g, 'AI') ?? ''
        : '',
      aiLevelLabel: snapshot.aiLevel ? AI_LEVEL_LABELS[snapshot.aiLevel] : '',
      aiAName: snapshot.aiPlayer === 'A' ? `${AI_LEVEL_LABELS[snapshot.aiLevel ?? 'STANDARD']} AI` : '你',
      aiBName: snapshot.aiPlayer === 'B' ? `${AI_LEVEL_LABELS[snapshot.aiLevel ?? 'STANDARD']} AI` : '你',
      aiReady: view !== null, board: view?.board ?? emptyBoard });
  },
  localViewFor(session: LocalGameSession): GameViewModel {
    return mapGameStateToView(session.gameState, { selectedNode: session.selectedNode,
      legalTargets: session.legalDestinations, showLegalTargets: this.data.settings.showLegalTargets,
      lastMove: session.lastMove, lastCapture: this.data.settings.showCaptureNotice ? session.lastCapture : null });
  },
  back() { backHome(); },
  selectAnalysisMove(event: WechatMiniprogram.CustomEvent<{ id: string }>) {
    const analysis = this.data.aiAnalysisView;
    const move = analysis?.candidates.find(candidate => candidate.id === event.detail.id)
      ?? (analysis?.bestMove?.id === event.detail.id ? analysis.bestMove : null);
    if (!move || this.data.operationBusy || this.data.aiState?.isAiThinking) return;
    this.setData({ board: highlightBoardMove(this.data.board, move.move),
      analysisPreviewId: move.id, analysisPreviewText: `正在预览 ${move.notation}`,
      analysisPreviewPurpose: move.purpose || '当前分析尚未确认这条路线的具体战术目的。' },
      () => wx.pageScrollTo({ selector: '#game-board-preview', duration: 240 }));
  },
  clearAnalysisPreview() {
    if (!this.data.analysisPreviewId) return;
    this.setData({ board: this.data.aiView?.board ?? highlightBoardMove(this.data.board, null),
      analysisPreviewId: '', analysisPreviewText: '', analysisPreviewPurpose: '' });
  },
  onNode(event: WechatMiniprogram.CustomEvent<{ id: string }>) {
    if (this.data.operationBusy) return;
    if (this.data.mode === 'ai') {
      void this.aiController?.tapNode(event.detail.id);
      return;
    }
    if (this.data.mode === 'remote') {
      void this.remoteController?.tapNode(event.detail.id);
      return;
    }
    if (this.data.mode === 'local') {
      if (!this.localMutationAllowed()) return;
      const session = this.data.localSession as LocalGameSession | null;
      if (session === null) return;
      const result = tapLocalGameNode(session, event.detail.id);
      if (result.error) {
        wx.showToast({ title: result.error, icon: 'none' });
        return;
      }
      if (result.session === session) return;
      if (result.turn && this.data.localGameId) {
        const turns = this.data.localTurns + 1;
        if (!this.saveHistory(this.data.localGameId, 'local', result.session.gameState,
          turns, result.session.lastMove, result.session.undoFrame, result.session.score)) return;
        this.setData({ localTurns: turns });
      }
      this.setData({ localSession: result.session,
        localView: this.localViewFor(result.session),
        board: getLocalBoardView(result.session, this.data.settings.showLegalTargets, this.data.settings.showCaptureNotice) });
      if (result.turn) {
        if (this.data.settings.showCaptureNotice &&
            result.turn.captures.failure_reason === 'INSUFFICIENT_RESERVE') {
          wx.showToast({ title: '备用棋不足，本次吃子未生效', icon: 'none' });
        } else if (this.data.settings.showCaptureNotice && result.turn.captures.was_applied) {
          wx.showToast({
            title: `本步吃子 ${result.turn.captures.captured_nodes.length} 枚`, icon: 'none',
          });
        }
        vibrateForSuccessfulAction(this.data.settings);
      }
      return;
    }
    const board = this.data.board as BoardState;
    const id = event.detail.id;
    const piece = board.pieces.find(item => item.nodeId === id);
    if (piece) this.setData({ board: { ...board, selectedId: id } });
    else wx.showToast({ title: '棋局模式无效，请返回重新进入', icon: 'none' });
  },
  onAction(event: WechatMiniprogram.TouchEvent) {
    const action = event.currentTarget.dataset.action as string;
    if (action === 'undo') this.undo();
    else if (action === 'hint') this.hint();
    else if (action === 'analysis') this.openAnalysis();
    else if (action === 'review') this.openReview();
    else if (action === 'resign') this.resign();
    else if (action === 'restart') this.requestRestart();
    else if (action === 'settings') this.settings();
  },
  historyTurns(id: string): number {
    try { return createWxDeviceHistoryStore().get(id)?.turns ?? 0; }
    catch { return 0; }
  },
  requestRestart() {
    if (this.data.operationBusy) return;
    const state = this.data.mode === 'local' ? this.data.localSession?.gameState
      : this.data.mode === 'ai' ? this.data.aiState?.gameState : this.data.remoteState?.gameState;
    const turns = this.data.mode === 'local' ? this.data.localTurns
      : this.data.mode === 'ai' ? this.data.aiState?.plyCount : this.data.remoteState?.plyCount;
    if (state?.game_status === 'PLAYING' && (turns ?? 0) > 0) {
      this.setData({ showRestart: true, restartMessage: '保留当前棋局并新开一局。旧局可以从历史记录继续。' +
        (this.data.mode === 'ai' ? `下一局：${AI_LEVEL_LABELS[this.data.settings.defaultAiLevel]}，${this.data.settings.aiFirstPlayer === 'A' ? '你' : '电脑'}先走。` : '') });
    } else this.startAnotherGame();
  },
  cancelRestart() { this.setData({ showRestart: false }); },
  confirmRestart() {
    if (!this.data.showRestart || this.data.operationBusy) return;
    this.setData({ showRestart: false }); this.startAnotherGame();
  },
  startAnotherGame() {
    if (this.data.mode === 'remote') this.restartRemoteGame();
    else if (this.data.mode === 'ai') this.restartAiGame();
    else this.restartLocalGame();
  },
  saveHistory(id: string, mode: 'local' | 'remote' | 'ai',
              state: LocalGameSession['gameState'], turns: number,
              lastMove: LocalGameSession['lastMove'] = null,
              localUndoFrame: LocalGameSession['undoFrame'] = null, localScore?: LocalScore,
              aiLevel?: AiLevel): boolean {
    try {
      createWxDeviceHistoryStore().record({
        id, mode, state, turns, lastMove,
        ...(mode === 'ai' && aiLevel ? { aiLevel } : {}),
        ...(mode === 'local' ? { localUndoFrame, localScore } : {}),
      });
      return true;
    } catch {
      wx.showToast({ title: '历史记录保存失败', icon: 'none' });
      return false;
    }
  },
  enterLocalGame(requestedId?: string) {
    const savedId = requestedId || wx.getStorageSync(activeLocalGameIdKey);
    if (typeof savedId === 'string' && savedId) {
      try {
        const entry = createWxDeviceHistoryStore().get(savedId);
        if (entry?.mode === 'local' && entry.localState &&
            (requestedId || entry.status === 'PLAYING')) {
          if (entry.localSync?.status === 'linked') {
            if (entry.localSync.apiRoot !== getApiBaseUrl()) throw new Error('请恢复棋谱同步时的服务地址');
            this.onLoad({ mode: 'remote', gameId: entry.localSync.cloudGameId });
            return;
          }
          const session: LocalGameSession = {
            score: entry.localScore,
            gameState: entry.localState, selectedNode: null, legalDestinations: [],
            lastMove: entry.lastMove ?? null,
            undoFrame: entry.localUndoFrame ?? null,
          };
          wx.setStorageSync(activeLocalGameIdKey, savedId);
          this.setData({ mode: 'local', localGameId: savedId, localTurns: entry.turns,
            localSession: session, localWinnerMessage: mapGameStateToView(session.gameState).winnerMessage,
            localView: this.localViewFor(session),
            board: getLocalBoardView(session, this.data.settings.showLegalTargets, this.data.settings.showCaptureNotice),
            localErrorMessage: '',
            thinking: false, showUndoConfirm: false,
            showResign: false, showSettings: false, operationBusy: false, resigned: false });
          return;
        }
      } catch {
        if (requestedId) {
          this.setData({ mode: 'local', localSession: null, localGameId: savedId,
            localView: null, localErrorMessage: '本地历史棋局读取失败', board: emptyBoard });
          return;
        }
        wx.showToast({ title: '本地记录读取失败', icon: 'none' });
      }
    }
    if (requestedId) {
      this.setData({ mode: 'local', localSession: null, localGameId: requestedId,
        localView: null, localErrorMessage: '本地历史棋局不存在', board: emptyBoard });
      return;
    }
    this.restartLocalGame();
  },
  restartLocalGame() {
    const session = createLocalGameSession();
    const baseId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let id = baseId;
    try {
      const existingIds = new Set(createWxDeviceHistoryStore().list().map(row => row.id));
      let suffix = 0;
      while (existingIds.has(id)) id = `${baseId}-${++suffix}`;
    } catch {
      wx.showToast({ title: '本地记录读取失败，暂不能新建棋局', icon: 'none' }); return;
    }
    if (!this.saveHistory(id, 'local', session.gameState, 0, null, null, session.score)) {
      this.setData({ mode: 'local', localErrorMessage: '本地棋局保存失败，请重试新局' });
      return;
    }
    try { wx.setStorageSync(activeLocalGameIdKey, id); }
    catch { wx.showToast({ title: '自动续局设置失败，请从历史对局打开', icon: 'none' }); }
    this.setData({
      mode: 'local', localGameId: id, localTurns: 0,
      localSession: session, localWinnerMessage: mapGameStateToView(session.gameState).winnerMessage,
      localView: this.localViewFor(session),
      board: getLocalBoardView(session, this.data.settings.showLegalTargets, this.data.settings.showCaptureNotice),
      localErrorMessage: '',
      thinking: false, showUndoConfirm: false,
      showResign: false, showSettings: false, operationBusy: false, resigned: false,
    });
  },
  restartRemoteGame() { void this.remoteController?.restart(); },
  retryRemoteGame() { void this.remoteController?.retry(); },
  restartAiGame() {
    this.aiFirstPlayer = this.data.settings.aiFirstPlayer;
    void this.aiController?.restart(this.aiFirstPlayer);
  },
  restartAiFirstGame() {
    this.onSettingsChange({ detail: { ...this.data.settings, aiFirstPlayer: 'B' } });
    this.setData({ showSettings: false });
    this.restartAiGame();
  },
  retryAiGame() { void this.aiController?.retry(this.aiFirstPlayer); },
  undo() {
    if (this.data.operationBusy || !this.localMutationAllowed()) return;
    this.setData({ undoMessage: '撤销最近一手，回到落子前的局面。' });
    if (this.data.mode === 'ai') {
      const snapshot = this.data.aiState as AiGameSnapshot | null;
      if (!snapshot || snapshot.gameState?.game_status !== 'PLAYING') {
        wx.showToast({ title: '对局已结束，无法悔棋', icon: 'none' }); return;
      }
      const count = aiUndoCount(snapshot.gameState, snapshot.plyCount, snapshot.humanPlayer);
      if (!count) {
        wx.showToast({ title: '你还未落子，当前无法悔棋', icon: 'none' }); return;
      }
      this.setData({ showUndoConfirm: true, showResign: false, undoMessage: count === 2
        ? '回退 2 手：撤销你最近一步及电脑随后的回应，回到你落子前的局面。'
        : '回退 1 手：撤销你最近一步。电脑尚未回应，回到你落子前的局面。' }); return;
    }
    if (this.data.mode === 'remote') {
      const snapshot = this.data.remoteState as RemoteGameSnapshot | null;
      if (!snapshot || snapshot.gameState?.game_status !== 'PLAYING') {
        wx.showToast({ title: '对局已结束，无法悔棋', icon: 'none' }); return;
      }
      if (snapshot.plyCount === 0) {
        wx.showToast({ title: '当前没有可悔的棋步', icon: 'none' }); return;
      }
      this.setData({ showUndoConfirm: true, showResign: false }); return;
    }
    const session = this.data.localSession as LocalGameSession | null;
    if (!session || session.gameState.game_status !== 'PLAYING') {
      wx.showToast({ title: '对局已结束，无法悔棋', icon: 'none' });
      return;
    }
    if (!session.undoFrame) {
      wx.showToast({ title: '当前没有可悔的棋步', icon: 'none' });
      return;
    }
    this.setData({ showUndoConfirm: true, showResign: false });
  },
  cancelUndo() { this.setData({ showUndoConfirm: false }); },
  async confirmUndo() {
    if (this.data.operationBusy || !this.localMutationAllowed()) return;
    if (this.data.mode === 'ai' || this.data.mode === 'remote') {
      this.setData({ showUndoConfirm: false, operationBusy: true });
      const success = this.data.mode === 'ai'
        ? await this.aiController?.undo() : await this.remoteController?.undo();
      this.setData({ operationBusy: false });
      if (success) vibrateForSuccessfulAction(this.data.settings);
      return;
    }
    if (this.data.mode !== 'local') return;
    const session = this.data.localSession as LocalGameSession | null;
    if (!session || session.gameState.game_status !== 'PLAYING' || !session.undoFrame) {
      this.setData({ showUndoConfirm: false });
      return;
    }
    this.setData({ operationBusy: true });
    const undone = undoLocalGame(session);
    const turns = Math.max(0, this.data.localTurns - 1);
    if (!this.saveHistory(this.data.localGameId, 'local', undone.gameState,
      turns, undone.lastMove, undone.undoFrame, undone.score)) {
      this.setData({ operationBusy: false });
      return;
    }
    this.setData({
      localSession: undone, localTurns: turns,
      localView: this.localViewFor(undone),
      board: getLocalBoardView(undone, this.data.settings.showLegalTargets, this.data.settings.showCaptureNotice),
      showUndoConfirm: false, operationBusy: false,
    });
    vibrateForSuccessfulAction(this.data.settings);
  },
  hint() {
    if (this.data.mode === 'ai') {
      void this.aiController?.requestCoachHint();
      return;
    }
    if (this.data.mode === 'local' || this.data.mode === 'remote') {
      this.openAnalysis();
      return;
    }
    wx.showToast({ title: '棋局模式无效，请返回重新进入', icon: 'none' });
  },
  openAnalysis() {
    if (this.data.mode === 'ai') {
      void this.aiController?.analyze();
      return;
    }
    const gameId = this.data.mode === 'local'
      ? this.data.localGameId : this.data.remoteState?.gameId;
    if (!gameId) {
      wx.showToast({ title: '当前没有可分析的棋局', icon: 'none' });
      return;
    }
    openPage(`/pages/analysis/analysis?mode=${this.data.mode}&gameId=${encodeURIComponent(gameId)}`);
  },
  openReview() {
    const gameId = this.data.mode === 'ai'
      ? this.data.aiState?.gameId : this.data.remoteState?.gameId;
    if (gameId) openPage(`/pages/review/review?gameId=${encodeURIComponent(gameId)}`);
  },
  resign() {
    if (this.data.operationBusy || !this.localMutationAllowed()) return;
    const player = this.data.mode === 'local' ? this.data.localSession?.gameState.current_player : this.data.remoteState?.gameState?.current_player;
    this.setData({ resignMessage: this.data.mode === 'ai' ? '你将认输，电脑获胜。'
      : `${player === 'B' ? '红方' : '黑方'}将认输，另一方获胜。` });
    if (this.data.mode === 'local') {
      const session = this.data.localSession as LocalGameSession | null;
      if (!session || session.gameState.game_status !== 'PLAYING') {
        wx.showToast({ title: '对局已结束', icon: 'none' });
        return;
      }
    } else if (this.data.mode === 'ai') {
      const snapshot = this.data.aiState as AiGameSnapshot | null;
      if (!snapshot || snapshot.gameState?.game_status !== 'PLAYING') {
        wx.showToast({ title: '对局已结束', icon: 'none' }); return;
      }
    } else if (this.data.mode === 'remote') {
      const snapshot = this.data.remoteState as RemoteGameSnapshot | null;
      if (!snapshot || snapshot.gameState?.game_status !== 'PLAYING') {
        wx.showToast({ title: '对局已结束', icon: 'none' }); return;
      }
    }
    this.setData({ showResign: true, showUndoConfirm: false });
  },
  cancelResign() { this.setData({ showResign: false }); },
  async confirmResign() {
    if (this.data.operationBusy || !this.localMutationAllowed()) return;
    if (this.data.mode === 'ai' || this.data.mode === 'remote') {
      this.setData({ showResign: false, operationBusy: true });
      const success = this.data.mode === 'ai'
        ? await this.aiController?.resign() : await this.remoteController?.resign();
      this.setData({ operationBusy: false, resigned: !!success });
      if (success) vibrateForSuccessfulAction(this.data.settings);
      return;
    }
    if (this.data.mode !== 'local') return;
    const session = this.data.localSession as LocalGameSession | null;
    if (!session || session.gameState.game_status !== 'PLAYING') {
      this.setData({ showResign: false });
      return;
    }
    this.setData({ operationBusy: true });
    const resigned = resignLocalGame(session);
    if (!this.saveHistory(this.data.localGameId, 'local', resigned.gameState,
      this.data.localTurns, resigned.lastMove, resigned.undoFrame, resigned.score)) {
      this.setData({ operationBusy: false });
      return;
    }
    this.setData({
      localSession: resigned, localWinnerMessage: mapGameStateToView(resigned.gameState).winnerMessage,
      localView: this.localViewFor(resigned),
      board: getLocalBoardView(resigned, this.data.settings.showLegalTargets, this.data.settings.showCaptureNotice),
      showResign: false, operationBusy: false, resigned: true,
    });
    vibrateForSuccessfulAction(this.data.settings);
  },
  onSettingsChange(event: { detail: GameSettings }) {
    const settings = event.detail;
    try { createWxGameSettingsStore().write(settings); }
    catch {
      wx.showToast({ title: '设置保存失败', icon: 'none' });
      return;
    }
    this.setData({ settings });
    const session = this.data.localSession as LocalGameSession | null;
    if (this.data.mode === 'local' && session) {
      this.setData({ localView: this.localViewFor(session), board: getLocalBoardView(session, settings.showLegalTargets, settings.showCaptureNotice) });
    } else if (this.data.mode === 'remote' && this.data.remoteState) {
      this.renderRemote(this.data.remoteState);
    } else if (this.data.mode === 'ai' && this.data.aiState) {
      this.renderAi(this.data.aiState);
    }
  },
  settings() { this.setData({ showSettings: !this.data.showSettings }); },
  toggleThinking() {}
});
