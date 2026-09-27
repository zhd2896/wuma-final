export function openPage(route: string): void { wx.navigateTo({ url: route }); }
export function openTab(route: string): void { wx.reLaunch({ url: route }); }
export function backHome(): void { wx.reLaunch({ url: '/pages/index/index' }); }
