import { RuleEngine, TEMPLE_NODES, countPieces, getPlayerNodes } from '../domain/index';
import type { GameState, Move, NodeId, Player } from '../domain/index';
import { blockadePressure } from './blockade';

/** First-pass heuristic weights. These have not been tuned by benchmark or self-play. */
export interface EvaluationConfig {
  readonly materialWeight: number;
  readonly reserveWeight: number;
  readonly mobilityWeight: number;
  readonly templeControlWeight: number;
  readonly captureOpportunityWeight: number;
  readonly vulnerabilityWeight: number;
  readonly trapRiskWeight: number;
  readonly blockadeWeight?: number;
  readonly loneMobilityScale?: number;
  readonly mateScore: number;
}

export const DEFAULT_EVALUATION_CONFIG: Readonly<EvaluationConfig> = {
  materialWeight: 100, // On-board pieces remain the main nonterminal signal.
  reserveWeight: 12, // Replacement capacity matters separately from active pieces.
  mobilityWeight: 2, // Legal options are useful, but numerous paths can be redundant.
  templeControlWeight: 2, // Occupancy is a weak signal; entering the temple is not a loss.
  captureOpportunityWeight: 16, // Count distinct enemy nodes capturable in one ply.
  vulnerabilityWeight: -12, // Opposing legal capture routes are a liability.
  trapRiskWeight: -20, // A lone piece with few exits is at risk on any board node.
  blockadeWeight: 24, // Coordinated seals around a small escape region, not a win proof.
  loneMobilityScale: 0.25,
  mateScore: 1_000_000, // Dominates ordinary scores for normal reachable states.
};

export interface FeatureContribution {
  readonly rawValue: number;
  readonly weight: number;
  readonly weightedScore: number;
}

export interface EvaluationBreakdown {
  readonly material: FeatureContribution;
  readonly reserve: FeatureContribution;
  readonly mobility: FeatureContribution;
  readonly templeControl: FeatureContribution;
  readonly captureOpportunity: FeatureContribution;
  readonly vulnerability: FeatureContribution;
  readonly trapRisk: FeatureContribution;
  /** Optional for compatibility with evaluations saved before this feature. */
  readonly blockade?: FeatureContribution;
  readonly terminal: FeatureContribution;
}

export interface EvaluationResult {
  /** Positive favors scorePerspective; negative favors the opponent. */
  readonly score: number;
  readonly scorePerspective: Player;
  readonly breakdown: EvaluationBreakdown;
  readonly terminal: boolean;
}

interface PlayerAnalysis {
  readonly legalMoves: readonly Move[];
  readonly capturingMoveCount: number;
  readonly capturedNodes: ReadonlySet<NodeId>;
}

function opponentOf(player: Player): Player {
  return player === 'A' ? 'B' : 'A';
}

function contribution(rawValue: number, weight: number): FeatureContribution {
  const weightedScore = rawValue * weight;
  return { rawValue, weight, weightedScore: weightedScore === 0 ? 0 : weightedScore };
}

function zeroBreakdown(config: EvaluationConfig): EvaluationBreakdown {
  return {
    material: contribution(0, config.materialWeight),
    reserve: contribution(0, config.reserveWeight),
    mobility: contribution(0, config.mobilityWeight),
    templeControl: contribution(0, config.templeControlWeight),
    captureOpportunity: contribution(0, config.captureOpportunityWeight),
    vulnerability: contribution(0, config.vulnerabilityWeight),
    trapRisk: contribution(0, config.trapRiskWeight),
    blockade: contribution(0, config.blockadeWeight ?? 24),
    terminal: contribution(0, config.mateScore),
  };
}

