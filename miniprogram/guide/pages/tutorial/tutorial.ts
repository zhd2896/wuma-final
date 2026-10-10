import { TUTORIAL_LESSONS, TutorialController } from '../../tutorial-controller';
import { mapGameStateToView } from '../../../pages/game/game-state-mapper';
import { hasWechatSession } from '../../../services/device-auth';
import { showLogin } from '../../../services/auth-navigation';
import type { BoardState } from '../../../types/domain';

const checkpointKey = 'wuma:tutorial:v2';
const aiRoute = '/pages/game/game?mode=ai&level=BEGINNER&first=human&new=1';

Page({
  data: { stepIndex: 0, stepNumber: 1, title: '', instruction: '', message: '', passed: false,
    completed: false, reserve: 4, startingAi: false, independent: false, needsRetry: false,
    lessonCount: TUTORIAL_LESSONS.length, escapeRoutes: [] as string[], escapeRouteCount: 0,
    beforeEscapeRouteCount: 0, showEscapeRoutes: false, escapeStage: '',
    steps: TUTORIAL_LESSONS.map((lesson, index) => ({ title: lesson.title, index })),
    board: { nodes: [], lines: [], pieces: [] } as BoardState },
  controller: null as TutorialController | null,
  onLoad() {
    let index = 0;
    try {
      const saved = wx.getStorageSync(checkpointKey);
      if (saved && saved.version === 2 && typeof saved.stepIndex === 'number') index = saved.stepIndex;
      else {
        const legacy = wx.getStorageSync('wuma:tutorial:v1');
        if (legacy && legacy.version === 1 && Number.isInteger(legacy.stepIndex) && legacy.stepIndex >= 0)
          index = Math.min(legacy.stepIndex, 3);
      }
    } catch { wx.showToast({ title: '进度读取失败，从第一关开始', icon: 'none' }); }
    this.controller = new TutorialController(index);
    this.render();
  },
  render() {
    if (!this.controller) return;
    const snapshot = this.controller.snapshot;
    const lesson = TUTORIAL_LESSONS[Math.min(snapshot.stepIndex, TUTORIAL_LESSONS.length - 1)];
    const board = mapGameStateToView(snapshot.state, snapshot).board;
    if (!snapshot.passed && !snapshot.completed && lesson.move) {
      board.recommendedFrom = lesson.move.from;
      board.recommendedTo = lesson.move.to;
    }
    const escapeMoves = lesson.goal === 'PARTIAL_BLOCKADE' || lesson.goal === 'TEMPLE_TRAP'
      || lesson.goal === 'ALL_PIECES_IMMOBILIZED' ? snapshot.escapeMoves : [];
    this.setData({ stepIndex: snapshot.stepIndex, stepNumber: snapshot.stepIndex + 1,
      title: lesson.title, instruction: lesson.instruction, message: snapshot.message,
      passed: snapshot.passed, completed: snapshot.completed,
      reserve: snapshot.state.players.A.reserve_count, board, independent: !!lesson.independent,
      needsRetry: !snapshot.passed && !snapshot.completed && snapshot.state.current_player !== 'A',
      showEscapeRoutes: !!lesson.goal && lesson.goal !== 'INSUFFICIENT_RESERVE',
      beforeEscapeRouteCount: snapshot.beforeEscapeMoves.length,
      escapeStage: snapshot.lastMove ? '走后' : '走前',
      escapeRoutes: escapeMoves.map(move => `${move.from} → ${move.to}`),
      escapeRouteCount: escapeMoves.length });
  },
  saveCheckpoint() {
    if (!this.controller) return;
    try { wx.setStorageSync(checkpointKey, { version: 2, stepIndex: this.controller.snapshot.stepIndex }); }
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
