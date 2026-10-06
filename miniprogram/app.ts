import { hasWechatSession } from './services/device-auth';
import { getApiBaseUrl } from './config/api';
import { isPublicRoute, routeWithQuery, showLogin } from './services/auth-navigation';

App({
  onShow(options) {
    const pages = getCurrentPages();
    const current = pages[pages.length - 1];
    const route = current?.route || options.path || 'pages/index/index';
    if (isPublicRoute(route) || route === 'pages/login/login') return;
    try { getApiBaseUrl(); } catch { showLogin(); return; }
    if (hasWechatSession()) return;
    if (current?.route === 'pages/login/login' || (!current && options.path === 'pages/login/login')) return;
    showLogin(current ? routeWithQuery(current.route, current.options)
      : routeWithQuery(options.path || 'pages/index/index', options.query));
  },
});
