import type { WinnerReason } from '../domain/index';
import type { ApiClient } from './api-client';

export interface PersonalGameDto {
  readonly gameId: string;
  readonly mode: 'AI' | 'LOCAL' | 'REMOTE';
  readonly seat?: 'A' | 'B' | null;
  readonly status: 'PLAYING' | 'FINISHED';
  readonly winner: 'A' | 'B' | null;
  readonly winnerReason?: WinnerReason | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly turns: number;
  readonly reviewAvailable: boolean;
}

export interface PersonalProfileDto {
  readonly id: string;
  readonly nickname: string;
  readonly games: number;
  readonly finishedGames: number;
  readonly wins: number;
  readonly losses: number;
  readonly remoteGames: number;
  readonly remoteWins: number;
  readonly remoteLosses: number;
  readonly reviewedGames: number;
  readonly training: number;
  readonly trainingAttempts: number;
  readonly correct: number;
}

export function createAccountApi(client: ApiClient) {
  return {
    profile: () => client.request<PersonalProfileDto>('GET', '/api/v1/me/profile'),
    games: (limit = 20, cursor?: string, status?: 'FINISHED') => client.request<{
      readonly items: PersonalGameDto[]; readonly nextCursor: string | null;
    }>('GET', `/api/v1/me/games?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}` +
      (status ? `&status=${status}` : '')),
  };
}
