import type { Move, NodeId } from '../domain/index';
import type { BoardState } from '../types/domain';

export function describeNode(id: NodeId): string {
  const names: Partial<Record<NodeId, string>> = {
    P03: '庙宇入口', P13: '中央',
    P26: '庙宇左翼', P27: '庙宇中间', P28: '庙宇右翼', P29: '宝顶',
  };
  const index = Number(id.slice(1)) - 1;
  const location = names[id] ?? `第${Math.floor(index / 5) + 1}行第${index % 5 + 1}列`;
  return `${id}（${location}）`;
}

export function describeMove(move: Move): string {
  return `起点 ${describeNode(move.from)} → 终点 ${describeNode(move.to)}`;
}

/** Mark a route on the supplied position without moving any piece. */
export function highlightBoardMove(board: BoardState, move: Move | null): BoardState {
  const { recommendedFrom: _from, recommendedTo: _to, recommendLine: _line, ...position } = board;
  if (!move) return { ...position };
  const from = board.nodes.find(node => node.id === move.from);
  const to = board.nodes.find(node => node.id === move.to);
  if (!from || !to || move.from === move.to) return { ...position };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return { ...position, recommendedFrom: move.from, recommendedTo: move.to,
    recommendLine: { id: 'guidance-route', x: from.x, y: from.y,
      width: Math.sqrt(dx * dx + dy * dy), angle: Math.atan2(dy, dx) * 180 / Math.PI } };
}

export function highlightBoardNodes(board: BoardState, ids: readonly NodeId[]): BoardState {
  const focused = new Set<string>(ids);
  return { ...board, nodes: board.nodes.map(node => ({ ...node, focused: focused.has(node.id) })) };
}
