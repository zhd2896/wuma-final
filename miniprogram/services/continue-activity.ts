import { createWxDeviceHistoryStore } from './device-history';
import { hasWechatSession } from './device-auth';
import { AI_LEVEL_LABELS } from './api-contract';
import { restoreTrialDraft } from './trial-draft';
import { TUTORIAL_LESSONS } from './tutorial-lessons';

export interface ContinueActivity {
  id: string; kind: string; title: string; detail: string; route: string;
}
/** Read-only: an invalid module never prevents browsing the public pages. */
export function readContinueActivities(): ContinueActivity[] {
  const result: ContinueActivity[] = [];
  let records: ReturnType<ReturnType<typeof createWxDeviceHistoryStore>['list']> = [];
  try { records = createWxDeviceHistoryStore().list(); } catch { /* preserve other modules */ }
  try {
    const draft = wx.getStorageSync('wuma:trial-draft:v1');
    if (draft && !records.some(row => row.id === draft.id)) {
      const trial = restoreTrialDraft(draft);
      if (trial.session.gameState.game_status === 'PLAYING') result.push({ id: trial.id,
        kind: 'trial', title: '继续电脑试玩', detail: `电脑试玩 · ${trial.session.score!.moves.length} 手 · 你执黑棋`,
        route: '/guide/pages/trial/trial' });
    }
  } catch { /* damaged draft stays available for explicit recovery in trial */ }
  try {
    const saved = wx.getStorageSync('wuma:tutorial:v2');
    const legacy = saved ? null : wx.getStorageSync('wuma:tutorial:v1');
    const index = saved?.version === 2 ? saved.stepIndex
      : legacy?.version === 1 && Number.isInteger(legacy.stepIndex) && legacy.stepIndex >= 0
        ? Math.min(legacy.stepIndex, 3) : null;
    if (Number.isInteger(index) && index >= 0 && index < TUTORIAL_LESSONS.length) result.push({
      id: 'tutorial', kind: 'tutorial', title: '继续新手实操',
      detail: `第 ${index + 1} / ${TUTORIAL_LESSONS.length} 关 · ${TUTORIAL_LESSONS[index].title}`,
      route: '/guide/pages/tutorial/tutorial' });
  } catch { /* optional progress */ }
  try {
    const authenticated = hasWechatSession();
    const keys = { ai: 'activeAiGameId', online: 'wuma:online:active', remote: 'activeRemoteGameId' };
    const row = records.find(row => row.status === 'PLAYING' && !row.localSync && !row.id.startsWith('trial-') &&
      (row.mode === 'local' || authenticated && /^[0-9a-f]{32}$/.test(row.id) &&
        wx.getStorageSync(keys[row.mode]) === row.id));
    if (row) result.unshift({ id: row.id, kind: 'game', title: '继续上次对局',
      detail: `${row.mode === 'ai' ? '与电脑' + (row.aiLevel ? ' · ' + AI_LEVEL_LABELS[row.aiLevel] : '')
        : row.mode === 'online' ? '联机对弈' : '同机双人'} · ${row.turns} 手`,
      route: row.mode === 'online' ? `/pages/online/online?gameId=${encodeURIComponent(row.id)}`
        : `/pages/game/game?mode=${row.mode}&gameId=${encodeURIComponent(row.id)}` });
  } catch { /* optional active slot */ }
  return result;
}