/** Inspect every legal one-ply turn with the real GameEngine. No search is performed. */
function analyzePlayer(state: GameState, player: Player, stopAtFirstCapture = false): PlayerAnalysis {
  const legalMoves = RuleEngine.getAllLegalMovesForPlayer(state, player);
  const turnState = state.current_player === player ? state : { ...state, current_player: player };
  const capturedNodes = new Set<NodeId>();
  let capturingMoveCount = 0;
  // The last enemy piece is protected from CLAMP and CARRY needs two targets.
  // Still return the real legal moves, but skip turns that cannot capture.
  if (countPieces(state.board, opponentOf(player)) <= 1) {
    return { legalMoves, capturingMoveCount, capturedNodes };
  }
  const turns = stopAtFirstCapture ? null : RuleEngine.executeTurns(turnState, legalMoves);
  for (let index = 0; index < legalMoves.length; index++) {
    const turn = turns ? turns[index] : RuleEngine.executeTurn(turnState, legalMoves[index]);
    if (!turn.captures.was_applied) continue;
    capturingMoveCount++;
    for (const node of turn.captures.captured_nodes) capturedNodes.add(node);
    if (stopAtFirstCapture) break;
  }
  return { legalMoves, capturingMoveCount, capturedNodes };
}

/** Query the existing one-ply capture analysis without evaluating other features. */
export function hasCaptureOpportunity(state: GameState, player: Player): boolean {
  return analyzePlayer(state, player, true).capturedNodes.size > 0;
}

/** A lone piece has mobility risk 1/(legal moves + 1), wherever it stands. */
function lonePieceMobilityRisk(state: GameState, player: Player, legalMoveCount: number): number {
  const nodes = getPlayerNodes(state.board, player);
  return nodes.length === 1
    ? 1 / (legalMoveCount + 1)
    : 0;
}

/** Score the supplied player, independently of whose turn is stored in GameState. */
export function evaluatePosition(
  state: GameState,
  perspective: Player,
  config: EvaluationConfig = DEFAULT_EVALUATION_CONFIG,
): EvaluationResult {
  const opponent = opponentOf(perspective);
  if (state.game_status === 'FINISHED') {
    if (state.winner === null) throw new Error('Finished game has no winner');
    const breakdown = {
      ...zeroBreakdown(config),
      terminal: contribution(state.winner === perspective ? 1 : -1, config.mateScore),
    };
    return {
      score: breakdown.terminal.weightedScore,
      scorePerspective: perspective,
      breakdown,
      terminal: true,
    };
  }

  const own = analyzePlayer(state, perspective);
  const other = analyzePlayer(state, opponent);
  const ownCount = countPieces(state.board, perspective);
  const otherCount = countPieces(state.board, opponent);
  const loneEndgame = Math.min(ownCount, otherCount) === 1 && Math.max(ownCount, otherCount) >= 3;
  const templeCount = (player: Player): number =>
    TEMPLE_NODES.filter(node => state.board.occupancy[node] === player).length;
  const breakdown: EvaluationBreakdown = {
    material: contribution(
      countPieces(state.board, perspective) - countPieces(state.board, opponent),
      config.materialWeight,
    ),
    reserve: contribution(
      state.players[perspective].reserve_count - state.players[opponent].reserve_count,
      config.reserveWeight,
    ),
    mobility: contribution(own.legalMoves.length - other.legalMoves.length,
      config.mobilityWeight * (loneEndgame ? config.loneMobilityScale ?? 0.25 : 1)),
    templeControl: contribution(templeCount(perspective) - templeCount(opponent),
      config.templeControlWeight),
    // Distinct targets across all real one-ply captures, not a route count.
    captureOpportunity: contribution(
      own.capturedNodes.size - other.capturedNodes.size, config.captureOpportunityWeight,
    ),
    // Opposing effective capture actions minus our own effective capture actions.
    vulnerability: contribution(
      other.capturingMoveCount - own.capturingMoveCount, config.vulnerabilityWeight,
    ),
    trapRisk: contribution(
      lonePieceMobilityRisk(state, perspective, own.legalMoves.length)
        - lonePieceMobilityRisk(state, opponent, other.legalMoves.length),
      config.trapRiskWeight,
    ),
    blockade: contribution(blockadePressure(state, perspective) - blockadePressure(state, opponent),
      config.blockadeWeight ?? 24),
    terminal: contribution(0, config.mateScore),
  };
  return {
    score: Object.values(breakdown).reduce((sum, feature) => sum + feature.weightedScore, 0),
    scorePerspective: perspective,
    breakdown,
    terminal: false,
  };
}
