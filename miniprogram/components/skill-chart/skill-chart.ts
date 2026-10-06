import { buildSkillChart } from './chart-model';
import type { SkillChartMode } from './chart-model';
import type { SkillMetricDto } from '../../services/account-api';

Component({
  properties: {
    metrics: { type: Array, value: [] as SkillMetricDto[] },
    mode: { type: String, value: 'radar' },
  },
  data: { chart: buildSkillChart([]) },
  observers: {
    'metrics, mode'(metrics: SkillMetricDto[], mode: string) {
      this.setData({ chart: buildSkillChart(metrics ?? [], mode as SkillChartMode) });
    },
  },
});
