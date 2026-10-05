const HOME = '/pages/index/index';
const LOGIN = '/pages/login/login';
let loginNavigationPending: { startedAt: number } | null = null;
const LOGIN_NAVIGATION_TIMEOUT_MS = 3000;
const allowedPages = ['index', 'game', 'analysis', 'review', 'coach', 'training', 'history', 'profile', 'online'];

export function isPublicRoute(value: string): boolean {
  return value.replace(/^\//, '').split('?')[0] === 'guide/pages/rules/rules';
}

export function safeReturnRoute(value?: string): string {
  if (!value || value.length > 2048 || /[\r\n#]/.test(value)) return HOME;
  if (allowedReturnPath(value)) return value;
  // DevTools may deliver an encoded query value to onLoad; decode only that form.
  // Already valid URLs keep their own parameter escaping intact.
  try {
    const decoded = decodeURIComponent(value);
    return !/[\r\n#]/.test(decoded) && allowedReturnPath(decoded) ? decoded : HOME;
  } catch { return HOME; }
}

function allowedReturnPath(value: string): boolean {
  const path = value.split('?')[0];
  return path === '/guide/pages/rules/rules' ||
    allowedPages.some(name => path === `/pages/${name}/${name}`);
}

export function routeWithQuery(path: string, query: Record<string, string | undefined> = {}): string {
  const suffix = Object.keys(query).filter(key => query[key] !== undefined).map(key => `${encodeURIComponent(key)}=${encodeURIComponent(query[key] ?? '')}`).join('&');
  return safeReturnRoute(`/${path.replace(/^\//, '')}${suffix ? '?' + suffix : ''}`);
}

export function showLogin(next?: string): void {
  const pages = getCurrentPages();
  const page = pages[pages.length - 1];
  if (page?.route === LOGIN.slice(1)) return;
  // Some startup navigation attempts never call complete; later entry must recover.
  const elapsed = loginNavigationPending ? Date.now() - loginNavigationPending.startedAt : 0;
  if (loginNavigationPending && elapsed >= 0 && elapsed < LOGIN_NAVIGATION_TIMEOUT_MS) return;
  const route = safeReturnRoute(next ?? (page ? routeWithQuery(page.route, page.options) : HOME));
  const attempt = { startedAt: Date.now() };
  loginNavigationPending = attempt;
  const release = () => {
    if (loginNavigationPending === attempt) loginNavigationPending = null;
  };
  try {
    // Preserve path slashes: this DevTools SDK stalls when they become %2F.
    const next = encodeURIComponent(route).replace(/%2F/gi, '/');
    wx.reLaunch({ url: `${LOGIN}?next=${next}`,
      complete: release });
  } catch (error) {
    release();
    throw error;
  }
}
