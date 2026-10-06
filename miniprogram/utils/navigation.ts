import { hasWechatSession } from '../services/device-auth';
import { isPublicRoute, showLogin } from '../services/auth-navigation';

function requiresLogin(route: string): boolean {
  if (isPublicRoute(route) || route.split('?')[0] === '/pages/login/login' || hasWechatSession()) return false;
  showLogin(route);
  return true;
}
export function openPage(route: string): void {
  if (!requiresLogin(route)) wx.navigateTo({ url: route });
}
export function openTab(route: string): void {
  if (!requiresLogin(route)) wx.reLaunch({ url: route });
}
export function backHome(): void { wx.reLaunch({ url: '/pages/index/index' }); }
