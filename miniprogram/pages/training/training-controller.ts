import { NODE_IDS } from '../../domain/index';
import type { Move, NodeId } from '../../domain/index';
import { messageForApiError } from '../../services/api-client';
import type { TrainingAnswerDto, TrainingQuestionDto } from '../../services/api-contract';
import type { TrainingApi, TrainingFilters } from '../../services/training-api';

export interface TrainingSnapshot {
  readonly filters: TrainingFilters;
  readonly noticeMessage: string | null;
  readonly items: readonly TrainingQuestionDto[];
  readonly total: number;
  readonly question: TrainingQuestionDto | null;
  readonly selectedNode: NodeId | null;
  readonly legalTargets: readonly NodeId[];
  readonly answer: TrainingAnswerDto | null;
  readonly isLoading: boolean;
  readonly isLoadingMore: boolean;
  readonly isLoadingLegalMoves: boolean;
  readonly isSubmittingAnswer: boolean;
  readonly errorMessage: string | null;
}

const initial: TrainingSnapshot = {
  filters: { source: 'CURATED' }, noticeMessage: null,
  items: [], total: 0, question: null, selectedNode: null, legalTargets: [],
  answer: null, isLoading: false, isLoadingMore: false, isLoadingLegalMoves: false,
  isSubmittingAnswer: false, errorMessage: null,
};

