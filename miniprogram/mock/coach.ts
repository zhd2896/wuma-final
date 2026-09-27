import type { CoachMessage } from '../types/domain';
export const coachMessages: CoachMessage[] = [
  { level: 1, title: '一级提示 · 关注区域', body: '先观察棋盘中央与右侧的连接点，找出需要照顾的空位。' },
  { level: 2, title: '二级提示 · 候选区域', body: '可以比较 P13 附近的几个落点，思考下一步的连接方式。' },
  { level: 3, title: '三级提示 · 推荐行动', body: '演示推荐：P09 → P13。此行动展示右翼向中央联系的思路。' }
];
