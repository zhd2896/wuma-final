import type { TrainingLevel } from '../types/domain';
export const trainingLevels: TrainingLevel[] = [
  { id: '1', title: '第 1 关 · 基础吃子', subtitle: '通过关键路线寻子', difficulty: 2, category: '入门', completed: false },
  { id: '2', title: '第 2 关 · 连续夹击', subtitle: '寻找连贯进攻思路', difficulty: 3, category: '入门', completed: false },
  { id: '3', title: '第 3 关 · 精准防守', subtitle: '在防守中寻找反击机会', difficulty: 3, category: '进阶', completed: false },
  { id: '4', title: '第 4 关 · 庙顶制胜', subtitle: '将对手困入庙顶', difficulty: 4, category: '进阶', completed: false },
  { id: '5', title: '第 5 关 · 经典残局', subtitle: '复杂形势的观察训练', difficulty: 5, category: '大师', completed: false }
];
