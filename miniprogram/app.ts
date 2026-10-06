import { hasWechatSession } from './services/device-auth';
import { getApiBaseUrl } from './config/api';
import { isPublicRoute, routeWithQuery, showLogin } from './services/auth-navigation';

App({
  onShow(options) {
    try { getApiBaseUrl(); } catch { showLogin(); return; }
    if (hasWechatSession()) return;
    const pages = getCurrentPages();
    const current = pages[pages.length - 1];
    if (isPublicRoute(current?.route || options.path || '')) return;
    if (current?.route === 'pages/login/login' || (!current && options.path === 'pages/login/login')) return;
    showLogin(current ? routeWithQuery(current.route, current.options)
      : routeWithQuery(options.path || 'pages/index/index', options.query));
  },
});
