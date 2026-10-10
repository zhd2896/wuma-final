import { homeService } from '../../services/index';
import { openPage } from '../../utils/navigation';
import { hasWechatSession } from '../../services/device-auth';
import { showLogin } from '../../services/auth-navigation';
import { readContinueActivities, type ContinueActivity } from '../../services/continue-activity';
Page({
  data: { features: homeService.getFeatures(), loggedIn: false, continuations: [] as ContinueActivity[] },
  onShow() { this.setData({ loggedIn: hasWechatSession(), continuations: readContinueActivities() }); },
  continueActivity(event: WechatMiniprogram.TouchEvent) {
    const continuations = readContinueActivities();
    this.setData({ continuations });
    const card = continuations.find(card => card.id === event.currentTarget.dataset.id);
    if (card) openPage(card.route);
  },
  openTrial() { openPage('/guide/pages/trial/trial'); },
  login() { showLogin('/pages/index/index'); },
  openHistory() { openPage('/pages/history/history'); },
  openRules() { openPage('/guide/pages/rules/rules'); },
  openTutorial() { openPage('/guide/pages/tutorial/tutorial'); },
});
