import { createApiClient } from '../../services/api-client';
import { createWxDeviceHistoryStore } from '../../services/device-history';
import { createGameApi } from '../../services/game-api';
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
    view: null as AnalysisViewModel | null,
    previewBoard: null as BoardState | null,
    routeText: '',
    errorMessage: '',
  },
  controller: null as IndependentAnalysisController | null,
  source: { mode: 'local' } as AnalysisSource,
  onLoad(options: { mode?: string; gameId?: string }) {
    this.source = {
      mode: options.mode === 'remote' ? 'remote' : 'local',
      ...(options.gameId ? { gameId: options.gameId } : {}),
    };
    const history = createWxDeviceHistoryStore();
    this.controller = new IndependentAnalysisController({
      api: createGameApi(createApiClient()),
      readLocalGame: id => history.get(id),
      readActiveLocalId: () => {
        const id = wx.getStorageSync(activeLocalGameIdKey);
        return typeof id === 'string' && id ? id : null;
      },
      onChange: snapshot => this.render(snapshot),
    });
    void this.controller.enter(this.source);
  },
  onUnload() {
    this.controller?.dispose();
    this.controller = null;
  },
  render(snapshot: IndependentAnalysisSnapshot) {
    this.setData({
      state: snapshot.state,
      gameId: snapshot.gameId ?? '',
      gameVersion: snapshot.gameVersion,
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
