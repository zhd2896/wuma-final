/** Server room deadlines are UTC; older servers omit the timezone suffix. */
export function roomCountdown(expiresAt: string, now = Date.now()): string {
  const zoned = /(?:Z|[+-]\d\d:\d\d)$/i.test(expiresAt) ? expiresAt : `${expiresAt}Z`;
  const deadline = Date.parse(zoned);
  if (!Number.isFinite(deadline)) return '有效期暂无法确认，请刷新';
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  if (!seconds) return '等待期限已到，正在确认房间状态';
  return `剩余 ${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒`;
}
