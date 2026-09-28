import { createWxDeviceHistoryStore } from '../../services/device-history';
import type { DeviceHistoryEntry } from '../../services/device-history';
import { createApiClient, messageForApiError } from '../../services/api-client';
import { createAccountApi } from '../../services/account-api';
import type { PersonalGameDto } from '../../services/account-api';
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
}
function dateText(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function rowForDevice(entry: DeviceHistoryEntry): HistoryRow {
  const finished = entry.status === 'FINISHED';
  return { id: entry.id, mode: entry.mode, status: entry.status,
    title: entry.mode === 'online' ? '远程双人' : '本地双人',
    result: finished ? (entry.winner ? `玩家 ${entry.winner} 获胜` : '已结束') : '进行中',
    date: dateText(entry.updatedAt), updatedAt: entry.updatedAt, turns: entry.turns,
    action: finished ? '查看终局' : '继续对弈' };
}
function rowForCloud(entry: PersonalGameDto): HistoryRow {
  const finished = entry.status === 'FINISHED';
  const updatedAt = Date.parse(entry.finishedAt || entry.startedAt);
  return { id: entry.gameId, mode: entry.mode === 'AI' ? 'ai' : 'remote',
    status: entry.status, title: entry.mode === 'AI' ? 'AI 对弈' : '云端双人',
    result: finished ? (entry.winner ? `玩家 ${entry.winner} 获胜` : '已结束') : '进行中',
    date: dateText(updatedAt), updatedAt, turns: entry.turns,
    action: finished ? '查看复盘' : '继续对弈' };
}

Page({
  data: { records: [] as HistoryRow[], state: 'loading', filter: 'all',
    errorMessage: '', emptyTitle: '还没有对局记录',
    emptySubtitle: '开始一局对弈后，这里会保存真实记录',
    emptyAction: '开始对弈', nextCursor: null as string | null },
  cloud: [] as PersonalGameDto[],
  loadingCloud: false,
  onLoad(options: { filter?: string }) {
    this.setData({ filter: options.filter === 'finished' || options.filter === 'reviewable'
      ? options.filter : 'all' });
    this.load();
  },
  onShow() { this.load(); },
  load() {
    try {
      this.cloud = [];
      this.setData({ nextCursor: null });
      this.renderRows();
      if (typeof wx.request === 'function') void this.loadCloud(false);
    } catch {
      this.setData({ records: [], state: 'error', errorMessage: '本机历史记录读取失败' });
    }
  },
  renderRows() {
    const local = createWxDeviceHistoryStore().list().filter(item =>
      item.mode === 'local' || item.mode === 'online').map(rowForDevice);
    const ids = new Set(local.map(item => item.id));
    const cloud = this.cloud.map(rowForCloud).filter(item => !ids.has(item.id));
    const records = [...local, ...cloud].filter(item => this.data.filter === 'all' ||
      (item.status === 'FINISHED' &&
        (this.data.filter !== 'reviewable' || item.mode === 'ai' || item.mode === 'remote')))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    this.setData({ records, state: records.length ? 'success' : 'empty',
      emptyTitle: this.data.filter === 'reviewable' ? '还没有可复盘的棋局'
        : this.data.filter === 'finished' ? '还没有已结束的棋局' : '还没有对局记录',
      emptySubtitle: this.data.filter === 'reviewable'
        ? '完成一局 AI 或云端对弈后，可从这里进入复盘'
        : '开始一局对弈后，这里会保存真实记录',
      emptyAction: this.data.filter === 'reviewable' ? '开始 AI 对弈' : '开始对弈' });
  },
  async loadCloud(more: boolean) {
    if (this.loadingCloud) return;
    this.loadingCloud = true;
    if (!more) {
      this.cloud = [];
      this.setData({ nextCursor: null });
      this.renderRows();
    }
    try {
      const response = await createAccountApi(createApiClient()).games(20,
        more ? this.data.nextCursor || undefined : undefined,
        this.data.filter === 'all' ? undefined : 'FINISHED');
      const previous = more ? this.cloud : [];
      const known = new Set(previous.map(item => item.gameId));
      this.cloud = [...previous, ...response.items.filter(item => !known.has(item.gameId))];
      this.setData({ nextCursor: response.nextCursor, errorMessage: '' });
      this.renderRows();
    } catch (error) {
      const message = messageForApiError(error);
      this.setData({ errorMessage: message,
        ...(this.data.records.length ? {} : { state: 'error' }) });
    } finally { this.loadingCloud = false; }
  },
  more() { if (this.data.nextCursor) void this.loadCloud(true); },
  back() { wx.navigateBack({ delta: 1 }); },
  startGame() { openPage('/pages/game/game'); },
  retry() { this.load(); },
  openRecord(event: WechatMiniprogram.TouchEvent) {
    const id = event.currentTarget.dataset.id as string;
    const row = this.data.records.find(item => item.id === id);
    if (!row) return;
    const encoded = encodeURIComponent(id);
    if (row.mode === 'online') openPage(`/pages/online/online?gameId=${encoded}`);
    else if (row.status === 'FINISHED' && row.mode !== 'local')
      openPage(`/pages/review/review?gameId=${encoded}`);
    else openPage(`/pages/game/game?mode=${row.mode}&gameId=${encoded}`);
  },
});
