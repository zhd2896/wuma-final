import { logoutWechat } from '../../services/device-auth';
import { createAccountApi } from '../../services/account-api';
import type { SkillProfileDto } from '../../services/account-api';
import { createApiClient, messageForApiError } from '../../services/api-client';
import { createWxDeviceHistoryStore } from '../../services/device-history';
import { openPage, backHome } from '../../utils/navigation';
const emptyProfile = {
  name: '微信棋手', cloudGames: 0, localGames: 0, finishedGames: 0, training: 0, trainingAttempts: 0,
  wins: 0, losses: 0, reviewedGames: 0, remoteGames: 0, remoteWins: 0, remoteLosses: 0,
  accuracy: '数据不足', skillProfile: null as SkillProfileDto | null,
  abilities: [] as { key: string; label: string; hasValue: boolean; valueText: string;
    progress: number; sampleText: string; description: string }[],
};
Page({
  data: {
    state: 'loading', errorMessage: '', ...emptyProfile,
  },
  requestGeneration: 0,
  onShow() { void this.load(); },
  onHide() { this.requestGeneration++; },
  onUnload() { this.requestGeneration++; },
  async load() {
    const generation = ++this.requestGeneration;
    this.setData({ state: 'loading', errorMessage: '', ...emptyProfile });
    try {
      const profile = await createAccountApi(createApiClient()).profile();
      if (generation !== this.requestGeneration) return;
      const localGames = createWxDeviceHistoryStore().list().filter(item =>
        item.mode === 'local' || item.mode === 'online').length;
      this.setData({
        state: 'success', name: profile.nickname,
        cloudGames: profile.games, localGames,
        finishedGames: profile.finishedGames,
        wins: profile.wins, losses: profile.losses,
        remoteGames: profile.remoteGames, remoteWins: profile.remoteWins, remoteLosses: profile.remoteLosses,
        reviewedGames: profile.reviewedGames,
        training: profile.training,
        trainingAttempts: profile.trainingAttempts,
        accuracy: profile.trainingAttempts > 0
          ? `${Math.round(profile.correct / profile.trainingAttempts * 100)}%` : '数据不足',
        skillProfile: profile.skillProfile,
        abilities: profile.skillProfile.metrics.map(metric => ({
          key: metric.key, label: metric.label, hasValue: metric.value !== null,
          valueText: metric.value === null ? '数据不足' : `${metric.value} 分`,
          progress: metric.value === null ? 0 : metric.value,
          sampleText: metric.sampleDetails.map(sample =>
            `${sample.label} ${sample.count}/${sample.minimum} ${sample.unit}`).join(' · '),
          description: metric.description,
        })),
      });
    } catch (error) {
      if (generation !== this.requestGeneration) return;
      this.setData({ state: 'error', errorMessage: messageForApiError(error) });
    }
  },
  logout() {
    this.requestGeneration++;
    this.setData({ state: 'loading', ...emptyProfile });
    logoutWechat();
    wx.reLaunch({ url: '/pages/login/login' });
  },
  retry() { void this.load(); },
  back() { backHome(); },
  openHistory() { openPage('/pages/history/history'); },
  openGame() { openPage('/pages/game/game'); }
});
