import { createApiClient } from '../../services/api-client';
import { createOnlineApi } from '../../services/online-api';
import { createWxDeviceHistoryStore } from '../../services/device-history';
import { boardLines, boardNodes } from '../../mock/game';
import { backHome } from '../../utils/navigation';
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
  },
  controller: null as OnlineGameController | null,
  poller: null as number | null,
  onLoad(options: { gameId?: string; code?: string }) {
    let api;
    try { api = createOnlineApi(createApiClient()); }
    catch {
      this.setData({ snapshot: { room: null, selectedNode: null, legalTargets: [],
        lastMove: null, lastCapture: null, busy: false, error: '', pendingMove: false },
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
          state: room.state, turns: room.version });
      } catch { this.setData({ message: '本机历史记录保存失败，请保留房间码' }); }
    }
    const view = room ? mapGameStateToView(room.state, {
      selectedNode: snapshot.selectedNode, legalTargets: snapshot.legalTargets,
      lastMove: snapshot.lastMove, lastCapture: snapshot.lastCapture,
    }) : null;
    this.setData({ snapshot, view, board: view?.board ?? emptyBoard });
  },
  back() { backHome(); },
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