function attemptId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export class TrainingController {
  private readonly api: TrainingApi;
  private readonly onChange: (snapshot: TrainingSnapshot) => void;
  private readonly makeAttemptId: () => string;
  private state: TrainingSnapshot = initial;
  private disposed = false;
  private generation = 0;
  private legalGeneration = 0;
  private pending: { move: Move; id: string } | null = null;

  constructor(
    api: TrainingApi,
    onChange: (snapshot: TrainingSnapshot) => void,
    makeAttemptId: () => string = attemptId,
  ) {
    this.api = api;
    this.onChange = onChange;
    this.makeAttemptId = makeAttemptId;
  }

  get snapshot(): TrainingSnapshot { return this.state; }

  async setFilters(filters: TrainingFilters): Promise<void> {
    if (this.disposed || this.state.isSubmittingAnswer) return;
    this.generation++;
    this.legalGeneration++;
    this.pending = null;
    const { source_game_id, player, category, ...common } = filters;
    this.publish({ ...initial, filters: filters.source === 'CURATED' ? common : { ...common,
      ...(source_game_id ? { source_game_id } : {}), ...(player ? { player } : {}), ...(category ? { category } : {}) } });
    await this.enter();
  }

  private publish(patch: Partial<TrainingSnapshot>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  async enter(): Promise<void> {
    if (this.disposed || this.state.isLoading) return;
    const generation = ++this.generation;
    this.publish({ isLoading: true, errorMessage: null });
    try {
      const list = await this.api.list(20, 0, this.state.filters);
      if (this.disposed || generation !== this.generation) return;
      this.publish({ items: list.items, total: list.total, isLoading: false });
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.publish({ isLoading: false, errorMessage: messageForApiError(error) });
    }
  }

  async loadMore(): Promise<void> {
    if (this.disposed || this.state.isLoading || this.state.isLoadingMore ||
        this.state.items.length >= this.state.total) return;
    const generation = this.generation;
    const offset = this.state.items.length;
    this.publish({ isLoadingMore: true, errorMessage: null });
    try {
      const list = await this.api.list(20, offset, this.state.filters);
      if (this.disposed || generation !== this.generation) return;
      const seen = new Set(this.state.items.map(item => item.id));
      this.publish({ items: [...this.state.items, ...list.items.filter(item => !seen.has(item.id))],
        total: list.total, isLoadingMore: false });
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.publish({ isLoadingMore: false, errorMessage: messageForApiError(error) });
    }
  }

  async open(id: string): Promise<void> {
    if (this.disposed || this.state.isSubmittingAnswer) return;
    const generation = ++this.generation;
    this.legalGeneration++;
    this.pending = null;
    this.publish({ question: null, answer: null, selectedNode: null, legalTargets: [],
      isLoadingLegalMoves: false, isLoadingMore: false, isLoading: true, errorMessage: null });
    try {
      const question = await this.api.get(id);
      if (this.disposed || generation !== this.generation) return;
      this.publish({ question, isLoading: false });
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.publish({ isLoading: false, errorMessage: messageForApiError(error) });
    }
  }

  async tapNode(id: string): Promise<void> {
    const question = this.state.question;
    if (this.disposed || !question || this.state.isLoading || this.state.isSubmittingAnswer ||
        this.state.answer || this.pending || !NODE_IDS.includes(id as NodeId)) return;
    const node = id as NodeId;
    if (question.stateSnapshot.board.occupancy[node] === question.player) {
      const generation = ++this.legalGeneration;
      this.publish({ selectedNode: node, legalTargets: [], isLoadingLegalMoves: true,
        errorMessage: null });
      try {
        const response = await this.api.legalMoves(question.id, node);
        if (this.disposed || generation !== this.legalGeneration ||
            this.state.question?.id !== question.id) return;
        this.publish({ legalTargets: response.moves.filter(move => move.from === node)
          .map(move => move.to), isLoadingLegalMoves: false });
      } catch (error) {
        if (this.disposed || generation !== this.legalGeneration) return;
        this.publish({ legalTargets: [], isLoadingLegalMoves: false,
          errorMessage: messageForApiError(error) });
      }
    } else if (this.state.selectedNode && this.state.legalTargets.includes(node)) {
      this.pending = { move: { from: this.state.selectedNode, to: node }, id: this.makeAttemptId() };
      await this.submitPending();
    }
  }

  async retryAnswer(): Promise<void> {
    if (this.pending && !this.state.isSubmittingAnswer) await this.submitPending();
  }

  async retry(): Promise<void> {
    if (this.pending) await this.retryAnswer();
    else if (this.state.question && this.state.selectedNode) {
      await this.tapNode(this.state.selectedNode);
    } else if (this.state.question) await this.retryQuestion();
    else if (this.state.items.length && this.state.items.length < this.state.total) {
      await this.loadMore();
    } else await this.enter();
  }

  private async submitPending(): Promise<void> {
    const question = this.state.question;
    const pending = this.pending;
    if (!question || !pending || this.state.isSubmittingAnswer) return;
    const generation = this.generation;
    this.legalGeneration++;
    this.publish({ isSubmittingAnswer: true, isLoadingLegalMoves: false, errorMessage: null });
    try {
      const answer = await this.api.answer(question.id, pending.move, pending.id);
      if (this.disposed || generation !== this.generation ||
          this.state.question?.id !== question.id) return;
      this.pending = null;
      const progress = { attemptCount: (question.progress?.attemptCount ?? 0) + 1,
        latestResult: answer.result,
        completed: question.progress?.completed === true || answer.result === 'CORRECT' };
      const updatedQuestion = { ...question, progress };
      let items = this.state.items.map(item => item.id === question.id ? updatedQuestion : item);
      let total = this.state.total;
      if (this.state.filters.completed === false && progress.completed) {
        total -= items.some(item => item.id === question.id) ? 1 : 0;
        items = items.filter(item => item.id !== question.id);
      }
      this.publish({ answer, question: updatedQuestion, items, total,
        selectedNode: null, legalTargets: [], isSubmittingAnswer: false });
      if (question.difficultyCalibration) void this.refreshCalibration(question.id, generation);
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.publish({ isSubmittingAnswer: false, errorMessage: messageForApiError(error) });
    }
  }

  private async refreshCalibration(id: string, generation: number): Promise<void> {
    try {
      const fresh = await this.api.get(id);
      if (this.disposed || generation !== this.generation || this.state.question?.id !== id) return;
      const question = { ...this.state.question, difficultyCalibration: fresh.difficultyCalibration };
      this.publish({ question, items: this.state.items.map(item => item.id === id
        ? { ...item, difficultyCalibration: fresh.difficultyCalibration } : item) });
    } catch { /* A supplementary read never invalidates a successfully graded answer. */ }
  }

  async retryQuestion(): Promise<void> {
    if (this.state.question) await this.open(this.state.question.id);
  }

  async next(): Promise<void> {
    if (this.disposed || this.state.isLoading || this.state.isLoadingMore || this.state.isSubmittingAnswer) return;
    const generation = this.generation;
    const currentId = this.state.question?.id;
    let index = this.state.items.findIndex(item => item.id === this.state.question?.id);
    while (true) {
      const candidate = this.state.items.slice(index + 1).find(item => !item.progress?.completed);
      if (candidate) { await this.open(candidate.id); return; }
      if (this.state.items.length >= this.state.total) {
        const earlier = this.state.items.find(item => item.id !== currentId && !item.progress?.completed);
        if (earlier) { await this.open(earlier.id); return; }
        this.backToList();
        this.publish({ noticeMessage: '暂无其他未完成题，可切换筛选或再练已完成题。' });
        return;
      }
      index = this.state.items.length - 1;
      await this.loadMore();
      if (this.disposed || generation !== this.generation || this.state.errorMessage) return;
      if (index === this.state.items.length - 1 && this.state.items.length < this.state.total) {
        this.publish({ errorMessage: '题目列表未更新，请重试。' }); return;
      }
    }
  }

  backToList(): void {
    if (this.state.isSubmittingAnswer) return;
    this.generation++;
    this.legalGeneration++;
    this.pending = null;
    this.publish({ question: null, answer: null, selectedNode: null, legalTargets: [],
      isLoading: false, isLoadingMore: false, isLoadingLegalMoves: false, errorMessage: null });
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.legalGeneration++;
  }
}
