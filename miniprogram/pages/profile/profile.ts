import { logoutWechat } from '../../services/device-auth';
import { createAccountApi } from '../../services/account-api';
import { createApiClient, messageForApiError } from '../../services/api-client';
import { createWxDeviceHistoryStore } from '../../services/device-history';
import { openPage, backHome } from '../../utils/navigation';
Page({
  data: {
    state: 'loading', errorMessage: '', name: '微信棋手',
    cloudGames: 0, localGames: 0, finishedGames: 0, training: 0, trainingAttempts: 0,
    wins: 0, losses: 0, reviewedGames: 0, remoteGames: 0, remoteWins: 0, remoteLosses: 0,
    accuracy: '数据不足',
  },
  onShow() { void this.load(); },
  async load() {
    this.setData({ state: 'loading', errorMessage: '' });
    try {
      const profile = await createAccountApi(createApiClient()).profile();
      const localGames = createWxDeviceHistoryStore().list().filter(item =>
        item.mode === 'local' || item.mode === 'online').length;
      this.setData({
        state: 'success', name: profile.nickname || '微信棋手',
        cloudGames: profile.games, localGames,
        finishedGames: profile.finishedGames,
        wins: profile.wins, losses: profile.losses,
        remoteGames: profile.remoteGames ?? 0, remoteWins: profile.remoteWins ?? 0, remoteLosses: profile.remoteLosses ?? 0,
        reviewedGames: profile.reviewedGames,
        training: profile.training,
        trainingAttempts: profile.trainingAttempts,
        accuracy: profile.trainingAttempts > 0
          ? `${Math.round(profile.correct / profile.trainingAttempts * 100)}%` : '数据不足',
      });
    } catch (error) {
      this.setData({ state: 'error', errorMessage: messageForApiError(error) });
    }
  },
  logout() {
    logoutWechat();
    wx.reLaunch({ url: '/pages/login/login' });
  },
  retry() { void this.load(); },
  back() { backHome(); },
  openHistory() { openPage('/pages/history/history'); },
  openGame() { openPage('/pages/game/game'); }
});
