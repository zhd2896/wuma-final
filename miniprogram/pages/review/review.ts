import { createApiClient, ApiError, messageForApiError } from '../../services/api-client';
import { createOnlineApi } from '../../services/online-api';
import { restoreOnlineSeat, readOnlineSeat } from '../../services/online-credentials';
import { createGameApi } from '../../services/game-api';
import { requireReviewContext } from '../../services/replay-contract';
import { createTrainingApi } from '../../services/training-api';
import { hasWechatSession, getSavedWechatToken } from '../../services/device-auth';
import { showLogin } from '../../services/auth-navigation';
import type { GameExplanationDto, GameReviewDto, GameReplayDto, TrainingListDto } from '../../services/api-contract';
import type { GameApi } from '../../services/game-api';
import type { Player } from '../../domain/index';
import type { BoardState } from '../../types/domain';
import { mapGameStateToView } from '../game/game-state-mapper';
import { describeMove, highlightBoardMove } from '../../utils/board-guidance';
import { replayView } from './review-replay';
import { keyReviewMoments, reviewCategoryText, reviewReason, ruleReasonText, translateFeedback } from '../../services/feedback-presentation';

type ReviewRow = GameReviewDto['moveReviews'][number] & {
  actualText: string; bestText: string; actualLocationText: string; bestLocationText: string;
  naturalExplanation: string; naturalSuggestion: string; explanationFallbackUsed: boolean;
  categoryText: string; reasonText: string;
};

