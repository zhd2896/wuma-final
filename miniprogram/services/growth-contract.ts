import { ApiError } from './api-client';
export type GrowthTheme = 'CAPTURE' | 'VULNERABILITY' | 'LONE_PIECE_RISK';
export interface GrowthThemeDto {
  readonly theme: GrowthTheme; readonly label: string; readonly attempts: number; readonly correct: number;
  readonly accuracy: number | null; readonly completedThisWeek: number; readonly remaining: number;
  readonly recommendedDifficulty: 'EASY' | 'NORMAL';
}
export interface GrowthPeriodDto {
  readonly start: string; readonly end: string; readonly completed: number; readonly attempted: number;
  readonly firstAttempts: number; readonly firstCorrect: number; readonly accuracy: number | null;
}
export interface GrowthDto {
  readonly version: 'growth_v1'; readonly asOf: string; readonly goal: 2; readonly minimumSamples: 3;
  readonly themes: readonly GrowthThemeDto[];
  readonly recent: { readonly current: GrowthPeriodDto; readonly previous: GrowthPeriodDto };
  readonly daily: readonly { readonly date: string; readonly completed: number; readonly attempted: number }[];
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const rate = (n: number, c: number) => n < 3 ? null : Math.round(c / n * 100);

/** Missing growth supports older servers; malformed evidence never becomes a task. */
export function parseGrowth(value: unknown): GrowthDto | null {
  if (value == null) return null;
  const invalid = (): never => { throw new ApiError('INVALID_PROFILE_RESPONSE', 200); };
  if (!record(value) || value.version !== 'growth_v1' || value.goal !== 2 || value.minimumSamples !== 3 || !date(value.asOf) ||
      !Array.isArray(value.themes) || value.themes.length !== 3 || !record(value.recent) || !Array.isArray(value.daily) || value.daily.length !== 14) invalid();
  const g = value as Record<string, any>;
  const keys = ['CAPTURE', 'VULNERABILITY', 'LONE_PIECE_RISK'];
  g.themes.forEach((t: any, i: number) => {
    if (!record(t) || t.theme !== keys[i] || typeof t.label !== 'string' ||
        !count(t.attempts) || !count(t.correct) || t.correct > t.attempts ||
        !count(t.completedThisWeek) || t.remaining !== Math.max(0, 2 - t.completedThisWeek) ||
        t.accuracy !== rate(t.attempts, t.correct) ||
        t.recommendedDifficulty !== (t.attempts >= 3 && t.correct * 4 >= t.attempts * 3 ? 'NORMAL' : 'EASY')) invalid();
  });
  for (const p of [g.recent.current, g.recent.previous]) {
    if (!record(p) || !date(p.start) || !date(p.end) || p.start > p.end ||
        !count(p.completed) || !count(p.attempted) || p.completed > p.attempted ||
        !count(p.firstAttempts) || p.firstAttempts > p.attempted || !count(p.firstCorrect) || p.firstCorrect > p.firstAttempts || p.firstCorrect > p.completed ||
        p.accuracy !== rate(p.firstAttempts, p.firstCorrect)) invalid();
  }
  g.daily.forEach((d: any, i: number) => {
    const expected = new Date(Date.parse(g.asOf) - (13-i)*86400000).toISOString().slice(0,10);
    if (!record(d) || d.date !== expected || !count(d.completed) || !count(d.attempted) || d.completed > d.attempted) invalid();
  });
  if (g.recent.current.start !== g.daily[7].date || g.recent.current.end !== g.asOf ||
      g.recent.previous.start !== g.daily[0].date || g.recent.previous.end !== g.daily[6].date) invalid();
  for (const [period, days] of [[g.recent.previous, g.daily.slice(0,7)], [g.recent.current, g.daily.slice(7)]] as const) {
    for (const key of ['completed', 'attempted'] as const) {
      if (period[key] < Math.max(...days.map((d: any) => d[key])) ||
          period[key] > days.reduce((sum: number, d: any) => sum+d[key],0)) invalid();
    }
  }
  if (g.themes.some((t: any) => t.completedThisWeek > g.recent.current.completed)) invalid();
  return value as GrowthDto;
}
