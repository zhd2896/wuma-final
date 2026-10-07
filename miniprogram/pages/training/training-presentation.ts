import type { TrainingQuestionDto } from '../../services/api-contract';

export const difficultyLabels = { EASY: '入门', NORMAL: '进阶', COMPLEX: '复杂', UNCALIBRATED: '待校准' };
const themeLabels: Readonly<Record<string, string>> = { CAPTURE: '吃子', VULNERABILITY: '防守',
  LONE_PIECE_RISK: '孤棋', ENDGAME: '残局', GENERAL: '综合', IMMEDIATE_WIN: '直接获胜' };

export function trainingPresentation(item: TrainingQuestionDto) {
  const basis = item.difficultyBasis;
  const difficultyText = difficultyLabels[item.difficultyTag] + (basis
    ? basis.kind === 'LESSON_DESIGN' ? '（教学分级）' : '（引擎估计）' : '');
  const calibration = item.difficultyCalibration;
  const calibrationText = !calibration ? '' : calibration.status === 'CALIBRATED' && calibration.suggestedDifficulty
    ? `试玩建议：${difficultyLabels[calibration.suggestedDifficulty]} · ${calibration.sampleCount} 个账号首次正确率 ${Math.round(calibration.firstTryCorrectCount / calibration.sampleCount * 100)}%`
    : `待试玩校准 · ${calibration.sampleCount}/${calibration.minimumSamples} 个账号首次答题`;
  return { difficultyText, calibrationText, tagsText: item.trainingTags.map(tag => themeLabels[tag] ?? '综合').join(' · ') };
}
