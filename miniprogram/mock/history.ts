import type { HistoryRecord } from '../types/domain';
export const historyDemo: HistoryRecord[] = [
  { id: 'h1', date: '2026-09-20 20:18', opponent: 'AI 棋手', mode: 'AI 对弈', result: '演示对局', turns: 40, reviewed: true },
  { id: 'h2', date: '2026-09-18 18:42', opponent: '本地玩家', mode: '双人对战', result: '演示对局', turns: 28, reviewed: false },
  { id: 'h3', date: '2026-09-15 14:06', opponent: 'AI 棋手', mode: 'AI 对弈', result: '演示对局', turns: 36, reviewed: true }
];
