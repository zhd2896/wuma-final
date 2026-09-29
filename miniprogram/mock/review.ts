import type { ReviewData } from '../types/domain';
export const reviewDemo: ReviewData = {
  title: '玩家 · AI 棋手', result: '演示对局', turns: 40,
  summary: '本局以中路争夺为主。以下关键节点与评分均为界面演示内容。',
  moments: [
    { turn: 12, notation: 'P09 → P13', label: '好棋', tone: 'good', score: '+0.82', detail: '建立中路联系，保留后续变化。' },
    { turn: 18, notation: 'P08 → P14', label: '正常', tone: 'normal', score: '+0.34', detail: '稳健推进，局面相对平衡。' },
    { turn: 25, notation: 'P12 → P13', label: '失误', tone: 'bad', score: '-0.26', detail: '右侧防线值得重新观察。' },
    { turn: 33, notation: 'P19 → P14', label: '严重失误', tone: 'severe', score: '-1.12', detail: '让中路出现较大的空档。' }
  ],
  curve: [-0.2, 0, -0.3, 0.2, 0.35, 0.2, 0.52, 0.38, 0.82, 0.64, 1.08, 0.84, 0.43, 0.3, 0.58, 0.1, -0.1, -0.38, -0.72, -0.48]
};
