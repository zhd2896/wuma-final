import { AI_LEVEL_LABELS, isAiLevel } from '../../services/api-contract';
import { createWxDeviceHistoryStore } from '../../services/device-history';
import type { DeviceHistoryEntry } from '../../services/device-history';
import { ApiError, createApiClient, messageForApiError } from '../../services/api-client';
import { createAccountApi } from '../../services/account-api';
import type { PersonalGameDto } from '../../services/account-api';
import { syncLocalScore } from '../../services/local-score-sync';
import { getApiBaseUrl } from '../../config/api';
import { getSavedWechatToken } from '../../services/device-auth';
import { openPage } from '../../utils/navigation';

type HistoryMode = DeviceHistoryEntry['mode'];
interface HistoryRow {
  readonly id: string;
  readonly mode: HistoryMode;
  readonly status: DeviceHistoryEntry['status'];
  readonly title: string;
  readonly result: string;
  readonly date: string;
  readonly updatedAt: number;
  readonly turns: number;
  readonly action: string;
  readonly localId?: string;
  readonly apiRoot?: string;
  readonly syncLabel?: string;
  readonly syncing?: boolean;
  readonly syncReason?: string;
  readonly archived?: boolean;
}
function dateText(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function rowForDevice(entry: DeviceHistoryEntry): HistoryRow {
  const archived = entry.id.startsWith('trial-');
  const finished = entry.status === 'FINISHED';
  const linked = entry.localSync?.status === 'linked' ? entry.localSync : null;
  return { id: linked?.cloudGameId ?? entry.id, mode: linked ? 'remote' : entry.mode, status: entry.status,
    localId: entry.mode === 'local' ? entry.id : undefined, apiRoot: linked?.apiRoot,
    syncLabel: entry.mode !== 'local' || linked ? undefined
      : entry.localSync?.status === 'pending' ? '重试保存' : entry.localScore
        ? (archived || finished ? '保存到云端' : '转到云端继续') : undefined,
    syncReason: linked ? '已同步到云端'
      : entry.localSync?.status === 'pending' ? '结果待确认，棋谱已冻结；需原账号和原服务重试'
      : entry.mode === 'local' && !entry.localScore ? '旧记录缺少完整棋谱，无法同步' : undefined,
    archived, title: archived ? '电脑试玩棋谱' : entry.mode === 'ai' ? `AI 对弈${entry.aiLevel ? ' · ' + AI_LEVEL_LABELS[entry.aiLevel] : ''}` : entry.mode === 'online' ? '联机对弈' : '同机双人',
    result: archived ? '已归档 · 试玩结束' : finished ? (entry.winnerReason === 'RESIGN' && entry.winner
      ? `${entry.winner === 'A' ? '红方' : '黑方'}认输 · ${entry.winner === 'A' ? '黑方' : '红方'}获胜`
      : entry.winner ? `${entry.winner === 'A' ? '黑方' : '红方'}获胜` : '已结束') : '进行中',
    date: dateText(entry.updatedAt), updatedAt: entry.updatedAt, turns: entry.turns,
    action: archived ? '查看棋谱' : finished ? (entry.mode === 'online' || entry.mode === 'ai' || linked ? '查看复盘' : '查看终局') : '继续对弈' };
}
function rowForCloud(entry: PersonalGameDto): HistoryRow {
  const archived = entry.sourceKind === 'TRIAL';
  const finished = entry.status === 'FINISHED';
  const updatedAt = Date.parse(entry.finishedAt || entry.startedAt);
  return { id: entry.gameId, mode: entry.mode === 'AI' ? 'ai' : entry.mode === 'REMOTE' ? 'online' : 'remote',
    status: entry.status, archived, title: archived ? '电脑试玩棋谱' : entry.mode === 'AI' ? `AI 对弈${isAiLevel(entry.aiLevel) ? ' · ' + AI_LEVEL_LABELS[entry.aiLevel] : ''}` : entry.mode === 'REMOTE' ? `联机对弈 · 你执${entry.seat === 'B' ? '红棋' : '黑棋'}` : '同机双人 · 云端保存',
    result: archived ? '已归档 · 试玩结束' : finished ? (entry.winnerReason === 'RESIGN' && entry.winner
      ? `${entry.winner === 'A' ? '红方' : '黑方'}认输 · ${entry.winner === 'A' ? '黑方' : '红方'}获胜`
      : entry.winner ? `${entry.winner === 'A' ? '黑方' : '红方'}获胜` : '已结束') : '进行中',
    date: dateText(updatedAt), updatedAt, turns: entry.turns,
    action: archived ? '查看棋谱' : finished ? '查看复盘' : '继续对弈' };
}

Page({
  data: { records: [] as HistoryRow[], state: 'loading', filter: 'all',
    cloudLoading: false, cloudFailed: false,
    filterLabels: ['全部记录', '已结束', '可复盘'], filterIndex: 0,
    errorMessage: '', emptyTitle: '还没有对局记录',
    emptySubtitle: '开始一局对弈后，这里会保存真实记录',
    emptyAction: '开始对弈', nextCursor: null as string | null, showSyncConfirm: false, syncTargetId: '' },
  cloud: [] as PersonalGameDto[],
  loadingCloud: false,
  loadGeneration: 0, pageVisible: true,
  syncBusy: new Set<string>(),
  onHide() { this.pageVisible = false; this.loadGeneration += 1; this.loadingCloud = false; },
  onUnload() { this.pageVisible = false; this.loadGeneration += 1; this.loadingCloud = false; },
  onLoad(options: { filter?: string }) {
    this.pageVisible = true; this.syncBusy = new Set<string>();
    this.setData({ filter: options.filter === 'finished' || options.filter === 'reviewable'
      ? options.filter : 'all', filterIndex: options.filter === 'finished' ? 1 : options.filter === 'reviewable' ? 2 : 0 });
    this.load();
  },
  onShow() { this.pageVisible = true; this.load(); },
  load() {
    this.loadGeneration += 1; this.loadingCloud = false;
    try {
      this.cloud = [];
      this.setData({ nextCursor: null, errorMessage: '', cloudFailed: false, cloudLoading: typeof wx.request === 'function' });
      this.renderRows();
      if (typeof wx.request === 'function') void this.loadCloud(false);
    } catch {
      this.setData({ records: [], state: 'error', errorMessage: '本机历史记录读取失败' });
    }
  },
  renderRows() {
    const local = createWxDeviceHistoryStore().list().filter(item =>
      item.mode === 'local' || item.mode === 'online' || item.mode === 'ai').map(rowForDevice).map(row =>
        row.localId && this.syncBusy.has(row.localId) ? { ...row, syncing: true,
          syncLabel: '同步中', syncReason: '正在同步，棋谱将冻结并由云端继续' } : row);
    const cloud = this.cloud.map(rowForCloud).map(row => {
      const archive = local.find(item => item.id === row.id && item.archived);
      return archive ? { ...row, archived: true, title: '电脑试玩棋谱', result: '已归档 · 试玩结束', action: '查看棋谱' } : row;
    });
    const ids = new Set(cloud.map(item => item.id));
    const records = [...local.filter(item => !ids.has(item.id)), ...cloud].filter(item => this.data.filter === 'all' ||
      (!item.archived && item.status === 'FINISHED' &&
        (this.data.filter !== 'reviewable' || item.mode === 'ai' || item.mode === 'remote' || item.mode === 'online')))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    this.setData({ records, state: records.length ? 'success' : this.data.cloudLoading ? 'loading' : this.data.cloudFailed ? 'error' : 'empty',
      emptyTitle: this.data.filter === 'reviewable' ? '还没有可复盘的棋局'
        : this.data.filter === 'finished' ? '还没有已结束的棋局' : '还没有对局记录',
      emptySubtitle: this.data.filter === 'reviewable'
        ? '完成一局 AI、云端或远程双人对弈后，可从这里进入复盘'
        : '开始一局对弈后，这里会保存真实记录',
      emptyAction: this.data.filter === 'reviewable' ? '开始 AI 对弈' : '开始对弈' });
  },
  async loadCloud(more: boolean) {
    if (this.loadingCloud) return;
    this.loadingCloud = true;
    this.setData({ cloudLoading: true, cloudFailed: false, errorMessage: '' });
    try { this.renderRows(); }
    catch { this.loadingCloud = false; this.setData({ cloudLoading: false, state: 'error', errorMessage: '本机历史记录读取失败，请重试' }); return; }
    const generation = this.loadGeneration;
    let root: string;
    let token: string | null;
    try { root = getApiBaseUrl(); token = getSavedWechatToken(root); }
    catch (error) {
      this.loadingCloud = false;
      this.setData({ cloudLoading: false, cloudFailed: true, errorMessage: messageForApiError(error),
        ...(this.data.records.length ? {} : { state: 'error' }) });
      return;
    }
    const filter = this.data.filter;
    const current = () => {
      try { return generation === this.loadGeneration && root === getApiBaseUrl() &&
        token === getSavedWechatToken(root) && filter === this.data.filter; }
      catch { return false; }
    };
    if (!more) {
      this.setData({ nextCursor: null });
    }
    try {
      const response = await createAccountApi(createApiClient()).games(20,
        more ? this.data.nextCursor || undefined : undefined,
        this.data.filter === 'all' ? undefined : 'FINISHED');
      if (!current()) return;
      const previous = more ? this.cloud : [];
      const known = new Set(previous.map(item => item.gameId));
      this.cloud = [...previous, ...response.items.filter(item => !known.has(item.gameId))];
      this.setData({ nextCursor: response.nextCursor, errorMessage: '', cloudLoading: false, cloudFailed: false });
      this.renderRows();
    } catch (error) {
      if (!current()) return;
      const message = messageForApiError(error);
      this.setData({ errorMessage: message, cloudLoading: false, cloudFailed: true,
        ...(this.data.records.length ? {} : { state: 'error' }) });
    } finally {
      if (generation === this.loadGeneration) {
        this.loadingCloud = false;
        if (!current()) {
          this.cloud = [];
          this.setData({ cloudLoading: false, cloudFailed: true, nextCursor: null,
            errorMessage: '登录状态或服务地址已变化，请重新读取云端记录。' });
          try { this.renderRows(); } catch { this.setData({ state: 'error' }); }
        }
      }
    }
  },
  async syncRecord(event: WechatMiniprogram.TouchEvent) {
    const localId = event.currentTarget.dataset.localId as string;
    let row: DeviceHistoryEntry | null;
    try { row = createWxDeviceHistoryStore().get(localId); }
    catch { this.setData({ errorMessage: '本机棋谱读取失败，请重试' }); return; }
    if (row?.status === 'PLAYING' && !row.localSync && !row.id.startsWith('trial-')) {
      this.setData({ showSyncConfirm: true, syncTargetId: localId }); return;
    }
    await this.performSync(localId);
  },
  cancelSync() { this.setData({ showSyncConfirm: false, syncTargetId: '' }); },
  async confirmSync() {
    const id = this.data.syncTargetId;
    if (!this.data.showSyncConfirm || !id) return;
    this.cancelSync(); await this.performSync(id);
  },
  async performSync(localId: string) {
    if (!localId || this.syncBusy.has(localId)) return;
    this.syncBusy.add(localId);
    const generation = this.loadGeneration;
    try {
      const task = syncLocalScore(localId, { onPending: () => {
        if (generation === this.loadGeneration) this.renderRows();
      } });
      // Re-read the store as soon as pending is saved, and again on either outcome.
      this.renderRows();
      await task;
      if (generation !== this.loadGeneration) return;
      wx.showToast({ title: '棋谱同步成功', icon: 'success' });
      this.load();
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      const message = error instanceof Error && !(error instanceof ApiError)
        ? error.message : messageForApiError(error);
      this.setData({ errorMessage: message });
      this.renderRows();
    } finally {
      this.syncBusy.delete(localId);
      if (this.pageVisible) this.renderRows();
    }
  },
  more() { if (this.data.nextCursor) void this.loadCloud(true); },
  retryCloud() { void this.loadCloud(false); },
  changeFilter(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const index = Number(event.detail.value);
    const filter = ['all', 'finished', 'reviewable'][index];
    if (!filter || filter === this.data.filter) return;
    this.setData({ filter, filterIndex: index }); this.load();
  },
  back() { wx.navigateBack({ delta: 1 }); },
  startGame() { openPage('/pages/game/game'); },
  retry() { this.load(); },
  openRecord(event: WechatMiniprogram.TouchEvent) {
    const id = event.currentTarget.dataset.id as string;
    const row = this.data.records.find(item => item.id === id);
    if (!row) return;
    if (row.apiRoot && row.apiRoot !== getApiBaseUrl()) {
      wx.showToast({ title: '请恢复棋谱同步时的服务地址后打开', icon: 'none' }); return;
    }
    const encoded = encodeURIComponent(id);
    if (row.archived) openPage(`/pages/record/record?${row.mode === 'local' ? 'localId' : 'gameId'}=${encoded}`);
    else if (row.mode === 'online') openPage(row.status === 'FINISHED'
      ? `/pages/review/review?mode=online&gameId=${encoded}`
      : `/pages/online/online?gameId=${encoded}`);
    else if (row.status === 'FINISHED' && row.mode !== 'local')
      openPage(`/pages/review/review?gameId=${encoded}`);
    else openPage(`/pages/game/game?mode=${row.mode}&gameId=${encoded}`);
  },
});
