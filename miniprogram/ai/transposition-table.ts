import type { Move } from '../domain/index';
import type { ZobristKey } from './zobrist';

export type TTFlag = 'EXACT' | 'LOWER_BOUND' | 'UPPER_BOUND';

export interface TTEntry {
  readonly hash: ZobristKey;
  readonly stateSignature: string;
  readonly depth: number;
  /** Mate scores are normalized to a zero-ply origin before storage. */
  readonly score: number;
  readonly isMate: boolean;
  readonly flag: TTFlag;
  readonly bestMove: Move | null;
}

export interface TTProbeResult {
  readonly hit: boolean;
  readonly exact: boolean;
  readonly cutoff: boolean;
  readonly score: number | null;
  readonly isMate: boolean;
  readonly alpha: number;
  readonly beta: number;
}

export function classifyTTFlag(score: number, alphaOriginal: number, betaOriginal: number): TTFlag {
  if (score <= alphaOriginal) return 'UPPER_BOUND';
  if (score >= betaOriginal) return 'LOWER_BOUND';
  return 'EXACT';
}

/** isMate comes from the terminal ancestry, not a magnitude guess. */
export function normalizeScoreForTT(score: number, ply: number, isMate: boolean): number {
  if (!isMate || score === 0) return score;
  return score > 0 ? score + ply : score - ply;
}

export function restoreScoreFromTT(score: number, ply: number, isMate: boolean): number {
  if (!isMate || score === 0) return score;
  return score > 0 ? score - ply : score + ply;
}

/** Search-scoped table; a hash bucket can hold multiple distinct signatures. */
export class TranspositionTable {
  private readonly buckets = new Map<ZobristKey, Map<string, TTEntry>>();
  private entryCount = 0;
  private probeCount = 0;
  private hitCount = 0;
  private cutoffCount = 0;
  private storeCount = 0;

  get size(): number { return this.entryCount; }
  get probes(): number { return this.probeCount; }
  get hits(): number { return this.hitCount; }
  get cutoffs(): number { return this.cutoffCount; }
  get stores(): number { return this.storeCount; }

  store(entry: TTEntry): boolean {
    let bucket = this.buckets.get(entry.hash);
    if (!bucket) {
      bucket = new Map<string, TTEntry>();
      this.buckets.set(entry.hash, bucket);
    }
    const previous = bucket.get(entry.stateSignature);
    if (previous) {
      if (previous.depth > entry.depth) return false;
      if (previous.depth === entry.depth && previous.flag === 'EXACT' && entry.flag !== 'EXACT') {
        return false;
      }
    } else {
      this.entryCount++;
    }
    bucket.set(entry.stateSignature, entry);
    this.storeCount++;
    return true;
  }

  probe(
    hash: ZobristKey,
    signature: string,
    depth: number,
    alpha: number,
    beta: number,
    ply: number,
  ): TTProbeResult {
    this.probeCount++;
    const miss = (): TTProbeResult => ({
      hit: false, exact: false, cutoff: false, score: null, isMate: false,
      alpha, beta,
    });
    const entry = this.buckets.get(hash)?.get(signature);
    if (!entry) return miss();
    if (entry.depth !== depth) return miss();
    const score = restoreScoreFromTT(entry.score, ply, entry.isMate);
    if (entry.flag === 'EXACT') {
      this.hitCount++;
      return { hit: true, exact: true, cutoff: false, score,
        isMate: entry.isMate, alpha, beta };
    }
    if (entry.flag === 'LOWER_BOUND') {
      const nextAlpha = Math.max(alpha, score);
      if (nextAlpha === alpha) return miss();
      this.hitCount++;
      const cutoff = nextAlpha >= beta;
      if (cutoff) this.cutoffCount++;
      return { hit: true, exact: false, cutoff, score: cutoff ? score : null,
        isMate: cutoff && entry.isMate, alpha: nextAlpha, beta };
    }
    const nextBeta = Math.min(beta, score);
    if (nextBeta === beta) return miss();
    this.hitCount++;
    const cutoff = alpha >= nextBeta;
    if (cutoff) this.cutoffCount++;
    return { hit: true, exact: false, cutoff, score: cutoff ? score : null,
      isMate: cutoff && entry.isMate, alpha, beta: nextBeta };
  }
}
