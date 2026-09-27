import type { Move, NodeId } from '../domain/index';
import type { ApiClient } from './api-client';
import type { TrainingAnswerDto, TrainingListDto, TrainingQuestionDto } from './api-contract';

export interface TrainingApi {
  list(limit?: number, offset?: number): Promise<TrainingListDto>;
  get(trainingId: string): Promise<TrainingQuestionDto>;
  legalMoves(trainingId: string, fromNode: NodeId): Promise<{ readonly moves: readonly Move[] }>;
  answer(trainingId: string, move: Move, clientAttemptId: string): Promise<TrainingAnswerDto>;
  generate(gameId: string): Promise<TrainingListDto>;
}

export function createTrainingApi(client: ApiClient): TrainingApi {
  const base = (id: string) => `/api/v1/training/${encodeURIComponent(id)}`;
  return {
    list: (limit = 20, offset = 0) => client.request('GET',
      `/api/v1/training?limit=${limit}&offset=${offset}`),
    get: id => client.request('GET', base(id)),
    legalMoves: (id, from) => client.request('GET',
      `${base(id)}/legal-moves?from_node=${encodeURIComponent(from)}`),
    answer: (id, move, clientAttemptId) => client.request('POST',
      `${base(id)}/answer`, { from_node: move.from, to_node: move.to,
        client_attempt_id: clientAttemptId }, 30000),
    generate: gameId => client.request('POST',
      `/api/v1/game/${encodeURIComponent(gameId)}/training`, {}, 30000),
  };
}
