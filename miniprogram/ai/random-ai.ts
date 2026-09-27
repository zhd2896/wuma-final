import { RuleEngine } from '../domain/index';
import type { GameState, Move } from '../domain/index';

/** Shared minimum contract for an AI that chooses, but does not execute, a move. */
export interface MoveChooser {
  chooseMove(state: GameState): Move | null;
}

export class RandomAI implements MoveChooser {
  private readonly random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  chooseMove(state: GameState): Move | null {
    const legalMoves = RuleEngine.getAllLegalMoves(state);
    if (legalMoves.length === 0) return null;

    const sample = this.random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
      throw new RangeError('Random source must return a finite number in [0, 1)');
    }
    return legalMoves[Math.floor(sample * legalMoves.length)];
  }
}
