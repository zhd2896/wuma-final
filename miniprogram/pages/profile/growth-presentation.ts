import type { GrowthDto } from '../../services/growth-contract';
export function growthPresentation(growth: GrowthDto | null | undefined) {
  if (!growth) return { growthTasks: [], growthTrend: null };
  const tasks = growth.themes.map(t => ({ theme: t.theme,
    title: t.remaining ? `再完成 ${t.remaining} 题${t.label}训练` : `${t.label}训练目标已完成`,
    progressText: `最近7天：${Math.min(growth.goal, t.completedThisWeek)} / ${growth.goal} 道不同题`,
    reason: t.accuracy === null ? '先练基础，积累至少3道首次无提示作答后评估'
      : `${t.correct * 4 < t.attempts * 3 ? '针对弱项' : '巩固主题'} · 首次正确率 ${Math.round(t.correct / t.attempts * 1000)/10}%（${t.attempts}题）`,
    priority: t.accuracy !== null && t.correct * 4 < t.attempts * 3,
    accuracy: t.accuracy, remaining: t.remaining,
    actionText: t.remaining ? '开始练习' : '继续巩固',
    url: `/pages/training/training?source=CURATED&theme=${t.theme}&difficulty=${t.recommendedDifficulty}`,
  })).sort((a,b) => Number(b.priority)-Number(a.priority) || Number(b.remaining > 0)-Number(a.remaining > 0) ||
    (a.priority && b.priority ? a.accuracy! - b.accuracy! : 0));
  const { current, previous } = growth.recent;
  const difference = current.completed - previous.completed;
  const completionText = `最近7天完成 ${current.completed} 道不同题，` +
    (difference > 0 ? `比前7天多 ${difference} 题` : difference < 0 ? `比前7天少 ${-difference} 题` : '与前7天持平');
  const accuracyDifference = current.accuracy !== null && previous.accuracy !== null ? current.accuracy-previous.accuracy : null;
  const accuracyText = accuracyDifference === null ? '首次无提示正确率：两个时段各至少3题后比较'
    : `首次无提示正确率 ${previous.accuracy}% → ${current.accuracy}% · ` +
      (accuracyDifference > 0 ? `提高 ${accuracyDifference} 个百分点` : accuracyDifference < 0 ? `下降 ${-accuracyDifference} 个百分点` : '持平');
  const maximum = Math.max(1, ...growth.daily.map(d => d.completed));
  return { growthTasks: tasks, growthTrend: { completionText, accuracyText,
    hasActivity: growth.daily.some(d => d.attempted > 0),
    days: growth.daily.map((d,i) => ({...d, height: Math.round(d.completed / maximum * 100),
      label: i === 0 || i === 4 || i === 8 || i === 13 ? d.date.slice(5).replace('-', '/') : '',
      recent: i >= 7 })),
    disclaimer: '按上海日期统计；完成允许使用提示，正确率仅计时段内每题首次无提示作答。训练变化不等于棋力评分变化。',
  } };
}
