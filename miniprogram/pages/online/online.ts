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
    undoMessage: '预计回退 1 或 2 手，准确手数以服务端申请结果为准。对方同意后生效。',
    operationBusy: false,
    captureText: '',
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
      this.setData({ snapshot: { room: null, selectedNode: null, legalTargets: [],
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
    void this.controller?.refresh();
    this.poller = setInterval(() => { void this.controller?.refresh(); }, 3000) as unknown as number;
  },
  onHide() { this.stopPolling(); },
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
      legalTargets: this.data.settings.showLegalTargets ? snapshot.legalTargets : [],
      lastMove: snapshot.lastMove,
      lastCapture: this.data.settings.showCaptureNotice ? snapshot.lastCapture : null,
    }) : null;
    if (snapshot.successfulAction > this.lastSuccessfulAction) {
      this.lastSuccessfulAction = snapshot.successfulAction;
      vibrateForSuccessfulAction(this.data.settings);
    }
    this.setData({ snapshot, view, board: view?.board ?? emptyBoard,
      operationBusy: snapshot.busy || snapshot.isOperating,
      captureText: this.data.settings.showCaptureNotice && snapshot.lastCapture?.was_applied
        ? `本步吃子 ${snapshot.lastCapture.captured_nodes.length} 枚，备用棋消耗 ${snapshot.lastCapture.reserve_used} 枚` : '',
      ...(!snapshot.canRequestUndo ? { showUndoConfirm: false } : {}),
      ...(!snapshot.canResign ? { showResign: false } : {}),
    });
  },
  back() { backHome(); },
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
  leaveRoom() { this.controller?.leave(); },
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
    this.setData({ showResign: true, showUndoConfirm: false });
  },
  cancelResign() { this.setData({ showResign: false }); },
  async confirmResign() {
    if (!this.data.showResign || this.data.operationBusy) return;
    this.setData({ showResign: false });
    await this.controller?.resign();
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
