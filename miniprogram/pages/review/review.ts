import { createApiClient, ApiError, messageForApiError } from '../../services/api-client';
import { createGameApi } from '../../services/game-api';
import { createTrainingApi } from '../../services/training-api';
import type { GameExplanationDto, GameReviewDto } from '../../services/api-contract';
import type { GameApi } from '../../services/game-api';

type ReviewRow = GameReviewDto['moveReviews'][number] & {
  actualText: string;
  bestText: string;
  naturalExplanation: string;
  naturalSuggestion: string;
  explanationFallbackUsed: boolean;
};

Page({
  data: {
    gameId: '', state: 'loading', errorMessage: '',
    review: null as GameReviewDto | null,
    bestMoveRateText: '', turningText: '', rows: [] as ReviewRow[],
    gameExplanation: null as GameExplanationDto | null,
    explanationState: 'idle', isGeneratingExplanation: false,
    isGeneratingTraining: false, trainingError: '',
  },
  onLoad(options: { gameId?: string }) {
    this.setData({ gameId: options.gameId ?? '' });
    void this.load(options.gameId ?? '');
  },
  async load(gameId: string) {
    if (!gameId) {
      this.setData({ state: 'error', errorMessage: '请从已结束的棋局进入复盘' });
      return;
    }
    this.setData({ state: 'loading', errorMessage: '', explanationState: 'idle',
      gameExplanation: null, isGeneratingExplanation: false });
    const api = createGameApi(createApiClient());
    try {
      let review: GameReviewDto;
      try { review = await api.getReview(gameId); }
      catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'REVIEW_NOT_FOUND') throw error;
        review = await api.createReview(gameId);
      }
      const rows = review.moveReviews.map(move => ({ ...move,
        actualText: `${move.actualMove.from} → ${move.actualMove.to}`,
        bestText: `${move.bestMove.from} → ${move.bestMove.to}`,
        naturalExplanation: '', naturalSuggestion: '', explanationFallbackUsed: false,
      }));
      this.setData({ state: 'success', review, rows,
        bestMoveRateText: `${(review.bestMoveRate * 100).toFixed(1)}%`,
        turningText: review.turningPoints.length
          ? review.turningPoints.map(turn => `第 ${turn} 手`).join('、') : '无明显失误转折点',
      });
      await this.loadExplanation(api, gameId);
    } catch (error) {
      this.setData({ state: 'error', errorMessage: messageForApiError(error) });
    }
  },
  async loadExplanation(api: GameApi, gameId: string) {
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
    if (this.data.gameId && this.data.review) {
      void this.loadExplanation(createGameApi(createApiClient()), this.data.gameId);
    }
  },
  retry() { void this.load(this.data.gameId); },
  async generateTraining() {
    if (!this.data.gameId || !this.data.review || this.data.isGeneratingTraining) return;
    this.setData({ isGeneratingTraining: true, trainingError: '' });
    try {
      await createTrainingApi(createApiClient()).generate(this.data.gameId);
      wx.navigateTo({ url: '/pages/training/training' });
    } catch (error) {
      this.setData({ trainingError: messageForApiError(error) });
    } finally {
      this.setData({ isGeneratingTraining: false });
    }
  },
  back() { wx.navigateBack({ delta: 1 }); },
});
