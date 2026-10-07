import type { Move, NodeId } from '../domain/index';
import type { ApiClient } from './api-client';
import type { TrainingAnswerDto, TrainingListDto, TrainingQuestionDto } from './api-contract';

export interface TrainingFilters {
  readonly source: 'REVIEW' | 'CURATED';
  readonly category?: 'MISTAKE' | 'BLUNDER';
  readonly difficulty?: 'UNCALIBRATED' | 'EASY' | 'NORMAL' | 'COMPLEX';
  readonly completed?: boolean;
  readonly source_game_id?: string;
  readonly player?: 'A' | 'B';
  readonly theme?: 'CAPTURE' | 'VULNERABILITY' | 'LONE_PIECE_RISK';
}

export interface TrainingApi {
  list(limit?: number, offset?: number, filters?: TrainingFilters): Promise<TrainingListDto>;
  get(trainingId: string): Promise<TrainingQuestionDto>;
  legalMoves(trainingId: string, fromNode: NodeId): Promise<{ readonly moves: readonly Move[] }>;
  answer(trainingId: string, move: Move, clientAttemptId: string): Promise<TrainingAnswerDto>;
  generate(gameId: string, reviewedPlayer?: 'A' | 'B'): Promise<TrainingListDto>;
}

export function createTrainingApi(client: ApiClient): TrainingApi {
  const base = (id: string) => `/api/v1/training/${encodeURIComponent(id)}`;
  return {
    list: (limit = 20, offset = 0, filters) => client.request('GET',
      `/api/v1/training?limit=${limit}&offset=${offset}` + (filters ? Object.entries(filters)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `&${key}=${encodeURIComponent(String(value))}`).join('') : ''), undefined, 30000),
    get: id => client.request('GET', base(id)),
    legalMoves: (id, from) => client.request('GET',
      `${base(id)}/legal-moves?from_node=${encodeURIComponent(from)}`),
    answer: (id, move, clientAttemptId) => client.request('POST',
      `${base(id)}/answer`, { from_node: move.from, to_node: move.to,
        client_attempt_id: clientAttemptId }, 30000),
    generate: (gameId, reviewedPlayer) => client.request('POST',
      `/api/v1/game/${encodeURIComponent(gameId)}/training`,
      reviewedPlayer ? { reviewed_player: reviewedPlayer } : {}, 30000),
  };
}
