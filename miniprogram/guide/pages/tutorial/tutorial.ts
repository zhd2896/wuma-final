import { TUTORIAL_LESSONS, TutorialController } from '../../tutorial-controller';
import { mapGameStateToView } from '../../../pages/game/game-state-mapper';
import { hasWechatSession } from '../../../services/device-auth';
import { showLogin } from '../../../services/auth-navigation';
import type { BoardState } from '../../../types/domain';

const checkpointKey = 'wuma:tutorial:v1';
const aiRoute = '/pages/game/game?mode=ai&level=BEGINNER&first=human&new=1';

Page({
  data: { stepIndex: 0, stepNumber: 1, title: '', instruction: '', message: '', passed: false,
    completed: false, reserve: 4, startingAi: false,
    board: { nodes: [], lines: [], pieces: [] } as BoardState },
  controller: null as TutorialController | null,
  onLoad() {
    let index = 0;
    try {
      const saved = wx.getStorageSync(checkpointKey);
      if (saved && saved.version === 1 && typeof saved.stepIndex === 'number') index = saved.stepIndex;
    } catch { wx.showToast({ title: '进度读取失败，从第一关开始', icon: 'none' }); }
    this.controller = new TutorialController(index);
    this.render();
  },
  render() {
    if (!this.controller) return;
    const snapshot = this.controller.snapshot;
    const lesson = TUTORIAL_LESSONS[Math.min(snapshot.stepIndex, 2)];
    const board = mapGameStateToView(snapshot.state, snapshot).board;
    if (!snapshot.passed && !snapshot.completed) {
      board.recommendedFrom = lesson.move.from;
      board.recommendedTo = lesson.move.to;
    }
    this.setData({ stepIndex: snapshot.stepIndex, stepNumber: snapshot.stepIndex + 1,
      title: lesson.title, instruction: lesson.instruction, message: snapshot.message,
      passed: snapshot.passed, completed: snapshot.completed,
      reserve: snapshot.state.players.A.reserve_count, board });
  },
  saveCheckpoint() {
    if (!this.controller) return;
    try { wx.setStorageSync(checkpointKey, { version: 1, stepIndex: this.controller.snapshot.stepIndex }); }
    catch { wx.showToast({ title: '进度保存失败，本次可继续练习', icon: 'none' }); }
  },
  onNode(event: WechatMiniprogram.CustomEvent<{ id: string }>) {
    this.controller?.tap(event.detail.id);
    this.render();
  },
  next() {
    this.controller?.next(); this.saveCheckpoint(); this.render();
  },
  retry() {
    this.controller?.retry(); this.saveCheckpoint(); this.render();
  },
  back() {
    wx.navigateBack({ delta: 1, fail: () => wx.reLaunch({ url: '/guide/pages/rules/rules' }) });
  },
  openTrial() { wx.navigateTo({ url: '/guide/pages/trial/trial' }); },
  startAi() {
    if (!this.controller?.snapshot.completed || this.data.startingAi) return;
    if (!hasWechatSession()) { showLogin(aiRoute); return; }
    this.setData({ startingAi: true });
    wx.navigateTo({ url: aiRoute,
      fail: () => wx.showToast({ title: '暂时无法打开对局，请重试', icon: 'none' }),
      complete: () => this.setData({ startingAi: false }) });
  },
});
