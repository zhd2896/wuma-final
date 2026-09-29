import type { AnalysisData } from '../types/domain';
export const analysisDemo: AnalysisData = {
  score: '+0.82', advantage: '红方略占主动', trend: '局面趋于稳定',
  recommendation: { id: 'best', notation: 'P09 → P13', assessment: '推荐行动', detail: '演示文本：从右翼向中央靠拢，便于观察两侧线路。' },
  candidates: [
    { id: 'a', notation: 'P09 → P13', assessment: '优先观察', detail: '向中央连接' },
    { id: 'b', notation: 'P14 → P13', assessment: '备选思路', detail: '观察上侧交点' },
    { id: 'c', notation: 'P19 → P18', assessment: '备选思路', detail: '关注右侧空间' }
  ],
  threats: ['注意右侧连接点', '留意中路空位'],
  keyPieces: ['P09：当前演示焦点', 'P13：中路交汇点']
};
