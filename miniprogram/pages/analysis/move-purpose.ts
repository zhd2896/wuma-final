import { RuleEngine, TEMPLE_NODES, getPlayerNodes } from '../../domain/index';
import type { GameState, Move, NodeId, Player } from '../../domain/index';
import type { PositionAnalysis } from '../../ai/position-analysis';
import { blockadePressure } from '../../ai/blockade';
import { playerLabel } from './analysis-presentation';

function sameMove(left: Move | undefined, right: Move): boolean {
  return left?.from === right.from && left.to === right.to;
}

function captureTargets(state: GameState, attacker: Player): ReadonlySet<NodeId> {
  const defender = attacker === 'A' ? 'B' : 'A';
  if (state.game_status !== 'PLAYING' || getPlayerNodes(state.board, defender).length <= 1) return new Set();
  const turnState = state.current_player === attacker ? state : { ...state, current_player: attacker };
  const targets = new Set<NodeId>();
  for (const turn of RuleEngine.executeTurns(turnState, RuleEngine.getAllLegalMoves(turnState))) {
    if (turn.captures.was_applied) turn.captures.captured_nodes.forEach(node => targets.add(node));
  }
  return targets;
}

/** Explains local effects; only supplied, matching proof can guarantee a future win. */
export function createMovePurposeExplainer(state: GameState, analysis: PositionAnalysis,
                                           humanPlayer?: Player): (move: Move) => string {
  const own = analysis.analyzedPlayer;
  const other: Player = own === 'A' ? 'B' : 'A';
  const otherLabel = playerLabel(other, humanPlayer);
  let beforeTargets: ReadonlySet<NodeId> | undefined;
  return move => {
    if (state.current_player !== own || !RuleEngine.validateMove(state, move)) {
      return '当前局面无法验证这条走法，请重新分析。';
    }
    const turn = RuleEngine.executeTurn(state, move);
    const after = turn.state;
    if (after.game_status === 'FINISHED' && after.winner === own) {
      return after.winner_reason === 'CAPTURE_ALL'
        ? `这一步可吃掉${otherLabel}的全部棋子，直接获胜。`
        : `这一步可使${otherLabel}无合法走法，直接获胜。`;
    }
    const proof = analysis.threats.find(threat => threat.player === own &&
      threat.type === 'FORCED_BLOCKADE_AVAILABLE' && sameMove(threat.relatedMove, move));
    if (proof) return `为围堵收网做准备：这条路线已验证覆盖对手所有合法应手，最多 ${proof.evidence.maxPlies} 手可获胜。`;
    if (turn.captures.was_applied) return `这一步可吃掉${otherLabel} ${turn.captures.captured_nodes.length} 颗棋，减少对方盘上棋子。`;
    if (turn.captures.failure_reason === 'INSUFFICIENT_RESERVE') {
      return '可以移动到这里，但备用棋不足，本次吃子不会生效。';
    }
    const ownMoves = RuleEngine.getAllLegalMovesForPlayer(after, own).length;
    if (getPlayerNodes(state.board, own).length === 1) {
      const beforeMoves = RuleEngine.getAllLegalMovesForPlayer(state, own).length;
      const action = TEMPLE_NODES.includes(move.from) && !TEMPLE_NODES.includes(move.to)
        ? '让孤棋离开庙区'
        : ownMoves > beforeMoves ? '为孤棋增加活动选择' : '调整孤棋位置';
      return `${action}，走后暂有 ${ownMoves} 个合法走法；仍需观察对手应手。`;
    }
    if (getPlayerNodes(state.board, other).length === 1 &&
        blockadePressure(after, own) > blockadePressure(state, own)) {
      return `加强对${otherLabel}孤棋的封锁压力；是否能完成围堵仍需后续验证。`;
    }
    beforeTargets ??= captureTargets(state, other);
    const afterTargets = captureTargets(after, other);
    if (afterTargets.size < beforeTargets.size) {
      return `减少${otherLabel}下一手可捕获的目标，从 ${beforeTargets.size} 个降至 ${afterTargets.size} 个；仍需留意后续变化。`;
    }
    if (analysis.threats.some(threat => threat.player === own &&
        threat.type === 'CAPTURE_THREAT' && sameMove(threat.relatedMove, move))) {
      return '布置后续吃子机会，对手仍可应对，需要观察下一手。';
    }
    if (ownMoves > RuleEngine.getAllLegalMovesForPlayer(state, own).length) {
      return `增加己方可选走法，走后暂有 ${ownMoves} 个合法走法。`;
    }
    return '调整棋子位置；当前分析尚未确认更具体的战术目的。';
  };
}
