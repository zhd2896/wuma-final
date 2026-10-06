import { logoutWechat, getSavedWechatToken } from '../../services/device-auth';
import { getApiBaseUrl } from '../../config/api';
import { PROFILE_AVATARS, isProfileAvatar, validNickname } from '../../services/profile-fields';
import { createAccountApi } from '../../services/account-api';
import type { SkillProfileDto } from '../../services/account-api';
import { createApiClient, messageForApiError } from '../../services/api-client';
import { createWxDeviceHistoryStore } from '../../services/device-history';
import { openPage, backHome } from '../../utils/navigation';
const emptyProfile = {
  name: '', avatar: '', avatarText: '', cloudGames: 0, localGames: 0, finishedGames: 0, training: 0, trainingAttempts: 0,
  wins: 0, losses: 0, reviewedGames: 0, remoteGames: 0, remoteWins: 0, remoteLosses: 0,
  accuracy: '数据不足', skillProfile: null as SkillProfileDto | null,
  abilities: [] as { key: string; label: string; hasValue: boolean; valueText: string;
    progress: number; sampleText: string; description: string }[],
};
Page({
  data: {
    state: 'loading', errorMessage: '', ...emptyProfile,
    editing: false, saving: false, saveError: '', draftNickname: '', draftAvatar: '', avatars: PROFILE_AVATARS,
  },
  requestGeneration: 0,
  onShow() { void this.load(); },
  onHide() { this.requestGeneration++; this.setData({ editing: false, saving: false }); },
  onUnload() { this.requestGeneration++; },
  context() {
    try { const root = getApiBaseUrl(); return `${root}:${getSavedWechatToken(root) ?? ''}`; }
    catch { return ''; }
  },
  async load() {
    const generation = ++this.requestGeneration;
    const context = this.context();
    this.setData({ state: 'loading', errorMessage: '', editing: false, saving: false, ...emptyProfile });
    try {
      const profile = await createAccountApi(createApiClient()).profile();
      if (generation !== this.requestGeneration || context !== this.context()) return;
      const localGames = createWxDeviceHistoryStore().list().filter(item =>
        item.mode === 'local' || item.mode === 'online').length;
      this.setData({
        state: 'success', name: profile.nickname, avatar: profile.avatar,
        avatarText: PROFILE_AVATARS.find(avatar => avatar.id === profile.avatar)!.text,
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
      if (generation !== this.requestGeneration || context !== this.context()) return;
      this.setData({ state: 'error', errorMessage: messageForApiError(error) });
    }
  },
  editProfile() {
    if (this.data.state !== 'success') return;
    this.setData({ editing: true, draftNickname: this.data.name, draftAvatar: this.data.avatar, saveError: '' });
  },
  cancelEdit() { this.requestGeneration++; this.setData({ editing: false, saving: false, saveError: '' }); },
  nicknameInput(event: WechatMiniprogram.Input) { this.setData({ draftNickname: event.detail.value }); },
  selectAvatar(event: WechatMiniprogram.TouchEvent) {
    const avatar = event.currentTarget.dataset.avatar;
    if (isProfileAvatar(avatar)) this.setData({ draftAvatar: avatar });
  },
  async saveProfile() {
    if (!this.data.editing || this.data.saving) return;
    const nickname = this.data.draftNickname.trim();
    const avatar = this.data.draftAvatar;
    if (!validNickname(nickname) || !isProfileAvatar(avatar)) {
      this.setData({ saveError: '昵称须为1至24个字符，不能含控制字符；请选择棋子头像' }); return;
    }
    const generation = ++this.requestGeneration, context = this.context();
    this.setData({ saving: true, saveError: '' });
    try {
      const profile = await createAccountApi(createApiClient()).updateProfile(nickname, avatar);
      if (generation !== this.requestGeneration || context !== this.context()) return;
      this.setData({ name: profile.nickname, avatar: profile.avatar,
        avatarText: PROFILE_AVATARS.find(item => item.id === profile.avatar)!.text, editing: false });
    } catch (error) {
      if (generation === this.requestGeneration && context === this.context())
        this.setData({ saveError: messageForApiError(error) });
    } finally {
      if (generation === this.requestGeneration && context === this.context()) this.setData({ saving: false });
    }
  },
  logout() {
    this.requestGeneration++;
    this.setData({ state: 'loading', editing: false, saving: false, ...emptyProfile });
    logoutWechat();
    wx.reLaunch({ url: '/pages/login/login' });
  },
  retry() { void this.load(); },
  back() { backHome(); },
  openHistory() { openPage('/pages/history/history'); },
  openGame() { openPage('/pages/game/game'); }
});
