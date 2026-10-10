import type { GrowthDto } from '../../services/growth-contract';
import type { SkillMetricDto } from '../../services/account-api';
export function skillNextAction(metric: SkillMetricDto) {
  if (metric.value !== null) return { actionText: '', url: '', note: '' };
  if (metric.key === 'performance') return { actionText: '开一局电脑对弈',
    url: '/pages/game/game?mode=ai&new=1', note: '完成正式电脑对弈可积累实战样本；免登录试玩不计入。样本达标只代表可以评估。' };
  if (metric.key === 'training') return { actionText: '练一道基础题',
    url: '/pages/training/training?source=CURATED', note: '提交训练答案可积累作答样本，解题质量决定得分。' };
  return { actionText: '复盘已结束的电脑对弈', url: '/pages/history/history?filter=reviewable',
    note: '这些指标统计正式 AI 对局中你的复盘棋步；需同时满足局数与着数。联机和同机双人复盘不计入。' };
}
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
  const completionText = `最近7天尝试 ${current.attempted} 题／解出 ${current.completed} 题，` +
    (difference > 0 ? `比前7天多 ${difference} 题` : difference < 0 ? `比前7天少 ${-difference} 题` : '与前7天持平');
  const accuracyDifference = current.accuracy !== null && previous.accuracy !== null ? current.accuracy-previous.accuracy : null;
  const accuracyText = accuracyDifference === null ? '首次无提示正确率：两个时段各至少3题后比较。旧时段不足无法补填，继续积累新的观察周期。'
    : `首次无提示正确率 ${previous.accuracy}% → ${current.accuracy}% · ` +
      (accuracyDifference > 0 ? `提高 ${accuracyDifference} 个百分点` : accuracyDifference < 0 ? `下降 ${-accuracyDifference} 个百分点` : '持平');
  const maximum = Math.max(1, ...growth.daily.map(d => d.attempted));
  return { growthTasks: tasks, growthTrend: { completionText, accuracyText,
    hasActivity: growth.daily.some(d => d.attempted > 0),
    days: growth.daily.map((d,i) => ({...d, height: Math.round(d.completed / maximum * 100),
      attemptedHeight: Math.round(d.attempted / maximum * 100),
      label: i === 0 || i === 4 || i === 8 || i === 13 ? d.date.slice(5).replace('-', '/') : '',
      recent: i >= 7 })),
    disclaimer: '按上海日期统计；完成允许使用提示，正确率仅计时段内每题首次无提示作答。训练变化不等于棋力评分变化。',
  } };
}
