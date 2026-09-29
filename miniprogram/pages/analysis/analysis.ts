import { createApiClient } from '../../services/api-client';
import { createWxDeviceHistoryStore } from '../../services/device-history';
import { createGameApi } from '../../services/game-api';
import { openPage } from '../../utils/navigation';
import { IndependentAnalysisController } from './analysis-controller';
import type { AnalysisSource, IndependentAnalysisSnapshot } from './analysis-controller';
import type { AnalysisViewModel } from './analysis-view-model';

const activeLocalGameIdKey = 'activeLocalGameId';

Page({
  data: {
    tab: 'evaluation',
    state: 'idle' as IndependentAnalysisSnapshot['state'],
    gameId: '',
    gameVersion: null as number | null,
    view: null as AnalysisViewModel | null,
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
      errorMessage: snapshot.errorMessage,
    });
  },
  back() { wx.navigateBack({ delta: 1 }); },
  setTab(event: WechatMiniprogram.TouchEvent) {
    this.setData({ tab: event.currentTarget.dataset.tab as string });
  },
  retry() { void this.controller?.retry(); },
  startLocalGame() { openPage('/pages/game/game?mode=local'); },
  openHistory() { openPage('/pages/history/history'); },
});
