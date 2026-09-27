import { historyService } from '../../services/index';
import { openPage } from '../../utils/navigation';
Page({
  data: { records: historyService.getHistory(), state: 'success' },
  back() { wx.navigateBack({ delta: 1 }); },
  showEmpty() { this.setData({ state: this.data.state === 'empty' ? 'success' : 'empty' }); },
  startGame() { openPage('/pages/game/game'); },
  retry() { this.setData({ state: 'success', records: historyService.getHistory() }); },
  openReview(event: WechatMiniprogram.TouchEvent) { openPage('/pages/review/review?id=' + event.currentTarget.dataset.id); }
});
