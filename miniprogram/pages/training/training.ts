import { createApiClient } from '../../services/api-client';
import { createTrainingApi } from '../../services/training-api';
import type { BoardState } from '../../types/domain';
import { boardLines, boardNodes } from '../../mock/game';
import { backHome } from '../../utils/navigation';
import { mapGameStateToView } from '../game/game-state-mapper';
import { TrainingController } from './training-controller';
import type { TrainingSnapshot } from './training-controller';
import type { TrainingFilters } from '../../services/training-api';

const emptyBoard: BoardState = { nodes: boardNodes, lines: boardLines, pieces: [] };
const difficultyLabels = { EASY: '简易', NORMAL: '一般', COMPLEX: '复杂', UNCALIBRATED: '待校准' };

Page({
  data: {
    items: [] as { id: string; title: string; sourceText: string; difficultyText: string;
      progressText: string; tagsText: string }[],
    sourceOptions: ['精选残局', '我的复盘'], sourceIndex: 0,
    categoryOptions: ['全部类别', '失误', '严重失误'], categoryIndex: 0,
    difficultyOptions: ['全部难度', '简易', '一般', '复杂', '待校准'], difficultyIndex: 0,
    completedOptions: ['全部进度', '未完成', '已完成'], completedIndex: 0,
    gameId: '', noticeMessage: null as string | null,
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
  },
  controller: null as TrainingController | null,
  onLoad(options: { source?: string; gameId?: string }) {
    this.controller = new TrainingController(createTrainingApi(createApiClient()),
      snapshot => this.render(snapshot));
    this.render(this.controller.snapshot);
    const source = options?.source === 'REVIEW' ? 'REVIEW' : 'CURATED';
    this.setData({ sourceIndex: source === 'REVIEW' ? 1 : 0, gameId: options?.gameId || '' });
    void this.controller.setFilters({ source, ...(source === 'REVIEW' && options?.gameId
      ? { source_game_id: options.gameId } : {}) });
  },
  onUnload() { this.controller?.dispose(); this.controller = null; },
  render(snapshot: TrainingSnapshot) {
    const question = snapshot.question;
    const answer = snapshot.answer;
    const view = question ? mapGameStateToView(question.stateSnapshot, {
      selectedNode: snapshot.selectedNode, legalTargets: snapshot.legalTargets,
      lastMove: answer?.submittedMove ?? null,
    }) : null;
    this.setData({
      items: snapshot.items.map(item => ({ id: item.id, title: item.title,
        sourceText: item.sourceKind === 'CURATED' ? `精选残局 · 题库 v${item.catalogVersion}`
          : `复盘第 ${item.sourceTurn} 手 · ${item.sourceCategory === 'BLUNDER' ? '严重失误' : '失误'}`,
        difficultyText: `${difficultyLabels[item.difficultyTag]}${item.difficultyBasis ? '（引擎估计）' : ''}`,
        progressText: `${item.progress.completed ? '已完成' : '未完成'} · 已答 ${item.progress.attemptCount} 次` +
          (item.progress.latestResult ? ` · 最近${item.progress.latestResult === 'CORRECT' ? '正确' : '尚可改进'}` : ''),
        tagsText: item.trainingTags.join(' · ') })),
      noticeMessage: snapshot.noticeMessage,
      total: snapshot.total, question, answer, board: view?.board ?? emptyBoard,
      selectedNode: snapshot.selectedNode, legalTargets: snapshot.legalTargets,
      isLoading: snapshot.isLoading, isLoadingLegalMoves: snapshot.isLoadingLegalMoves,
      isLoadingMore: snapshot.isLoadingMore,
      isSubmittingAnswer: snapshot.isSubmittingAnswer, errorMessage: snapshot.errorMessage,
      resultText: answer?.result === 'CORRECT' ? '达到最佳评分' : '还有更优走法',
      bestMoveText: answer ? `${answer.bestMove.from} → ${answer.bestMove.to}` : '',
      submittedMoveText: answer
        ? `${answer.submittedMove.from} → ${answer.submittedMove.to}` : '',
    });
  },
  changeFilter(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const key = event.currentTarget.dataset.filter as 'sourceIndex' | 'categoryIndex' | 'difficultyIndex' | 'completedIndex';
    const value = Number(event.detail.value);
    this.setData({ [key]: value });
    if (key === 'sourceIndex') this.setData({ categoryIndex: 0, gameId: '' });
    this.applyFilters();
  },
  clearGameFilter() { this.setData({ gameId: '' }); this.applyFilters(); },
  applyFilters() {
    const source = this.data.sourceIndex === 1 ? 'REVIEW' : 'CURATED';
    const category = [undefined, 'MISTAKE', 'BLUNDER'][this.data.categoryIndex] as TrainingFilters['category'];
    const difficulty = [undefined, 'EASY', 'NORMAL', 'COMPLEX', 'UNCALIBRATED'][this.data.difficultyIndex] as TrainingFilters['difficulty'];
    const completed = [undefined, false, true][this.data.completedIndex];
    void this.controller?.setFilters({ source, ...(source === 'REVIEW' && category ? { category } : {}),
      ...(difficulty ? { difficulty } : {}), ...(completed !== undefined ? { completed } : {}),
      ...(source === 'REVIEW' && this.data.gameId ? { source_game_id: this.data.gameId } : {}) });
  },
  back() {
    if (this.data.question) this.controller?.backToList();
    else backHome();
  },
  openQuestion(event: WechatMiniprogram.TouchEvent) {
    const id = event.currentTarget.dataset.id as string;
    if (id) void this.controller?.open(id);
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
