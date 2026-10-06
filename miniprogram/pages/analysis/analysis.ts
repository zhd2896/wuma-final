import { createApiClient } from '../../services/api-client';
import { createWxDeviceHistoryStore } from '../../services/device-history';
import { createGameApi } from '../../services/game-api';
import { createOnlineApi } from '../../services/online-api';
import { restoreOnlineSeat, readOnlineSeat } from '../../services/online-credentials';
import { getSavedWechatToken } from '../../services/device-auth';
import { openPage } from '../../utils/navigation';
import { IndependentAnalysisController } from './analysis-controller';
import type { AnalysisSource, IndependentAnalysisSnapshot } from './analysis-controller';
import type { AnalysisViewModel } from './analysis-view-model';
import { describeMove, highlightBoardMove } from '../../utils/board-guidance';
import type { BoardState } from '../../types/domain';

const activeLocalGameIdKey = 'activeLocalGameId';

Page({
  data: {
    tab: 'evaluation',
    state: 'idle' as IndependentAnalysisSnapshot['state'],
    gameId: '',
    gameVersion: null as number | null,
    seat: null as 'A' | 'B' | null,
    view: null as AnalysisViewModel | null,
    previewBoard: null as BoardState | null,
    routeText: '',
    errorMessage: '',
  },
  controller: null as IndependentAnalysisController | null,
  source: { mode: 'local' } as AnalysisSource,
  hidden: false,
  onLoad(options: { mode?: string; gameId?: string }) {
    this.source = {
      mode: options.mode === 'online' ? 'online' : options.mode === 'remote' ? 'remote' : 'local',
      ...(options.gameId ? { gameId: options.gameId } : {}),
    };
    const history = createWxDeviceHistoryStore();
    const roomApi = createOnlineApi(createApiClient());
    const storage = { read: (key: string) => wx.getStorageSync(key),
      write: (key: string, value: unknown) => wx.setStorageSync(key, value), remove: (key: string) => wx.removeStorageSync(key) };
    this.controller = new IndependentAnalysisController({
      api: createGameApi(createApiClient()),
      restoreOnline: id => restoreOnlineSeat(roomApi, storage, id),
      analyzeOnline: (id, token, version) => roomApi.analyze(id, token, version),
      readIdentity: () => getSavedWechatToken(), readOnlineToken: id => readOnlineSeat(storage, id),
      readLocalGame: id => history.get(id),
      readActiveLocalId: () => {
        const id = wx.getStorageSync(activeLocalGameIdKey);
        return typeof id === 'string' && id ? id : null;
      },
      onChange: snapshot => this.render(snapshot),
    });
    void this.controller.enter(this.source);
  },
  onHide() { this.hidden = true; this.controller?.suspend(); },
  onShow() { if (this.hidden) { this.hidden = false; void this.controller?.enter(this.source); } },
  onUnload() {
    this.controller?.dispose();
    this.controller = null;
  },
  render(snapshot: IndependentAnalysisSnapshot) {
    this.setData({
      state: snapshot.state,
      gameId: snapshot.gameId ?? '',
      gameVersion: snapshot.gameVersion,
      seat: snapshot.seat,
      view: snapshot.view,
      previewBoard: snapshot.view?.board ?? null,
      routeText: snapshot.view?.bestMove ? describeMove(snapshot.view.bestMove.move) : '',
      errorMessage: snapshot.errorMessage,
    });
  },
  selectMove(event: WechatMiniprogram.CustomEvent<{ id: string }>) {
    const view = this.data.view;
    const selected = view?.candidates.find(item => item.id === event.detail.id);
    if (!view || !selected) return;
    this.setData({ previewBoard: highlightBoardMove(view.board, selected.move),
      routeText: describeMove(selected.move) });
  },
  showBestMove() {
    const view = this.data.view;
    if (!view?.bestMove) return;
    this.setData({ previewBoard: highlightBoardMove(view.board, view.bestMove.move),
      routeText: describeMove(view.bestMove.move) });
  },
  back() { wx.navigateBack({ delta: 1 }); },
  setTab(event: WechatMiniprogram.TouchEvent) {
    this.setData({ tab: event.currentTarget.dataset.tab as string });
  },
  retry() { void this.controller?.retry(); },
  startLocalGame() { openPage('/pages/game/game?mode=local'); },
  openHistory() { openPage('/pages/history/history'); },
});