Page({
  data: {
    gameId: '', mode: '', state: 'loading', errorMessage: '', terminalText: '',
    reviewedPlayer: 'A' as Player, perspectiveOptions: ['黑方', '红方'], perspectiveIndex: 0,
    canSelectPerspective: false,
    review: null as GameReviewDto | null, replay: null as GameReplayDto | null,
    bestMoveRateText: '', turningText: '', rows: [] as ReviewRow[],
    keyMoments: [] as ReviewRow[],
    gameExplanation: null as GameExplanationDto | null,
    boardMode: 'replay', reviewBoard: null as BoardState | null, replayBoard: null as BoardState | null,
    replayIndex: 0, replayPly: 0, replayTotalPly: 0, replayMaxIndex: 0, replayCurrentPlayer: 'A' as Player,
    replayReserveA: 0, replayReserveB: 0, replayVersion: 0, replayStepText: '', replayCaptureText: '',
    replayExplanation: '', replayNaturalExplanation: '', replayRowTurn: 0,
    selectedTurn: 0, selectedRoute: 'actual', routeText: '', previewReserveA: 0, previewReserveB: 0,
    explanationState: 'idle', isGeneratingExplanation: false, isGeneratingTraining: false, trainingError: '', trainingNotice: '',
  },
  learningApi: null as Pick<GameApi, 'getReviewExplanation' | 'explainReview'> | null,
  generateOnlineTraining: null as (() => Promise<TrainingListDto>) | null,
  accountIdentity: null as string | null, remoteToken: null as string | null,
  active: true, unloaded: false, generation: 0, explanationGeneration: 0,
  onLoad(options: { gameId?: string; mode?: string }) {
    this.active = true; this.unloaded = false;
    this.setData({ gameId: options.gameId ?? '', mode: options.mode === 'online' ? 'online' : '' });
    void this.load(options.gameId ?? '');
  },
  onHide() { this.active = false; this.generation++; this.explanationGeneration++; },
  onUnload() { this.unloaded = true; this.onHide(); },
  onShow() {
    if (!this.unloaded && !this.active) { this.active = true; void this.load(this.data.gameId, this.data.reviewedPlayer); }
  },
  isCurrent(generation: number) {
    if (!this.active || this.unloaded || generation !== this.generation) return false;
    if (getSavedWechatToken() !== this.accountIdentity ||
        (this.data.mode === 'online' && this.remoteToken && readOnlineSeat({
          read: key => wx.getStorageSync(key), write: () => {}, remove: () => {} }, this.data.gameId) !== this.remoteToken)) {
      this.generation++; this.explanationGeneration++;
      this.learningApi = null; this.generateOnlineTraining = null;
      this.setData({ state: 'error', errorMessage: '账号或席位已变化，请重新读取复盘', review: null,
        replay: null, rows: [], keyMoments: [], gameExplanation: null, reviewBoard: null, replayBoard: null,
        explanationState: 'error', isGeneratingExplanation: false, isGeneratingTraining: false,
        canSelectPerspective: false });
      return false;
    }
    return true;
  },
  async load(gameId: string, requestedPlayer?: Player) {
    if (!this.active || this.unloaded) return;
    const generation = ++this.generation; this.explanationGeneration++;
    this.accountIdentity = getSavedWechatToken(); this.remoteToken = null;
    this.learningApi = null; this.generateOnlineTraining = null;
    if (!gameId) { this.setData({ state: 'error', errorMessage: '请从已结束的棋局进入复盘' }); return; }
    this.setData({ gameId, state: 'loading', errorMessage: '', explanationState: 'idle',
      gameExplanation: null, isGeneratingExplanation: false, isGeneratingTraining: false, trainingError: '', trainingNotice: '',
      review: null, replay: null, rows: [], keyMoments: [], terminalText: '', canSelectPerspective: false,
      reviewBoard: null, replayBoard: null, selectedTurn: 0, selectedRoute: 'actual', routeText: '', boardMode: 'replay' });
    try {
      const online = this.data.mode === 'online';
      let player: Player;
      let api: Pick<GameApi, 'getReview' | 'createReview' | 'getReplay'>;
      let localApi: GameApi | undefined;
      let version: number, plyCount: number;
      let finalState;
      if (online) {
        const roomApi = createOnlineApi(createApiClient());
        const { token, room } = await restoreOnlineSeat(roomApi, { read: key => wx.getStorageSync(key),
          write: (key, value) => wx.setStorageSync(key, value), remove: key => wx.removeStorageSync(key) }, gameId);
        if (!this.isCurrent(generation)) return;
        this.remoteToken = token;
        this.learningApi = { getReviewExplanation: id => roomApi.getReviewExplanation(id, token),
          explainReview: id => roomApi.explainReview(id, token) };
        this.generateOnlineTraining = () => roomApi.generateTraining(gameId, token);
        player = room.seat; version = room.version; plyCount = room.ply_count; finalState = room.state;
        api = { getReview: id => roomApi.getReview(id, token), createReview: id => roomApi.createReview(id, token),
          getReplay: id => roomApi.getReplay(id, token) };
      } else {
        localApi = createGameApi(createApiClient());
        this.learningApi = localApi;
        const game = requireReviewContext(await localApi.getGame(gameId), gameId);
        if (!this.isCurrent(generation)) return;
        player = game.mode === 'AI' ? game.human_player! : requestedPlayer ?? this.data.reviewedPlayer;
        version = game.version!; plyCount = game.ply_count; finalState = game.state;
        this.setData({ canSelectPerspective: game.mode === 'LOCAL' });
        api = localApi;
      }
      this.setData({ reviewedPlayer: player, perspectiveIndex: player === 'A' ? 0 : 1 });
      const replay = await api.getReplay(gameId);
      if (!this.isCurrent(generation)) return;
      const savedFinal = replay.steps.length ? replay.steps[replay.steps.length - 1].state : replay.initial_state;
      if (replay.version !== version || replay.ply_count !== plyCount ||
          JSON.stringify(savedFinal) !== JSON.stringify(finalState)) throw new ApiError('INVALID_GAME_RESPONSE', 502);
      let review: GameReviewDto;
      try { review = await api.getReview(gameId, player); }
      catch (error) {
        if (!this.isCurrent(generation)) return;
        if (!(error instanceof ApiError) || error.code !== 'REVIEW_NOT_FOUND') throw error;
        review = await api.createReview(gameId, player);
      }
      if (!this.isCurrent(generation)) return;
      if (review.gameId !== gameId || review.reviewedPlayer !== player ||
          review.winner !== savedFinal.winner || review.winnerReason !== savedFinal.winner_reason)
        throw new ApiError('INVALID_GAME_RESPONSE', 502);
      const terminalText = review.winnerReason === 'RESIGN'
        ? `${review.winner === player ? '对方已认输' : '你已认输'}（${review.winner === 'A' ? '红方' : '黑方'}认输）`
        : `终局 · ${ruleReasonText(review.winnerReason)}`;
      const rows = review.moveReviews.map(move => ({ ...move, engineExplanation: translateFeedback(move.engineExplanation ?? ''),
        actualText: `${move.actualMove.from} → ${move.actualMove.to}`, bestText: `${move.bestMove.from} → ${move.bestMove.to}`,
        actualLocationText: describeMove(move.actualMove), bestLocationText: describeMove(move.bestMove),
        naturalExplanation: '', naturalSuggestion: '', explanationFallbackUsed: false,
        categoryText: move.player === player ? reviewCategoryText(move.category) : '对手走法',
        reasonText: move.player === player ? reviewReason(move) : '对手走法，没有本人评价。',
      }));
      this.setData({ state: 'success', review, replay, rows, keyMoments: keyReviewMoments(rows, player), terminalText,
        bestMoveRateText: `${(review.bestMoveRate * 100).toFixed(1)}%`,
        turningText: review.turningPoints.length ? review.turningPoints.map(turn => `第 ${turn} 手`).join('、') : '无明显失误转折点',
        ...replayView(replay, review, 0) });
      const first = rows.find(row => row.player === player && row.stateBefore);
      if (first) this.showReviewMove(first, 'actual', false);
      if (this.learningApi) await this.loadExplanation(this.learningApi, gameId, generation);
    } catch (error) {
      if (this.isCurrent(generation)) this.setData({ state: 'error', errorMessage: messageForApiError(error), canSelectPerspective: false });
    }
  },
  changePerspective(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (!this.active || this.unloaded || !this.data.canSelectPerspective) return;
    if (event.detail.value !== '0' && event.detail.value !== '1') return;
    const player = event.detail.value === '1' ? 'B' : 'A';
    if (player !== this.data.reviewedPlayer) void this.load(this.data.gameId, player);
  },
  showReplayAt(index: number) {
    if (!this.active || this.unloaded || !this.data.replay || !this.data.review) return;
    const view = replayView(this.data.replay, this.data.review, index);
    const row = this.data.rows.find(r => r.turn === view.replayRowTurn && r.player === this.data.reviewedPlayer);
    this.setData({ ...view, selectedTurn: view.replayComparisonTurn, selectedRoute: 'actual', boardMode: 'replay', replayNaturalExplanation: '',
      replayExplanation: row?.reasonText ?? view.replayExplanation });
  },
  showReplay() { this.showReplayAt(this.data.replayIndex); },
  showSelectedBefore() {
    const row = this.data.rows.find(item => item.turn === this.data.selectedTurn);
    if (row) this.showReviewMove(row, 'before');
  },
  showSelectedBest() {
    const row = this.data.rows.find(item => item.turn === this.data.selectedTurn);
    if (row) this.showReviewMove(row, 'best');
  },
  previousReplay() { this.showReplayAt(this.data.replayIndex - 1); },
  nextReplay() { this.showReplayAt(this.data.replayIndex + 1); },
  startReplay() { this.showReplayAt(0); },
  endReplay() { this.showReplayAt(this.data.replayMaxIndex); },
  jumpReplay(event: WechatMiniprogram.CustomEvent<{ value: number }>) { this.showReplayAt(Number(event.detail.value)); },
  showReviewMove(row: ReviewRow, kind: 'actual' | 'best' | 'before', select = true) {
    if (!row.stateBefore || !this.active || this.unloaded) return;
    const move = kind === 'before' ? null : kind === 'actual' ? row.actualMove : row.bestMove;
    const board = mapGameStateToView(row.stateBefore).board;
    const replayIndex = this.data.replay?.steps.findIndex(step => step.kind === 'MOVE' && step.ply === row.turn);
    const savedView = select && replayIndex !== undefined && replayIndex >= 0 && this.data.replay && this.data.review
      ? replayView(this.data.replay, this.data.review, replayIndex + 1) : {};
    this.setData({ ...savedView, reviewBoard: highlightBoardMove(board, move),
      ...(select ? { boardMode: 'route' } : {}),
      selectedTurn: row.turn, selectedRoute: kind, routeText: move ? describeMove(move) : '',
      previewReserveA: row.stateBefore.players.A.reserve_count, previewReserveB: row.stateBefore.players.B.reserve_count });
  },
  selectReviewMove(event: WechatMiniprogram.TouchEvent) {
    const turn = Number(event.currentTarget.dataset.turn);
    const kind = event.currentTarget.dataset.kind === 'best' ? 'best' : 'actual';
    const row = this.data.rows.find(item => item.turn === turn);
    if (!row?.stateBefore) return;
    this.showReviewMove(row, kind);
    if (typeof wx.pageScrollTo === 'function') wx.pageScrollTo({ selector: '#review-board-panel', duration: 250 });
  },
  openRules() { wx.navigateTo({ url: '/guide/pages/rules/rules' }); },
  async loadExplanation(api: Pick<GameApi, 'getReviewExplanation' | 'explainReview'>, gameId: string, requestGeneration?: number) {
    const generation = requestGeneration ?? this.generation;
    if (!this.data.review || !this.isCurrent(generation)) return;
    const sequence = ++this.explanationGeneration, player = this.data.reviewedPlayer, reviewId = this.data.review.id;
    const current = () => this.isCurrent(generation) && sequence === this.explanationGeneration;
    this.setData({ explanationState: 'loading', isGeneratingExplanation: true });
    try {
      let explained;
      try { explained = await api.getReviewExplanation(gameId, player); }
      catch (error) {
        if (!current()) return;
        if (!(error instanceof ApiError) || error.code !== 'EXPLANATION_NOT_FOUND') throw error;
        explained = await api.explainReview(gameId, player);
      }
      if (!current()) return;
      if (explained.explanation.gameReviewId !== reviewId || explained.review.reviewedPlayer !== player)
        throw new ApiError('INVALID_GAME_RESPONSE', 502);
      const byTurn = new Map(explained.explanation.moveExplanations.map(item => [item.turn, item]));
      const rows = this.data.rows.map(row => {
        const text = row.player === player ? byTurn.get(row.turn) : undefined;
        return { ...row, naturalExplanation: translateFeedback(text?.explanation ?? ''), naturalSuggestion: translateFeedback(text?.suggestion ?? ''),
          reasonText: row.player === player ? reviewReason({ ...row, naturalExplanation: text?.explanation }) : row.reasonText,
          explanationFallbackUsed: text?.fallbackUsed ?? false };
      });
      const overall = explained.explanation.gameExplanation;
      this.setData({ rows, keyMoments: keyReviewMoments(rows, player), gameExplanation: { ...overall,
        overall_summary: translateFeedback(overall.overall_summary ?? ''),
        strengths: (overall.strengths ?? []).map(translateFeedback), main_problems: (overall.main_problems ?? []).map(translateFeedback),
        practice_suggestions: (overall.practice_suggestions ?? []).map(translateFeedback) },
        explanationState: 'success', isGeneratingExplanation: false,
        replayNaturalExplanation: '',
        replayExplanation: rows.find(r => r.turn === this.data.replayRowTurn && r.player === player)?.reasonText ?? this.data.replayExplanation });
    } catch (_error) {
      if (current()) this.setData({ explanationState: 'error', isGeneratingExplanation: false });
    }
  },
  retryExplanation() {
    if (!this.isCurrent(this.generation)) { void this.load(this.data.gameId); return; }
    if (this.learningApi && this.data.gameId && this.data.review)
      void this.loadExplanation(this.learningApi, this.data.gameId);
  },
  retry() { void this.load(this.data.gameId, this.data.reviewedPlayer); },
  async generateTraining() {
    if (!this.isCurrent(this.generation) || !this.data.gameId || !this.data.review || this.data.isGeneratingTraining) return;
    const generation = this.generation, gameId = this.data.gameId, player = this.data.reviewedPlayer;
    this.setData({ isGeneratingTraining: true, trainingError: '', trainingNotice: '' });
    try {
      const result = this.data.mode === 'online'
        ? await this.generateOnlineTraining!()
        : await createTrainingApi(createApiClient()).generate(gameId, player);
      if (!this.isCurrent(generation)) return;
      if (result.total === 0) { this.setData({ trainingNotice: '本方没有需要练习的失误，本局无需生成训练题。' }); return; }
      wx.navigateTo({ url: `/pages/training/training?source=REVIEW&gameId=${encodeURIComponent(gameId)}&player=${player}` });
    } catch (error) {
      if (this.isCurrent(generation)) this.setData({ trainingError: messageForApiError(error) });
    } finally {
      if (this.isCurrent(generation)) this.setData({ isGeneratingTraining: false });
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
