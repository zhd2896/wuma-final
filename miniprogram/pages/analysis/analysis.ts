import { analysisService, gameService } from '../../services/index';
Page({
  data: { analysis: analysisService.getAnalysis(), board: gameService.getBoard(true), tab: 'evaluation', state: 'success' },
  back() { wx.navigateBack({ delta: 1 }); },
  setTab(event: WechatMiniprogram.TouchEvent) { this.setData({ tab: event.currentTarget.dataset.tab as string }); },
  retry() { this.setData({ state: 'success', analysis: analysisService.getAnalysis() }); }
});
