import { getDeviceToken, hasWechatSession } from '../../services/device-auth';
import { messageForApiError } from '../../services/api-client';
import { safeReturnRoute } from '../../services/auth-navigation';

Page({
  data: { isLoading: false, errorMessage: '', nextRoute: '/pages/index/index' },
  disposed: false,
  onLoad(options: { next?: string }) {
    this.disposed = false;
    this.setData({ nextRoute: safeReturnRoute(options.next) });
    if (hasWechatSession()) wx.reLaunch({ url: this.data.nextRoute });
  },
  onUnload() { this.disposed = true; },
  openRules() { wx.navigateTo({ url: '/guide/pages/rules/rules' }); },
  async login() {
    if (this.data.isLoading) return;
    this.setData({ isLoading: true, errorMessage: '' });
    try {
      await getDeviceToken();
      if (!this.disposed) wx.reLaunch({ url: this.data.nextRoute });
    } catch (error) {
      if (!this.disposed) this.setData({ errorMessage: messageForApiError(error) });
    } finally {
      if (!this.disposed) this.setData({ isLoading: false });
    }
  },
});
