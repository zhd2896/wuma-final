import { createGameApi } from '../../services/game-api';
import { ApiError, createApiClient, messageForApiError } from '../../services/api-client';
import { getApiBaseUrl } from '../../config/api';
import { getSavedWechatToken } from '../../services/device-auth';
import { createWxDeviceHistoryStore } from '../../services/device-history';
import { mapGameStateToView } from '../game/game-state-mapper';
import type { GameState } from '../../domain/index';
import { createLocalGameSession, tapLocalGameNode } from '../game/local-game';
import type { BoardState } from '../../types/domain';
import { openPage, backHome } from '../../utils/navigation';
import { describeMove } from '../../utils/board-guidance';
Page({
  data: { state: 'loading', error: '', board: null as BoardState | null, index: 0, max: 0, note: '' },
  frames: [] as { state: GameState; note: string }[], generation: 0,
  reloadOnShow: false,
  recordOptions: {} as { localId?: string; gameId?: string },
  onLoad(options: { localId?: string; gameId?: string }) { this.recordOptions = options; void this.load(); },
  onHide() { this.generation++; this.frames = []; this.reloadOnShow = true; this.setData({ state: 'loading', board: null, note: '' }); },
  onShow() { if (this.reloadOnShow) { this.reloadOnShow = false; void this.load(); } },
  onUnload() { this.generation++; },
  context() {
    if (!this.recordOptions.gameId) return 'local';
    try { const root = getApiBaseUrl(); return `${root}:${getSavedWechatToken(root) ?? ''}`; } catch { return ''; }
  },
  changedContext() {
    this.frames = [];
    this.setData({ state: 'error', board: null, note: '', error: '登录状态或服务地址已变化，请重新读取棋谱。' });
  },
  async load() {
    const generation = ++this.generation; this.setData({ state: 'loading', error: '' });
    const context = this.context();
    try {
      const frames: typeof this.frames = [];
      if (this.recordOptions.localId) {
        const row = createWxDeviceHistoryStore().get(this.recordOptions.localId);
        if (!row?.localScore) throw new Error('本机棋谱不完整，请从历史重试保存后查看云端棋谱。');
        let session = createLocalGameSession(row.localScore.firstPlayer); frames.push({ state: session.gameState, note: '初始局面' });
        row.localScore.moves.forEach((move, i) => {
          const turn = tapLocalGameNode(tapLocalGameNode(session, move.from).session, move.to);
          if (!turn.turn) throw new Error('棋谱无法回放，请保留记录并重试。');
          session = turn.session; frames.push({ state: session.gameState, note: `第 ${i + 1} 手 · ${describeMove(move)}` });
        });
        if (row.status === 'FINISHED' && row.localState && row.winnerReason === 'RESIGN')
          frames.push({ state: row.localState, note: '终局 · 你认输，电脑获胜' });
      } else if (this.recordOptions.gameId) {
        const replay = await createGameApi(createApiClient()).getReplay(this.recordOptions.gameId);
        frames.push({ state: replay.initial_state, note: '初始局面' });
        replay.steps.forEach(step => frames.push({ state: step.state, note: step.kind === 'MOVE'
          ? `第 ${step.ply} 手 · ${describeMove(step.move)}` : '认输终局' }));
      } else throw new Error('没有找到要查看的棋谱。');
      if (generation !== this.generation) return;
      if (context !== this.context()) { this.changedContext(); return; }
      this.frames = frames; this.setData({ state: 'success', max: frames.length - 1 }); this.showFrame(0);
    } catch (error) {
      if (generation !== this.generation) return;
      if (context !== this.context()) { this.changedContext(); return; }
      this.setData({ state: 'error', error: error instanceof Error && !(error instanceof ApiError) && /[\u4e00-\u9fff]/.test(error.message)
        ? error.message : messageForApiError(error) });
    }
  },
  showFrame(index: number) {
    index = Math.max(0, Math.min(this.frames.length - 1, index)); const frame = this.frames[index];
    if (frame) this.setData({ index, board: mapGameStateToView(frame.state).board, note: frame.note });
  },
  previous() { this.showFrame(this.data.index - 1); }, next() { this.showFrame(this.data.index + 1); },
  jump(event: WechatMiniprogram.CustomEvent<{ value: number }>) { this.showFrame(Number(event.detail.value)); },
  startAi() { openPage('/pages/game/game?mode=ai&level=BEGINNER&first=human&new=1'); },
  back() { wx.navigateBack({ delta: 1, fail: backHome }); },
  retry() {
    if (this.recordOptions.gameId) {
      try {
        if (!getSavedWechatToken(getApiBaseUrl())) {
          openPage(`/pages/record/record?gameId=${encodeURIComponent(this.recordOptions.gameId)}`); return;
        }
      } catch { /* load presents the configuration error with retry. */ }
    }
    void this.load();
  },
});
