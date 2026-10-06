import type { SkillMetricDto, SkillMetricKey } from '../../services/account-api';

export type SkillChartMode = 'radar' | 'bar' | 'line';
export const SKILL_CHART_MODES = [
  { id: 'radar', label: '雷达图' }, { id: 'bar', label: '条形图' }, { id: 'line', label: '折线图' },
] as const;
export function isSkillChartMode(value: unknown): value is SkillChartMode {
  return value === 'radar' || value === 'bar' || value === 'line';
}
const dimensions: readonly { key: SkillMetricKey; label: string }[] = [
  { key: 'performance', label: '实战表现' }, { key: 'best_move', label: '最佳着率' },
  { key: 'decision', label: '决策质量' }, { key: 'stability', label: '稳定性' },
  { key: 'mistake_control', label: '失误控制' }, { key: 'training', label: '训练掌握' },
];
interface Point { key: string; x: number; y: number; }
interface Segment { id: string; x: number; y: number; width: number; angle: number; }
interface Metric { key: string; label: string; value: number | null; hasValue: boolean; valueText: string; }
export interface SkillChartModel {
  mode: SkillChartMode;
  metrics: Metric[];
  points: Point[];
  links: Segment[];
  grid: Segment[];
  axes: Segment[];
  labels: (Point & { label: string; valueText: string })[];
  scales: (Point & { label: string })[];
  missingCount: number;
  caption: string;
  notice: string;
}
const round = (value: number): number => Math.round(value * 100) / 100;
function polar(index: number, radius: number, key: string): Point {
  const angle = (index * 60 - 90) * Math.PI / 180;
  return { key, x: round(50 + radius * Math.cos(angle)), y: round(50 + radius * Math.sin(angle)) };
}
function segment(from: Point, to: Point, id: string): Segment {
  const dx = to.x - from.x, dy = to.y - from.y;
  return { id, x: from.x, y: from.y, width: round(Math.sqrt(dx * dx + dy * dy)),
    angle: round(Math.atan2(dy, dx) * 180 / Math.PI) };
}

/** Coordinates share a square 0–100 space; null never becomes a data point. */
export function buildSkillChart(input: readonly SkillMetricDto[], requestedMode: SkillChartMode = 'radar'): SkillChartModel {
  const mode = isSkillChartMode(requestedMode) ? requestedMode : 'radar';
  const metrics: Metric[] = dimensions.map(dimension => {
    const source = input.find(metric => metric.key === dimension.key);
    const value = typeof source?.value === 'number' && Number.isFinite(source.value) &&
      source.value >= 0 && source.value <= 100 ? source.value : null;
    return { ...dimension, value, hasValue: value !== null, valueText: value === null ? '待评估' : `${value} 分` };
  });
  const missingCount = metrics.filter(metric => !metric.hasValue).length;
  const chart: SkillChartModel = {
    mode, metrics, points: [], links: [], grid: [], axes: [], labels: [], scales: [], missingCount,
    caption: mode === 'line' ? '当前六项能力对比（非时间趋势）' : mode === 'radar'
      ? '六项能力分布 · 统一 0–100 分' : '六项能力分数 · 统一 0–100 分',
    notice: missingCount === 6 ? '六项指标样本不足，完成对局、复盘和训练后即可评估。'
      : missingCount ? `${missingCount} 项指标样本不足，标为待评估；缺项不绘点、不连线。` : '',
  };
  if (mode === 'bar') return chart;
  const dataPoints: (Point | null)[] = metrics.map((metric, index) => metric.value === null ? null
    : mode === 'radar' ? polar(index, 31 * metric.value / 100, metric.key)
      : { key: metric.key, x: round(14 + index * 15.2), y: round(80 - metric.value * 0.6) });
  chart.points = dataPoints.filter((point): point is Point => point !== null);
  for (let index = 0; index < (mode === 'radar' ? 6 : 5); index++) {
    const from = dataPoints[index], to = dataPoints[(index + 1) % 6];
    if (from && to) chart.links.push(segment(from, to, `data-${index}`));
  }
  chart.labels = metrics.map((metric, index) => ({
    ...(mode === 'radar' ? polar(index, 42, metric.key) : { key: metric.key, x: round(14 + index * 15.2), y: 93 }),
    label: metric.label, valueText: metric.valueText,
  }));
  if (mode === 'radar') {
    const center = { key: 'center', x: 50, y: 50 };
    for (let ring = 1; ring <= 5; ring++) {
      for (let index = 0; index < 6; index++) {
        chart.grid.push(segment(polar(index, ring * 6.2, ''), polar((index + 1) % 6, ring * 6.2, ''), `grid-${ring}-${index}`));
      }
    }
    chart.axes = metrics.map((metric, index) => segment(center, polar(index, 31, ''), `axis-${metric.key}`));
    chart.scales = [0, 20, 40, 60, 80, 100].map(value => ({ key: `scale-${value}`, x: 52, y: 50 - value * 0.31, label: `${value}` }));
  } else {
    chart.grid = [0, 25, 50, 75, 100].map(value => segment({ key: '', x: 8, y: 80 - value * 0.6 },
      { key: '', x: 94, y: 80 - value * 0.6 }, `grid-${value}`));
    chart.axes = [segment({ key: '', x: 8, y: 20 }, { key: '', x: 8, y: 80 }, 'axis-y')];
    chart.scales = [0, 25, 50, 75, 100].map(value => ({ key: `scale-${value}`, x: 3, y: 80 - value * 0.6, label: `${value}` }));
  }
  return chart;
}
