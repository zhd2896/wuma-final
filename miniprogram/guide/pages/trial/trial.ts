import { TrialController } from '../../trial-controller';
import { getLocalBoardView } from '../../../pages/game/local-game';
import type { BoardState } from '../../../types/domain';
import { hasWechatSession } from '../../../services/device-auth';
import { showLogin } from '../../../services/auth-navigation';
import { openPage, backHome } from '../../../utils/navigation';
import { createWxDeviceHistoryStore } from '../../../services/device-history';
import { syncLocalScore } from '../../../services/local-score-sync';
import { ApiError, messageForApiError } from '../../../services/api-client';

const draftKey = 'wuma:trial-draft:v1';
const saveRoute = '/guide/pages/trial/trial?save=1';

Page({
  data: { board: { nodes: [], lines: [], pieces: [] } as BoardState,
    turns: 0, blackReserve: 4, redReserve: 4, message: '', result: '',
    finished: false, ready: false, saving: false, saved: false, locked: false,
    errorMessage: '', draftWarning: '' },
  controller: null as TrialController | null,
  disposed: false,
  onLoad(options: { save?: string } = {}) {
    this.disposed = false;
    try {
      const draft = wx.getStorageSync(draftKey);
      this.controller = new TrialController(draft === '' || draft === undefined ? undefined : draft);
      this.persistDraft(); this.render(); this.refreshLock();
      if (options.save === '1') void this.save();
    } catch (error) {
      this.setData({ ready: false, errorMessage: error instanceof Error && /试玩/.test(error.message)
        ? error.message : '试玩草稿读取失败，请重试或重新开始。' });
    }
  },
  onShow() { this.refreshLock(); },
  onUnload() { this.disposed = true; },
  render() {
    if (!this.controller || this.disposed) return;
    const session = this.controller.session, state = session.gameState;
    this.setData({ board: getLocalBoardView(session), turns: session.score!.moves.length,
      blackReserve: state.players.A.reserve_count, redReserve: state.players.B.reserve_count,
      message: this.controller.message, ready: true, finished: state.game_status === 'FINISHED',
      result: state.winner ? `${state.winner === 'A' ? '你赢了' : '电脑赢了'}${state.winner_reason === 'RESIGN' ? ' · 你已认输' : ''}` : '' });
  },
  persistDraft(): boolean {
    if (!this.controller) return false;
    try { wx.setStorageSync(draftKey, this.controller.draft); this.setData({ draftWarning: '' }); return true; }
    catch { this.setData({ draftWarning: '试玩暂存失败。请保留此页面，重试保存后再退出。' }); return false; }
  },
  refreshLock() {
    if (!this.controller || this.disposed) return;
    try {
      const row = createWxDeviceHistoryStore().get(this.controller.id);
      this.setData({ locked: !!row, saved: row?.localSync?.status === 'linked' });
    } catch { this.setData({ locked: true, errorMessage: '本机记录读取失败，暂不能修改或保存此局。' }); }
  },
  onNode(event: WechatMiniprogram.CustomEvent<{ id: string }>) {
    this.refreshLock();
    if (!this.controller || this.data.saving || this.data.locked) return;
    this.controller.tap(event.detail.id); this.persistDraft(); this.render();
  },
  resign() {
    this.refreshLock();
    if (!this.controller || this.data.saving || this.data.locked) return;
    this.controller.resign(); this.persistDraft(); this.render();
  },
  restart() {
    if (this.data.saving) return;
    if (this.controller) {
      try {
        if (createWxDeviceHistoryStore().get(this.controller.id)?.localSync?.status === 'pending') {
          this.setData({ errorMessage: '保存结果待确认，请先重试保存，再开始新试玩。' }); return;
        }
      } catch { this.setData({ errorMessage: '本机记录读取失败，暂不能重新开始。' }); return; }
    }
    this.controller = new TrialController();
    this.setData({ locked: false, saved: false, errorMessage: '' });
    this.persistDraft(); this.render();
  },
  async save() {
    if (!this.controller || this.data.saving || this.data.saved || this.data.turns === 0) return;
    if (!this.persistDraft()) return;
    if (!hasWechatSession()) { showLogin(saveRoute); return; }
    const controller = this.controller;
    this.setData({ saving: true, errorMessage: '' });
    try {
      const store = createWxDeviceHistoryStore();
      const previous = store.get(controller.id);
      if (previous && JSON.stringify(previous.localScore) !== JSON.stringify(controller.draft.score)) {
        throw new Error('试玩与保存的棋谱不一致，请保留记录并从历史重试。');
      }
      if (!previous) {
        const session = controller.session;
        store.record({ id: controller.id, mode: 'local', state: session.gameState,
          turns: session.score!.moves.length, lastMove: session.lastMove,
          localUndoFrame: session.undoFrame, localScore: session.score });
      }
      if (!this.disposed) this.setData({ locked: true });
      await syncLocalScore(controller.id, { store });
      // A later trial opened elsewhere must not be removed by this response.
      try { if (wx.getStorageSync(draftKey)?.id === controller.id) wx.removeStorageSync(draftKey); } catch { /* linked history protects the saved draft */ }
      if (!this.disposed && this.controller === controller) this.setData({ saved: true, locked: true });
    } catch (error) {
      if (!this.disposed && this.controller === controller) this.setData({ errorMessage: error instanceof ApiError
        ? messageForApiError(error) : error instanceof Error && /[\u4e00-\u9fff]/.test(error.message)
          ? error.message : '保存失败，棋谱已保留，请重试。' });
    } finally {
      if (!this.disposed && this.controller === controller) { this.setData({ saving: false }); this.refreshLock(); }
    }
  },
  openHistory() { openPage('/pages/history/history'); },
  online() { openPage('/pages/online/online'); },
  openTutorial() { openPage('/guide/pages/tutorial/tutorial'); },
  back() { backHome(); },
});
