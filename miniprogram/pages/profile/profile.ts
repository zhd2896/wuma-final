import { profileService } from '../../services/index';
import { openPage, backHome } from '../../utils/navigation';
const labels = ['进攻', '防守', '布局', '残局', '战术', '稳定性'];
const profile = profileService.getProfile();
Page({
  data: { profile, showDemo: false, ratings: (profile.demoRating || []).map((value, index) => ({ label: labels[index], value })) },
  back() { backHome(); },
  toggleDemo() { this.setData({ showDemo: !this.data.showDemo }); },
  openHistory() { openPage('/pages/history/history'); },
  openGame() { openPage('/pages/game/game'); }
});
