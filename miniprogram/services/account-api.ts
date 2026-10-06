import type { AiLevel } from './api-contract';
import type { WinnerReason } from '../domain/index';
import type { ApiClient } from './api-client';
import { ApiError } from './api-client';
import { isProfileAvatar, validNickname } from './profile-fields';
import type { ProfileAvatar } from './profile-fields';

export type SkillMetricKey = 'performance' | 'best_move' | 'decision' | 'stability' | 'mistake_control' | 'training';
export interface SkillSampleDto {
  readonly label: string; readonly count: number; readonly minimum: number;
  readonly unit: '局' | '手' | '次';
}
export interface SkillMetricDto {
  readonly key: SkillMetricKey; readonly label: string; readonly value: number | null;
  readonly sampleCount: number; readonly minimumSample: number; readonly sampleUnit: '局' | '手' | '次';
  readonly sampleDetails: readonly SkillSampleDto[]; readonly description: string;
}
export interface SkillProfileDto {
  readonly version: 'player_skill_v1'; readonly ready: boolean; readonly overall: number | null;
  readonly level: '待评估' | '入门' | '进阶' | '熟练' | '精通' | '卓越';
  readonly seal: '待' | '入' | '进' | '熟' | '精' | '卓';
  readonly metrics: readonly SkillMetricDto[];
  readonly evidence: { readonly aiFinished: number; readonly reviewedGames: number;
    readonly reviewedMoves: number; readonly trainingAttempts: number };
  readonly disclaimer: string;
}

export interface PersonalGameDto {
  readonly gameId: string;
  readonly aiLevel?: AiLevel | null;
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
  readonly avatar: ProfileAvatar;
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
  readonly skillProfile: SkillProfileDto;
}

const metricKeys: readonly SkillMetricKey[] = ['performance', 'best_move', 'decision', 'stability', 'mistake_control', 'training'];
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isScore = (value: unknown) => value === null || (isCount(value) && value <= 100);

/** Reject incomplete API evidence instead of silently rendering fabricated defaults. */
function parseProfile(value: unknown): PersonalProfileDto {
  const invalid = () => { throw new ApiError('INVALID_PROFILE_RESPONSE', 200); };
  if (!isRecord(value) || typeof value.id !== 'string' || !validNickname(value.nickname) || !isProfileAvatar(value.avatar) ||
      !['games', 'finishedGames', 'wins', 'losses', 'remoteGames', 'remoteWins', 'remoteLosses',
        'reviewedGames', 'training', 'trainingAttempts', 'correct'].every(key => isCount(value[key]))) invalid();
  const profile = value as Record<string, unknown>;
  const skill = profile.skillProfile;
  if (!isRecord(skill) || skill.version !== 'player_skill_v1' || typeof skill.ready !== 'boolean' ||
      !isScore(skill.overall) || typeof skill.disclaimer !== 'string' ||
      !['待评估', '入门', '进阶', '熟练', '精通', '卓越'].includes(String(skill.level)) ||
      !['待', '入', '进', '熟', '精', '卓'].includes(String(skill.seal)) ||
      !isRecord(skill.evidence) || !['aiFinished', 'reviewedGames', 'reviewedMoves', 'trainingAttempts']
        .every(key => isCount((skill.evidence as Record<string, unknown>)[key])) ||
      !Array.isArray(skill.metrics) || skill.metrics.length !== 6) invalid();
  const s = skill as Record<string, unknown>;
  const metrics = s.metrics as unknown[];
  metrics.forEach((metric, index) => {
    const review = index > 0 && index < 5;
    const unit = index === 0 ? '局' : index === 5 ? '次' : '手';
    const minimum = review ? 15 : 5;
    if (!isRecord(metric) || metric.key !== metricKeys[index] || typeof metric.label !== 'string' ||
        typeof metric.description !== 'string' || !isScore(metric.value) || !isCount(metric.sampleCount) ||
        metric.minimumSample !== minimum || metric.sampleUnit !== unit || !Array.isArray(metric.sampleDetails) ||
        metric.sampleDetails.length !== (review ? 2 : 1)) invalid();
    const m = metric as Record<string, unknown>;
    (m.sampleDetails as unknown[]).forEach((sample, detailIndex) => {
      if (!isRecord(sample) || typeof sample.label !== 'string' || !isCount(sample.count) ||
          sample.minimum !== (review && detailIndex === 0 ? 3 : minimum) ||
          sample.unit !== (review && detailIndex === 0 ? '局' : unit)) invalid();
    });
  });
  if (s.ready !== metrics.every(metric => (metric as Record<string, unknown>).value !== null) ||
      s.ready !== (s.overall !== null) || (!s.ready && (s.level !== '待评估' || s.seal !== '待'))) invalid();
  return value as PersonalProfileDto;
}

export function createAccountApi(client: ApiClient) {
  return {
    profile: async () => parseProfile(await client.request<unknown>('GET', '/api/v1/me/profile')),
    updateProfile: async (nickname: string, avatar: ProfileAvatar) =>
      parseProfile(await client.request<unknown>('POST', '/api/v1/me/profile', { nickname, avatar })),
    games: (limit = 20, cursor?: string, status?: 'FINISHED') => client.request<{
      readonly items: PersonalGameDto[]; readonly nextCursor: string | null;
    }>('GET', `/api/v1/me/games?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}` +
      (status ? `&status=${status}` : '')),
  };
}
