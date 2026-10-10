import { createApiClient } from '../../services/api-client';
import { createOnlineApi } from '../../services/online-api';
import { createWxDeviceHistoryStore } from '../../services/device-history';
import { DEFAULT_GAME_SETTINGS, createWxGameSettingsStore, vibrateForSuccessfulAction } from '../../services/game-settings';
import type { GameSettings } from '../../services/game-settings';
import { boardLines, boardNodes } from '../../mock/game';
import { backHome, openPage } from '../../utils/navigation';
import { mapGameStateToView } from '../game/game-state-mapper';
import type { GameViewModel } from '../game/game-state-mapper';
import type { BoardState } from '../../types/domain';
import { OnlineGameController } from './online-game';
import type { OnlineSnapshot } from './online-game';
import { roomCountdown } from './online-presentation';
import { describeMove } from '../../utils/board-guidance';

const emptyBoard: BoardState = { nodes: boardNodes, lines: boardLines, pieces: [] };

Page({
  data: {
    snapshot: null as OnlineSnapshot | null,
    view: null as GameViewModel | null,
    board: emptyBoard,
    joinCode: '',
    message: '',
    settings: { ...DEFAULT_GAME_SETTINGS } as GameSettings,
    showSettings: false,
    showUndoConfirm: false,
    showResign: false,
    showLeave: false, exitAfterResign: false,
    connectionText: '', lastSyncedText: '', recentAction: '', waitingTime: '',
    undoMessage: '预计回退 1 或 2 手，准确手数以服务端申请结果为准。对方同意后生效。',
    operationBusy: false,
    captureText: '', turnLabel: '', turnGuidance: '',
  },
  controller: null as OnlineGameController | null,
  poller: null as number | null,
  lastSuccessfulAction: 0,
  onLoad(options: { gameId?: string; code?: string }) {
    let settings = { ...DEFAULT_GAME_SETTINGS };
    try { settings = createWxGameSettingsStore().read(); }
    catch { this.setData({ message: '本机设置读取失败，本局使用默认设置' }); }
    this.lastSuccessfulAction = 0;
    this.setData({ settings });
    let api;
    try { api = createOnlineApi(createApiClient()); }
    catch {
      this.setData({ snapshot: { connection: 'offline', lastSyncedAt: null, skippedTurns: 0, resumeGameId: null,
        room: null, selectedNode: null, legalTargets: [],
        lastMove: null, lastCapture: null, busy: false, error: '', pendingMove: false,
        pendingOperation: false, isOperating: false, canRequestUndo: false, canRespondToUndo: false,
        canResign: false, operationNotice: '', successfulAction: 0 },
        message: '联机服务暂不可用，请稍后重试' });
      return;
    }
    this.controller = new OnlineGameController(api, {
      read: key => wx.getStorageSync(key),
      write: (key, value) => { wx.setStorageSync(key, value); },
      remove: key => { wx.removeStorageSync(key); },
    }, snapshot => this.render(snapshot));
    this.render(this.controller.snapshot);
    if (options.code) this.setData({ joinCode: options.code.toUpperCase() });
    if (options.gameId || !options.code) void this.controller.restore(options.gameId);
  },
  onShow() {
    if (this.poller !== null || !this.controller) return;
    void this.controller?.refresh(undefined, true);
    this.poller = setInterval(() => {
      if (this.data.snapshot?.room?.room_status === 'WAITING')
        this.setData({ waitingTime: roomCountdown(this.data.snapshot.room.expires_at) });
      void this.controller?.refresh();
    }, 3000) as unknown as number;
  },
  onHide() { this.stopPolling(); this.controller?.pause(); },
  onUnload() { this.stopPolling(); this.controller?.dispose(); this.controller = null; },
  stopPolling() {
    if (this.poller !== null) { clearInterval(this.poller); this.poller = null; }
  },
  render(snapshot: OnlineSnapshot) {
    const room = snapshot.room;
    if (room) {
      try {
        const history = createWxDeviceHistoryStore();
        if (room.room_status === 'CANCELLED' || room.room_status === 'EXPIRED')
          history.remove(room.game_id);
        else history.record({ id: room.game_id, mode: 'online',
          state: room.state, turns: room.ply_count });
      } catch { this.setData({ message: '本机历史记录保存失败，请保留房间码' }); }
    }
    const view = room ? mapGameStateToView(room.state, {
      selectedNode: snapshot.selectedNode,
      legalTargets: snapshot.legalTargets, showLegalTargets: this.data.settings.showLegalTargets,
      lastMove: snapshot.lastMove,
      lastCapture: this.data.settings.showCaptureNotice ? snapshot.lastCapture : null,
    }, room.seat) : null;
    if (snapshot.successfulAction > this.lastSuccessfulAction) {
      this.lastSuccessfulAction = snapshot.successfulAction;
      vibrateForSuccessfulAction(this.data.settings);
    }
    const turnLabel = !room || !view ? '' : snapshot.connection !== 'connected' ? '棋局同步尚未完成'
      : view.gameOver ? view.turnTitle
      : room.pending_undo ? '悔棋协商中，棋盘已暂停'
      : snapshot.busy || snapshot.isOperating ? '正在处理操作'
      : snapshot.pendingOperation || snapshot.pendingMove ? '等待确认操作结果'
      : view.turnTitle;
    const turnGuidance = !room || !view ? '' : snapshot.connection !== 'connected' ? '当前棋盘供查看，恢复同步后才能继续操作'
      : view.gameOver ? view.winnerMessage
      : room.pending_undo ? '等待双方处理悔棋申请，暂时不能落子'
      : snapshot.busy || snapshot.isOperating ? '正在处理，请稍候…'
      : snapshot.pendingOperation || snapshot.pendingMove ? '操作结果尚未确认，请点恢复操作'
      : view.guidanceText;
    const recentAction = snapshot.lastMove ? `${snapshot.skippedTurns ? `已更新 ${snapshot.skippedTurns + 1} 手，以下是最近一手：` : '最近一手：'}${describeMove(snapshot.lastMove)}` : '';
    this.setData({ snapshot, view, turnLabel, turnGuidance, recentAction,
      waitingTime: room ? roomCountdown(room.expires_at) : '',
      connectionText: snapshot.connection === 'connected' ? '已同步' : snapshot.connection === 'reconnecting' ? '正在恢复同步…' : '连接中断 · 请重试',
      lastSyncedText: snapshot.lastSyncedAt ? `上次同步 ${new Date(snapshot.lastSyncedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : '尚未成功同步',
      board: view?.board ?? emptyBoard,
      operationBusy: snapshot.busy || snapshot.isOperating,
      captureText: this.data.settings.showCaptureNotice ? view?.captureText ?? '' : '',
      ...(!snapshot.canRequestUndo ? { showUndoConfirm: false } : {}),
      ...(!snapshot.canResign ? { showResign: false } : {}),
    });
  },
  back() {
    if (this.data.operationBusy || this.data.snapshot?.pendingMove || this.data.snapshot?.pendingOperation) return;
    if (this.data.snapshot?.room?.room_status === 'PLAYING' || this.data.snapshot?.room?.room_status === 'WAITING')
      this.setData({ showLeave: true });
    else backHome();
  },
  openAnalysis() {
    const room = this.data.snapshot?.room;
    if (room && (room.room_status === 'PLAYING' || room.room_status === 'FINISHED'))
      openPage(`/pages/analysis/analysis?mode=online&gameId=${encodeURIComponent(room.game_id)}`);
  },
  viewReview() {
    const room = this.data.snapshot?.room;
    if (room?.room_status === 'FINISHED')
      openPage(`/pages/review/review?mode=online&gameId=${encodeURIComponent(room.game_id)}`);
  },
  createPrivate() { void this.controller?.create(false); },
  matchPublic() { void this.controller?.match(); },
  codeInput(event: WechatMiniprogram.Input) {
    this.setData({ joinCode: event.detail.value.toUpperCase() });
  },
  joinRoom() { void this.controller?.join(this.data.joinCode); },
  cancelRoom() { void this.controller?.cancel(); },
  leaveRoom() {
    if (this.data.snapshot?.room?.room_status === 'PLAYING' || this.data.snapshot?.room?.room_status === 'WAITING')
      this.setData({ showLeave: true });
    else this.controller?.leave();
  },
  cancelLeave() { this.setData({ showLeave: false }); },
  confirmLeave() {
    if (!this.data.showLeave || this.data.operationBusy || this.data.snapshot?.pendingMove || this.data.snapshot?.pendingOperation) return;
    this.setData({ showLeave: false }); this.controller?.leave(); backHome();
  },
  resumeRoom() { void this.controller?.restore(this.data.snapshot?.resumeGameId ?? undefined); },
  resignAndLeave() {
    if (!this.data.snapshot?.canResign) return;
    this.setData({ showLeave: false, showResign: true, exitAfterResign: true });
  },
  refreshRoom() { void this.controller?.refresh(); },
  retryMove() { void this.controller?.retryMove(); },
  retryOperation() { return this.controller?.retry(); },
  requestUndo() {
    if (!this.data.snapshot?.canRequestUndo || this.data.operationBusy) return;
    this.setData({ showUndoConfirm: true, showResign: false });
  },
  cancelUndo() { this.setData({ showUndoConfirm: false }); },
  async confirmUndo() {
    if (!this.data.showUndoConfirm || this.data.operationBusy) return;
    this.setData({ showUndoConfirm: false });
    await this.controller?.requestUndo();
  },
  acceptUndo() { return this.controller?.acceptUndo(); },
  declineUndo() { return this.controller?.declineUndo(); },
  resign() {
    if (!this.data.snapshot?.canResign || this.data.operationBusy) return;
    this.setData({ showResign: true, showUndoConfirm: false, exitAfterResign: false });
  },
  cancelResign() { this.setData({ showResign: false, exitAfterResign: false }); },
  async confirmResign() {
    if (!this.data.showResign || this.data.operationBusy) return;
    this.setData({ showResign: false });
    const exit = this.data.exitAfterResign;
    this.setData({ exitAfterResign: false });
    if (await this.controller?.resign()) {
      if (exit) { this.controller?.leave(); backHome(); }
    }
  },
  settings() { this.setData({ showSettings: !this.data.showSettings }); },
  onSettingsChange(event: WechatMiniprogram.CustomEvent<GameSettings>) {
    try { createWxGameSettingsStore().write(event.detail); }
    catch { this.setData({ message: '本机设置保存失败，请重试' }); return; }
    this.setData({ settings: event.detail });
    if (this.data.snapshot) this.render(this.data.snapshot);
  },
  onNode(event: WechatMiniprogram.CustomEvent<{ id: string }>) {
    void this.controller?.tapNode(event.detail.id);
  },
  copyCode() {
    const code = this.data.snapshot?.room?.invite_code;
    if (code) wx.setClipboardData({ data: code });
  },
  onShareAppMessage() {
    const room = this.data.snapshot?.room;
    const code = room?.room_status === 'WAITING' ? room.invite_code : null;
    return { title: code ? `弈智五马 · 加入房间 ${code}` : '弈智五马 · 远程双人',
      path: code ? `/pages/online/online?code=${code}` : '/pages/online/online' };
  },
});
