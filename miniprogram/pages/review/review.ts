import { createApiClient, ApiError, messageForApiError } from '../../services/api-client';
import { createOnlineApi } from '../../services/online-api';
import { restoreOnlineSeat } from '../../services/online-credentials';
import { createGameApi } from '../../services/game-api';
import { createTrainingApi } from '../../services/training-api';
import { hasWechatSession } from '../../services/device-auth';
import { showLogin } from '../../services/auth-navigation';
import type { GameExplanationDto, GameReviewDto } from '../../services/api-contract';
import type { GameApi } from '../../services/game-api';
import type { BoardState } from '../../types/domain';
import { mapGameStateToView } from '../game/game-state-mapper';
import { describeMove, highlightBoardMove } from '../../utils/board-guidance';

type ReviewRow = GameReviewDto['moveReviews'][number] & {
  actualText: string;
  bestText: string;
  actualLocationText: string;
  bestLocationText: string;
  naturalExplanation: string;
  naturalSuggestion: string;
  explanationFallbackUsed: boolean;
};

Page({
  data: {
    gameId: '', mode: '', state: 'loading', errorMessage: '', terminalText: '',
    review: null as GameReviewDto | null,
    bestMoveRateText: '', turningText: '', rows: [] as ReviewRow[],
    gameExplanation: null as GameExplanationDto | null,
    reviewBoard: null as BoardState | null,
    selectedTurn: 0, selectedRoute: 'actual', routeText: '',
    previewReserveA: 0, previewReserveB: 0,
    explanationState: 'idle', isGeneratingExplanation: false,
    isGeneratingTraining: false, trainingError: '',
  },
  onLoad(options: { gameId?: string; mode?: string }) {
    this.setData({ gameId: options.gameId ?? '', mode: options.mode === 'online' ? 'online' : '' });
    void this.load(options.gameId ?? '');
  },
  async load(gameId: string) {
    if (!gameId) {
      this.setData({ state: 'error', errorMessage: '请从已结束的棋局进入复盘' });
      return;
    }
    this.setData({ state: 'loading', errorMessage: '', explanationState: 'idle',
      gameExplanation: null, isGeneratingExplanation: false, review: null, rows: [], terminalText: '',
      reviewBoard: null, selectedTurn: 0, selectedRoute: 'actual', routeText: '' });
    try {
      const online = this.data.mode === 'online';
      let seat: 'A' | 'B' | undefined;
      let api: Pick<GameApi, 'getReview' | 'createReview'>;
      let localApi: GameApi | undefined;
      if (online) {
        const roomApi = createOnlineApi(createApiClient());
        const { token, room } = await restoreOnlineSeat(roomApi, { read: key => wx.getStorageSync(key),
          write: (key, value) => wx.setStorageSync(key, value),
          remove: key => wx.removeStorageSync(key) }, gameId);
        seat = room.seat;
        api = { getReview: id => roomApi.getReview(id, token),
          createReview: id => roomApi.createReview(id, token) };
      } else {
        localApi = createGameApi(createApiClient());
        api = localApi;
      }
      let review: GameReviewDto;
      try { review = await api.getReview(gameId); }
      catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'REVIEW_NOT_FOUND') throw error;
        review = await api.createReview(gameId);
      }
      if (online && (review.gameId !== gameId || review.reviewedPlayer !== seat))
        throw new ApiError('INVALID_GAME_RESPONSE', 502);
      const terminalText = review.winnerReason === 'RESIGN'
        ? `${review.winner === review.reviewedPlayer ? '对方已认输' : '你已认输'}（玩家 ${review.winner === 'A' ? 'B' : 'A'} 认输）`
        : `终局 ${review.winnerReason}`;
      const rows = review.moveReviews.map(move => ({ ...move,
        actualText: `${move.actualMove.from} → ${move.actualMove.to}`,
        bestText: `${move.bestMove.from} → ${move.bestMove.to}`,
        actualLocationText: describeMove(move.actualMove),
        bestLocationText: describeMove(move.bestMove),
        naturalExplanation: '', naturalSuggestion: '', explanationFallbackUsed: false,
      }));
      this.setData({ state: 'success', review, rows, terminalText,
        bestMoveRateText: `${(review.bestMoveRate * 100).toFixed(1)}%`,
        turningText: review.turningPoints.length
          ? review.turningPoints.map(turn => `第 ${turn} 手`).join('、') : '无明显失误转折点',
      });
      const first = rows.find(row => row.stateBefore);
      if (first) this.showReviewMove(first, 'actual');
      if (localApi) await this.loadExplanation(localApi, gameId);
    } catch (error) {
      this.setData({ state: 'error', errorMessage: messageForApiError(error) });
    }
  },
  showReviewMove(row: ReviewRow, kind: 'actual' | 'best') {
    if (!row.stateBefore) return;
    const move = kind === 'actual' ? row.actualMove : row.bestMove;
    const board = mapGameStateToView(row.stateBefore).board;
    this.setData({ reviewBoard: highlightBoardMove(board, move),
      selectedTurn: row.turn, selectedRoute: kind, routeText: describeMove(move),
      previewReserveA: row.stateBefore.players.A.reserve_count,
      previewReserveB: row.stateBefore.players.B.reserve_count });
  },
  selectReviewMove(event: WechatMiniprogram.TouchEvent) {
    const turn = Number(event.currentTarget.dataset.turn);
    const kind = event.currentTarget.dataset.kind === 'best' ? 'best' : 'actual';
    const row = this.data.rows.find(item => item.turn === turn);
    if (!row?.stateBefore) return;
    this.showReviewMove(row, kind);
    if (typeof wx.pageScrollTo === 'function') {
      wx.pageScrollTo({ selector: '#review-board-panel', duration: 250 });
    }
  },
  openRules() { wx.navigateTo({ url: '/guide/pages/rules/rules' }); },
  async loadExplanation(api: GameApi, gameId: string) {
    if (this.data.mode === 'online') return;
    this.setData({ explanationState: 'loading', isGeneratingExplanation: true });
    try {
      let explained;
      try { explained = await api.getReviewExplanation(gameId); }
      catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'EXPLANATION_NOT_FOUND') throw error;
        explained = await api.explainReview(gameId);
      }
      if (explained.explanation.gameReviewId !== this.data.review?.id) {
        throw new Error('Explanation and review do not match');
      }
      const byTurn = new Map(explained.explanation.moveExplanations.map(item => [item.turn, item]));
      const rows = this.data.rows.map(row => {
        const text = byTurn.get(row.turn);
        return { ...row, naturalExplanation: text?.explanation ?? '',
          naturalSuggestion: text?.suggestion ?? '',
          explanationFallbackUsed: text?.fallbackUsed ?? false };
      });
      this.setData({ rows, gameExplanation: explained.explanation.gameExplanation,
        explanationState: 'success', isGeneratingExplanation: false });
    } catch (_error) {
      this.setData({ explanationState: 'error', isGeneratingExplanation: false });
    }
  },
  retryExplanation() {
    if (this.data.mode !== 'online' && this.data.gameId && this.data.review) {
      void this.loadExplanation(createGameApi(createApiClient()), this.data.gameId);
    }
  },
  retry() { void this.load(this.data.gameId); },
  async generateTraining() {
    if (this.data.mode === 'online' || !this.data.gameId || !this.data.review || this.data.isGeneratingTraining) return;
    this.setData({ isGeneratingTraining: true, trainingError: '' });
    try {
      await createTrainingApi(createApiClient()).generate(this.data.gameId);
      wx.navigateTo({ url: `/pages/training/training?source=REVIEW&gameId=${encodeURIComponent(this.data.gameId)}` });
    } catch (error) {
      this.setData({ trainingError: messageForApiError(error) });
    } finally {
      this.setData({ isGeneratingTraining: false });
    }
  },
  back() {
    const fallback = () => {
      const route = '/pages/history/history?filter=reviewable';
      if (hasWechatSession()) wx.reLaunch({ url: route });
      else showLogin(route);
    };
    if (getCurrentPages().length <= 1) { fallback(); return; }
    try { wx.navigateBack({ delta: 1, fail: fallback }); }
    catch { fallback(); }
  },
});
