/** A small reproducible source for benchmark sampling; search behavior is untouched. */
export function createSeededRng(seed: number): () => number {
  if (!Number.isSafeInteger(seed)) throw new RangeError('seed must be a safe integer');
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
