import { NODE_IDS } from '../../domain/index';
import type { Move, NodeId } from '../../domain/index';
import { messageForApiError } from '../../services/api-client';
import type { TrainingAnswerDto, TrainingQuestionDto } from '../../services/api-contract';
import type { TrainingApi } from '../../services/training-api';

export interface TrainingSnapshot {
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
      const list = await this.api.list();
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
      const list = await this.api.list(20, offset);
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
      isLoadingLegalMoves: false, isLoading: true, errorMessage: null });
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
      this.publish({ answer, selectedNode: null, legalTargets: [], isSubmittingAnswer: false });
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.publish({ isSubmittingAnswer: false, errorMessage: messageForApiError(error) });
    }
  }

  async retryQuestion(): Promise<void> {
    if (this.state.question) await this.open(this.state.question.id);
  }

  async next(): Promise<void> {
    const index = this.state.items.findIndex(item => item.id === this.state.question?.id);
    if (index === this.state.items.length - 1 && this.state.items.length < this.state.total) {
      await this.loadMore();
    }
    if (index >= 0 && index + 1 < this.state.items.length) await this.open(this.state.items[index + 1].id);
    else if (this.state.items.length >= this.state.total) this.backToList();
  }

  backToList(): void {
    if (this.state.isSubmittingAnswer) return;
    this.generation++;
    this.legalGeneration++;
    this.pending = null;
    this.publish({ question: null, answer: null, selectedNode: null, legalTargets: [],
      isLoading: false, isLoadingLegalMoves: false, errorMessage: null });
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.legalGeneration++;
  }
}
