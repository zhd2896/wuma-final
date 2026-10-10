import type { BoardNode } from '../types/domain';

export type BoardHitNode = BoardNode & { hitWidth: number; hitHeight: number };

/** Square percentage hit areas stay centered and leave a gap on the separating axis. */
export function boardHitGeometry(nodes: readonly BoardNode[]): BoardHitNode[] {
  const visible = nodes.filter(node => !node.visualOnly && Number.isFinite(node.x) && Number.isFinite(node.y));
  return visible.map(node => {
    const nearest = visible.reduce((distance, other) => other === node ? distance
      : Math.min(distance, Math.max(Math.abs(node.x - other.x), Math.abs(node.y - other.y))), Infinity);
    const edge = Math.max(0, Math.min(12, nearest * 0.92,
      2 * Math.min(node.x, 100 - node.x, node.y, 100 - node.y)));
    return { ...node, hitWidth: edge, hitHeight: edge };
  });
}
