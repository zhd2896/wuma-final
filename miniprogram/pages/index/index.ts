import { homeService } from '../../services/index';
import { openPage } from '../../utils/navigation';
import { hasWechatSession } from '../../services/device-auth';
import { showLogin } from '../../services/auth-navigation';
Page({
  data: { features: homeService.getFeatures(), loggedIn: false },
  onShow() { this.setData({ loggedIn: hasWechatSession() }); },
  openTrial() { openPage('/guide/pages/trial/trial'); },
  login() { showLogin('/pages/index/index'); },
  openHistory() { openPage('/pages/history/history'); },
  openRules() { openPage('/guide/pages/rules/rules'); },
  openTutorial() { openPage('/guide/pages/tutorial/tutorial'); },
});
