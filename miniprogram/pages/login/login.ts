import { getDeviceToken, hasWechatSession } from '../../services/device-auth';
import { messageForApiError } from '../../services/api-client';
import { safeReturnRoute } from '../../services/auth-navigation';
import { getApiBaseUrl } from '../../config/api';
import { SERVICE_UNOPENED } from '../../config/api-root';

Page({
  data: { isLoading: false, errorMessage: '', nextRoute: '/pages/index/index' },
  disposed: false,
  onLoad(options: { next?: string }) {
    this.disposed = false;
    this.setData({ nextRoute: safeReturnRoute(options.next) });
    try { getApiBaseUrl(); } catch { this.setData({ errorMessage: SERVICE_UNOPENED }); return; }
    if (hasWechatSession()) wx.reLaunch({ url: this.data.nextRoute });
  },
  onUnload() { this.disposed = true; },
  browse() { wx.reLaunch({ url: '/pages/index/index' }); },
  openRules() { wx.navigateTo({ url: '/guide/pages/rules/rules' }); },
  openTutorial() { wx.navigateTo({ url: '/guide/pages/tutorial/tutorial' }); },
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
