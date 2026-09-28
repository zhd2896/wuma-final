import type { BoardNode, BoardLine, BoardPiece, Feature } from '../types/domain';

const gridX = [18, 34, 50, 66, 82];
const gridY = [35, 46.5, 58, 69.5, 81];
export const boardNodes: BoardNode[] = [
  { id: 'P29', x: 50, y: 12, temple: true },
  { id: 'P26', x: 36.7, y: 24, temple: true },
  { id: 'P27', x: 50, y: 24, temple: true },
  { id: 'P28', x: 63.3, y: 24, temple: true },
  ...gridY.reduce<BoardNode[]>((nodes, y, row) => {
    gridX.forEach((x, col) => nodes.push({ id: `P${String(row * 5 + col + 1).padStart(2, '0')}`, x, y }));
    return nodes;
  }, [])
];

const segments: [string, string][] = [];
for (let row = 0; row < 5; row++) {
  for (let col = 0; col < 5; col++) {
    const id = (r: number, c: number) => `P${String(r * 5 + c + 1).padStart(2, '0')}`;
    if (col < 4) segments.push([id(row, col), id(row, col + 1)]);
    if (row < 4) segments.push([id(row, col), id(row + 1, col)]);
    if (row < 4 && col < 4 && (row + col) % 2 === 0) segments.push([id(row, col), id(row + 1, col + 1)]);
    if (row < 4 && col > 0 && (row + col) % 2 === 0) segments.push([id(row, col), id(row + 1, col - 1)]);
  }
}
segments.push(['P29', 'P26'], ['P29', 'P28'], ['P29', 'P27'], ['P27', 'P03'], ['P26', 'P27'], ['P27', 'P28'], ['P26', 'P03'], ['P28', 'P03']);
const makeLine = (start: string, end: string, id: string): BoardLine => {
  const a = boardNodes.find(node => node.id === start)!;
  const b = boardNodes.find(node => node.id === end)!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return { id, x: a.x, y: a.y, width: Math.sqrt(dx * dx + dy * dy), angle: Math.atan2(dy, dx) * 180 / Math.PI };
};
export const boardLines: BoardLine[] = segments.map(([start, end], index) => makeLine(start, end, `L${index}`));
export const recommendationLine = makeLine('P05', 'P09', 'recommend');
const place = (id: string, nodeId: string, side: 'red' | 'black'): BoardPiece => {
  const node = boardNodes.find(item => item.id === nodeId)!;
  return { id, nodeId, x: node.x, y: node.y, side, state: 'normal' };
};
export const initialPieces: BoardPiece[] = [
  ...['P05', 'P10', 'P15', 'P20', 'P25'].map((nodeId, i) => place(`R${i}`, nodeId, 'red')),
  ...['P01', 'P06', 'P11', 'P16', 'P21'].map((nodeId, i) => place(`B${i}`, nodeId, 'black'))
];
export const homeFeatures: Feature[] = [
  { id: 'game', title: 'AI 对弈', subtitle: '与 AI 切磋，提升棋艺', icon: '弈', theme: 'red', route: '/pages/game/game' },
  { id: 'local', title: '双人对战', subtitle: '本地双人对弈', icon: '双', theme: 'gold', route: '/pages/game/game?mode=local' },
  { id: 'remote', title: '远程双人', subtitle: '建房邀请或匹配对手', icon: '云', theme: 'blue', route: '/pages/online/online' },
  { id: 'training', title: '残局挑战', subtitle: '经典残局，步步为营', icon: '局', theme: 'blue', route: '/pages/training/training' },
  { id: 'coach', title: 'AI 教练', subtitle: '个性化指导，提升棋力', icon: '师', theme: 'green', route: '/pages/coach/coach' },
  { id: 'review', title: '棋局复盘', subtitle: 'AI 分析，深入解析', icon: '复', theme: 'purple', route: '/pages/history/history?filter=reviewable' }
];
