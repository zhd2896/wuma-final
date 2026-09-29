import { createApiClient } from '../../services/api-client';
import { createTrainingApi } from '../../services/training-api';
import type { BoardState } from '../../types/domain';
import { boardLines, boardNodes } from '../../mock/game';
import { backHome } from '../../utils/navigation';
import { mapGameStateToView } from '../game/game-state-mapper';
import { TrainingController } from './training-controller';
import type { TrainingSnapshot } from './training-controller';

const emptyBoard: BoardState = { nodes: boardNodes, lines: boardLines, pieces: [] };

Page({
  data: {
    items: [] as { id: string; sourceTurn: number; sourceCategory: string;
      player: string; tagsText: string }[],
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
  onLoad() {
    this.controller = new TrainingController(createTrainingApi(createApiClient()),
      snapshot => this.render(snapshot));
    this.render(this.controller.snapshot);
    void this.controller.enter();
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
      items: snapshot.items.map(item => ({ id: item.id, sourceTurn: item.sourceTurn,
        sourceCategory: item.sourceCategory, player: item.player,
        tagsText: item.trainingTags.join(' · ') })),
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
