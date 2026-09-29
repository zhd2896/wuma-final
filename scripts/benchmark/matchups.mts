/** Spread total games across matchups in whole A/B side-swap pairs. */
export function allocatePairedGames(totalGames: number, matchupCount: number): number[] {
  if (!Number.isSafeInteger(totalGames) || !Number.isSafeInteger(matchupCount) ||
      matchupCount < 1 || totalGames < matchupCount * 2 || totalGames % 2 !== 0) {
    throw new RangeError('Total games must contain an even pair for each matchup');
  }
  const pairs = totalGames / 2;
  const base = Math.floor(pairs / matchupCount);
  const remainder = pairs % matchupCount;
  return Array.from({ length: matchupCount }, (_, index) =>
    2 * (base + (index < remainder ? 1 : 0)));
}
