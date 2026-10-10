import { createApiClient } from '../../services/api-client';
import { createTrainingApi } from '../../services/training-api';
import type { BoardState } from '../../types/domain';
import { boardLines, boardNodes } from '../../mock/game';
import { backHome } from '../../utils/navigation';
import { mapGameStateToView } from '../game/game-state-mapper';
import { TrainingController } from './training-controller';
import type { TrainingSnapshot } from './training-controller';
import type { TrainingFilters } from '../../services/training-api';
import { trainingPresentation } from './training-presentation';
import { answerFeedback } from '../../services/feedback-presentation';
import { describeMove, highlightBoardMove } from '../../utils/board-guidance';

type TrainingItemView = { id: string; title: string; sourceText: string; difficultyText: string;
  progressText: string; tagsText: string; calibrationText: string };

const emptyBoard: BoardState = { nodes: boardNodes, lines: boardLines, pieces: [] };

Page({
  data: {
    items: [] as TrainingItemView[], recommendedItem: null as TrainingItemView | null,
    boardPreviewRoute: 'before',
    sourceOptions: ['精选残局', '我的复盘'], sourceIndex: 0,
    categoryOptions: ['全部类别', '失误', '严重失误'], categoryIndex: 0,
    difficultyOptions: ['全部难度', '入门', '进阶', '复杂', '待校准'], difficultyIndex: 0,
    themeOptions: ['全部主题', '吃子', '防守', '孤棋'], themeIndex: 0,
    completedOptions: ['全部进度', '未完成', '已完成'], completedIndex: 0,
    gameId: '', player: '' as '' | 'A' | 'B', noticeMessage: null as string | null,
    total: 0,
    question: null as TrainingSnapshot['question'],
    answer: null as TrainingSnapshot['answer'],
    board: emptyBoard,
    selectedNode: null as TrainingSnapshot['selectedNode'],
    legalTargets: [] as TrainingSnapshot['legalTargets'],
    isLoading: true, isLoadingLegalMoves: false, isSubmittingAnswer: false,
    isLoadingMore: false,
    errorMessage: null as string | null,
    resultText: '', bestMoveText: '', submittedMoveText: '',
    answerReasonText: '', recommendationNote: '',
    questionDifficultyText: '', questionTagsText: '', questionCalibrationText: '',
  },
  controller: null as TrainingController | null,
  onLoad(options: { source?: string; gameId?: string; player?: string; theme?: string; difficulty?: string }) {
    this.controller = new TrainingController(createTrainingApi(createApiClient()),
      snapshot => this.render(snapshot));
    this.render(this.controller.snapshot);
    const source = options?.source === 'REVIEW' ? 'REVIEW' : 'CURATED';
    const player = source === 'REVIEW' && (options?.player === 'A' || options?.player === 'B') ? options.player : '';
    const themeIndex = Math.max(0, ['', 'CAPTURE', 'VULNERABILITY', 'LONE_PIECE_RISK'].indexOf(options?.theme ?? ''));
    const difficultyIndex = Math.max(0, ['', 'EASY', 'NORMAL', 'COMPLEX', 'UNCALIBRATED'].indexOf(options?.difficulty ?? ''));
    this.setData({ themeIndex, difficultyIndex, sourceIndex: source === 'REVIEW' ? 1 : 0, gameId: source === 'REVIEW' ? options?.gameId || '' : '', player });
    this.applyFilters();
  },
  onUnload() { this.controller?.dispose(); this.controller = null; },
  render(snapshot: TrainingSnapshot) {
    const question = snapshot.question;
    const answer = snapshot.answer;
    const feedback = answerFeedback(answer);
    const showFeedback = answer && answer.id !== this.data.answer?.id;
    const sameAnswer = question?.id === this.data.question?.id && answer?.id === this.data.answer?.id;
    const boardPreviewRoute = sameAnswer && answer ? this.data.boardPreviewRoute : 'before';
    const view = question ? mapGameStateToView(question.stateSnapshot, {
      selectedNode: snapshot.selectedNode, legalTargets: snapshot.legalTargets,
      lastMove: null,
    }) : null;
    const items = snapshot.items.map(item => ({ id: item.id, title: item.title,
        sourceText: item.sourceKind === 'CURATED' ? '精选残局'
          : `复盘第 ${item.sourceTurn} 手 · ${item.sourceCategory === 'BLUNDER' ? '严重失误' : '失误'}`,
        ...trainingPresentation(item),
        progressText: `${item.progress.completed ? '已完成' : '未完成'} · 已答 ${item.progress.attemptCount} 次` +
          (item.progress.latestResult ? ` · 最近${item.progress.latestResult === 'CORRECT' ? '正确' : '尚可改进'}` : ''),
        }));
    const recommended = snapshot.items.find(item => !item.progress.completed && item.progress.attemptCount > 0)
      ?? snapshot.items.find(item => !item.progress.completed) ?? snapshot.items[0];
    this.setData({
      items, recommendedItem: items.find(item => item.id === recommended?.id) ?? null, boardPreviewRoute,
      noticeMessage: snapshot.noticeMessage,
      total: snapshot.total, question, answer, board: view ? highlightBoardMove(view.board, answer
        ? boardPreviewRoute === 'mine' ? answer.submittedMove : boardPreviewRoute === 'best' ? answer.bestMove : null : null) : emptyBoard,
      questionDifficultyText: question ? trainingPresentation(question).difficultyText : '',
      questionTagsText: question ? trainingPresentation(question).tagsText : '',
      questionCalibrationText: question ? trainingPresentation(question).calibrationText : '',
      selectedNode: snapshot.selectedNode, legalTargets: snapshot.legalTargets,
      isLoading: snapshot.isLoading, isLoadingLegalMoves: snapshot.isLoadingLegalMoves,
      isLoadingMore: snapshot.isLoadingMore,
      isSubmittingAnswer: snapshot.isSubmittingAnswer, errorMessage: snapshot.errorMessage,
      resultText: feedback.title,
      answerReasonText: feedback.reason, recommendationNote: feedback.recommendationNote,
      bestMoveText: answer ? describeMove(answer.bestMove) : '',
      submittedMoveText: answer
        ? describeMove(answer.submittedMove) : '',
    }, () => {
      if (showFeedback && typeof wx.pageScrollTo === 'function') wx.pageScrollTo({ selector: '#training-feedback', duration: 250 });
    });
  },
  changeFilter(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const key = event.currentTarget.dataset.filter as 'sourceIndex' | 'categoryIndex' | 'difficultyIndex' | 'completedIndex' | 'themeIndex';
    const value = Number(event.detail.value);
    this.setData({ [key]: value });
    if (key === 'sourceIndex') this.setData({ categoryIndex: 0, themeIndex: 0, gameId: '', player: '' });
    this.applyFilters();
  },
  clearGameFilter() { this.setData({ gameId: '', player: '' }); this.applyFilters(); },
  resetFilters() {
    this.setData({ categoryIndex: 0, difficultyIndex: 0, completedIndex: 0, themeIndex: 0, gameId: '', player: '' });
    this.applyFilters();
  },
  applyFilters() {
    const source = this.data.sourceIndex === 1 ? 'REVIEW' : 'CURATED';
    const category = [undefined, 'MISTAKE', 'BLUNDER'][this.data.categoryIndex] as TrainingFilters['category'];
    const difficulty = [undefined, 'EASY', 'NORMAL', 'COMPLEX', 'UNCALIBRATED'][this.data.difficultyIndex] as TrainingFilters['difficulty'];
    const completed = [undefined, false, true][this.data.completedIndex];
    const theme = [undefined, 'CAPTURE', 'VULNERABILITY', 'LONE_PIECE_RISK'][this.data.themeIndex] as TrainingFilters['theme'];
    void this.controller?.setFilters({ source, ...(source === 'REVIEW' && category ? { category } : {}),
      ...(difficulty ? { difficulty } : {}), ...(theme ? { theme } : {}), ...(completed !== undefined ? { completed } : {}),
      ...(source === 'REVIEW' && this.data.gameId ? { source_game_id: this.data.gameId } : {}),
      ...(source === 'REVIEW' && this.data.player ? { player: this.data.player } : {}) });
  },
  back() {
    if (this.data.question) this.controller?.backToList();
    else backHome();
  },
  openQuestion(event: WechatMiniprogram.TouchEvent) {
    const id = event.currentTarget.dataset.id as string;
    if (id) void this.controller?.open(id);
  },
  showAnswerRoute(event: WechatMiniprogram.TouchEvent) {
    const { question, answer } = this.data;
    if (!question || !answer || !this.controller) return;
    const route = event.currentTarget.dataset.route;
    if (route !== 'mine' && route !== 'best' && route !== 'before') return;
    const board = mapGameStateToView(question.stateSnapshot).board;
    this.setData({ boardPreviewRoute: route,
      board: highlightBoardMove(board, route === 'mine' ? answer.submittedMove : route === 'best' ? answer.bestMove : null) });
  },
  onNode(event: WechatMiniprogram.CustomEvent<{ id: string }>) {
    void this.controller?.tapNode(event.detail.id);
  },
  retry() {
    void this.controller?.retry();
  },
  loadMore() { void this.controller?.loadMore(); },
  retryQuestion() { void this.controller?.retryQuestion(); },
  nextQuestion() { void this.controller?.next(); },
});
