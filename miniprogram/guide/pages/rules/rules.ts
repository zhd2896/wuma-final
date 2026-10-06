import { hasWechatSession } from '../../../services/device-auth';
import { showLogin } from '../../../services/auth-navigation';

const rulesImage = '/guide/assets/wuma-rules.png';
const nodeImage = '/guide/assets/wuma-node-reference.png';

Page({
  data: { imageFailed: false },
  openTutorial() { wx.navigateTo({ url: '/guide/pages/tutorial/tutorial' }); },
  previewing: false,
  back() {
    wx.navigateBack({
      delta: 1,
      fail: () => {
        if (hasWechatSession()) wx.reLaunch({ url: '/pages/index/index' });
        else showLogin('/pages/index/index');
      },
    });
  },
  preview() {
    if (this.data.imageFailed) return;
    this.previewAsset(rulesImage);
  },
  previewNodes() { this.previewAsset(nodeImage); },
  previewAsset(src: string) {
    if (this.previewing) return;
    this.previewing = true;
    wx.getImageInfo({
      src,
      success: result => {
        const imagePath = /^(?:wxfile:|https?:|\/)/.test(result.path)
          ? result.path : `/${result.path}`;
        wx.previewImage({
          current: imagePath,
          urls: [imagePath],
          fail: () => wx.showToast({ title: '图片暂时无法放大，请重试', icon: 'none' }),
        });
      },
      fail: () => wx.showToast({ title: '图示读取失败，请重试', icon: 'none' }),
      complete: () => { this.previewing = false; },
    });
  },
  imageLoaded() { this.setData({ imageFailed: false }); },
  imageError() { this.setData({ imageFailed: true }); },
  startGame() {
    if (hasWechatSession()) wx.navigateTo({ url: '/pages/game/game' });
    else showLogin('/pages/game/game');
  },
});
