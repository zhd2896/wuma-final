import { coachService } from '../../services/index';
import { openPage, backHome } from '../../utils/navigation';
Page({
  data: { hints: coachService.getHints(), selectedLevel: 0 },
  back() { backHome(); },
  selectHint(event: WechatMiniprogram.CustomEvent<{ level: number }>) { const level = event.detail.level; this.setData({ selectedLevel: this.data.selectedLevel === level ? 0 : level }); },
  openReview() { openPage('/pages/history/history?filter=reviewable'); }
});
