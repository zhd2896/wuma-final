import { gameService } from '../../services/index';
import type { BoardState } from '../../types/domain';
import { boardLines, boardNodes } from '../../mock/game';
import { openPage, backHome } from '../../utils/navigation';
import {
  createLocalGameSession, getLocalBoardView, resignLocalGame,
  tapLocalGameNode, undoLocalGame,
} from './local-game';
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
import { createWxDeviceHistoryStore } from '../../services/device-history';
import type { GameIdStorage } from './remote-game';
import { mapPositionAnalysis } from '../analysis/analysis-view-model';
import type { AnalysisViewModel } from '../analysis/analysis-view-model';
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

Page({
  data: { board: gameService.getBoard(), localSession: null as LocalGameSession | null,
    localGameId: '', localTurns: 0, localErrorMessage: '',
    remoteState: null as RemoteGameSnapshot | null, remoteView: null as GameViewModel | null,
    remoteReady: false, aiState: null as AiGameSnapshot | null,
    aiView: null as GameViewModel | null, aiReady: false,
    aiAName: '玩家 A', aiBName: '标准 AI · B',
    remoteCaptureText: '', aiCaptureText: '',
    aiAnalysisView: null as AnalysisViewModel | null,
    mode: 'ai', showHint: false, thinking: false,
    showUndoConfirm: false, showResign: false, showSettings: false,
    operationBusy: false, resigned: false,
    settings: { ...DEFAULT_GAME_SETTINGS } as GameSettings },
  remoteController: null as RemoteGameController | null,
  aiController: null as AiGameController | null,
  aiFirstPlayer: 'A' as Player,
  onLoad(options: { mode?: string; first?: string; gameId?: string }) {
    let settings = { ...DEFAULT_GAME_SETTINGS };
    try { settings = createWxGameSettingsStore().read(); }
    catch { wx.showToast({ title: '设置读取失败，已使用默认设置', icon: 'none' }); }
    this.setData({ settings });
    if (options.mode === 'local') this.enterLocalGame(options.gameId);
    else if (options.mode === 'remote') {
      this.setData({ mode: 'remote', board: emptyBoard, remoteReady: false,
        showHint: false, thinking: false, showResign: false, showSettings: false });
      this.remoteController = new RemoteGameController(
        createGameApi(createApiClient()), storageForRoute(gameIdStorage, options.gameId),
        snapshot => this.renderRemote(snapshot),
        { createOnMissing: !options.gameId },
      );
      this.renderRemote(this.remoteController.snapshot);
      void this.remoteController.enter();
    } else {
      this.aiFirstPlayer = options.first === 'ai' ? 'B'
        : options.first === 'human' ? 'A' : settings.aiFirstPlayer;
      this.setData({ mode: 'ai', board: emptyBoard, aiReady: false,
        showHint: false, thinking: false, showResign: false, showSettings: false });
      this.aiController = new AiGameController(
        createGameApi(createApiClient()), storageForRoute(aiGameIdStorage, options.gameId),
        snapshot => this.renderAi(snapshot),
        { createOnMissing: !options.gameId },
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
    const previous = this.data.remoteState as RemoteGameSnapshot | null;
    if (snapshot.gameId && snapshot.gameState) {
      this.saveHistory(snapshot.gameId, 'remote', snapshot.gameState,
        snapshot.plyCount);
    }
    const view = snapshot.gameState ? mapGameStateToView(snapshot.gameState, {
      selectedNode: snapshot.selectedNode,
      legalTargets: this.data.settings.showLegalTargets ? snapshot.legalTargets : [],
      lastMove: snapshot.lastMove,
    }) : null;
    if (previous?.gameId === snapshot.gameId && snapshot.plyCount > previous.plyCount &&
        snapshot.lastMove) vibrateForSuccessfulAction(this.data.settings);
    this.setData({ remoteState: snapshot, remoteView: view,
      operationBusy: snapshot.isOperating,
      remoteCaptureText: this.data.settings.showCaptureNotice && snapshot.lastCapture?.was_applied
        ? `本步吃子 ${snapshot.lastCapture.captured_nodes.length} 枚，备用棋消耗 ${snapshot.lastCapture.reserve_used} 枚`
        : '',
      remoteReady: view !== null, board: view?.board ?? emptyBoard });
  },
  renderAi(snapshot: AiGameSnapshot) {
    const previous = this.data.aiState as AiGameSnapshot | null;
    if (snapshot.gameId && snapshot.gameState) {
      this.saveHistory(snapshot.gameId, 'ai', snapshot.gameState,
        snapshot.plyCount);
    }
    const view = snapshot.gameState ? mapGameStateToView(snapshot.gameState, {
      selectedNode: snapshot.selectedNode,
      legalTargets: this.data.settings.showLegalTargets ? snapshot.legalTargets : [],
      lastMove: snapshot.lastMove,
      lastCapture: snapshot.lastCapture,
    }) : null;
    const analysisView = snapshot.analysis && snapshot.gameState
      ? mapPositionAnalysis(snapshot.gameState, snapshot.analysis) : null;
    if (previous?.gameId === snapshot.gameId && snapshot.plyCount > previous.plyCount &&
        snapshot.lastMove) vibrateForSuccessfulAction(this.data.settings);
    this.setData({ aiState: snapshot, aiView: view,
      operationBusy: snapshot.isOperating,
      aiAnalysisView: analysisView,
      aiCaptureText: this.data.settings.showCaptureNotice && snapshot.lastCapture?.was_applied
        ? `本步吃子 ${snapshot.lastCapture.captured_nodes.length} 枚，备用棋消耗 ${snapshot.lastCapture.reserve_used} 枚`
        : '',
      aiAName: snapshot.aiPlayer === 'A' ? '标准 AI · A' : '玩家 A',
      aiBName: snapshot.aiPlayer === 'B' ? '标准 AI · B' : '玩家 B',
      aiReady: view !== null, board: view?.board ?? emptyBoard });
  },
  back() { backHome(); },
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
          turns, result.session.lastMove, result.session.undoFrame)) return;
        this.setData({ localTurns: turns });
      }
      this.setData({ localSession: result.session,
        board: getLocalBoardView(result.session, this.data.settings.showLegalTargets) });
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
  historyTurns(id: string): number {
    try { return createWxDeviceHistoryStore().get(id)?.turns ?? 0; }
    catch { return 0; }
  },
  saveHistory(id: string, mode: 'local' | 'remote' | 'ai',
              state: LocalGameSession['gameState'], turns: number,
              lastMove: LocalGameSession['lastMove'] = null,
              localUndoFrame: LocalGameSession['undoFrame'] = null): boolean {
    try {
      createWxDeviceHistoryStore().record({
        id, mode, state, turns, lastMove,
        ...(mode === 'local' ? { localUndoFrame } : {}),
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
          const session: LocalGameSession = {
            gameState: entry.localState, selectedNode: null, legalDestinations: [],
            lastMove: entry.lastMove ?? null,
            undoFrame: entry.localUndoFrame ?? null,
          };
          wx.setStorageSync(activeLocalGameIdKey, savedId);
          this.setData({ mode: 'local', localGameId: savedId, localTurns: entry.turns,
            localSession: session,
            board: getLocalBoardView(session, this.data.settings.showLegalTargets),
            localErrorMessage: '',
            showHint: false, thinking: false, showUndoConfirm: false,
            showResign: false, showSettings: false, operationBusy: false, resigned: false });
          return;
        }
      } catch {
        if (requestedId) {
          this.setData({ mode: 'local', localSession: null, localGameId: savedId,
            localErrorMessage: '本地历史棋局读取失败', board: emptyBoard });
          return;
        }
        wx.showToast({ title: '本地记录读取失败', icon: 'none' });
      }
    }
    if (requestedId) {
      this.setData({ mode: 'local', localSession: null, localGameId: requestedId,
        localErrorMessage: '本地历史棋局不存在', board: emptyBoard });
      return;
    }
    this.restartLocalGame();
  },
  restartLocalGame() {
    const session = createLocalGameSession();
    const id = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (!this.saveHistory(id, 'local', session.gameState, 0)) {
      this.setData({ mode: 'local', localErrorMessage: '本地棋局保存失败，请重试新局' });
      return;
    }
    try { wx.setStorageSync(activeLocalGameIdKey, id); }
    catch { wx.showToast({ title: '自动续局设置失败，请从历史对局打开', icon: 'none' }); }
    this.setData({
      mode: 'local', localGameId: id, localTurns: 0,
      localSession: session,
      board: getLocalBoardView(session, this.data.settings.showLegalTargets),
      localErrorMessage: '',
      showHint: false, thinking: false, showUndoConfirm: false,
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
    if (this.data.operationBusy) return;
    if (this.data.mode === 'ai') {
      const snapshot = this.data.aiState as AiGameSnapshot | null;
      if (!snapshot || snapshot.gameState?.game_status !== 'PLAYING') {
        wx.showToast({ title: '对局已结束，无法悔棋', icon: 'none' }); return;
      }
      if (snapshot.plyCount === 0) {
        wx.showToast({ title: '当前没有可悔的棋步', icon: 'none' }); return;
      }
      this.setData({ showUndoConfirm: true, showResign: false }); return;
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
    if (this.data.operationBusy) return;
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
      turns, undone.lastMove, undone.undoFrame)) {
      this.setData({ operationBusy: false });
      return;
    }
    this.setData({
      localSession: undone, localTurns: turns,
      board: getLocalBoardView(undone, this.data.settings.showLegalTargets),
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
      wx.showToast({ title: '当前对局暂不提供提示', icon: 'none' });
      return;
    }
    this.setData({ showHint: !this.data.showHint });
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
    if (this.data.operationBusy) return;
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
    if (this.data.operationBusy) return;
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
      this.data.localTurns, resigned.lastMove, resigned.undoFrame)) {
      this.setData({ operationBusy: false });
      return;
    }
    this.setData({
      localSession: resigned,
      board: getLocalBoardView(resigned, this.data.settings.showLegalTargets),
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
      this.setData({ board: getLocalBoardView(session, settings.showLegalTargets) });
    } else if (this.data.mode === 'remote' && this.data.remoteState) {
      this.renderRemote(this.data.remoteState);
    } else if (this.data.mode === 'ai' && this.data.aiState) {
      this.renderAi(this.data.aiState);
    }
  },
  settings() { this.setData({ showSettings: !this.data.showSettings }); },
  toggleThinking() {}
});
