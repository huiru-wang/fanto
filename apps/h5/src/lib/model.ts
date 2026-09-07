export const USER_ID = 'default-user';
export const statusLabels: Record<string, string> = {
  pending: '待整理', processing: '整理中', organized: '已整理', skipped: '暂未归入话题', updated: '内容已修改，待重新整理',
};
export function organization(ext: { [key: string]: unknown } | null) {
  const value = ext?.organization;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.taskId !== 'string' || typeof v.organizedAt !== 'string') return null;
  return {
    taskId: v.taskId, organizedAt: v.organizedAt,
    reason: typeof v.reason === 'string' ? v.reason : '',
    summary: typeof v.summary === 'string' ? v.summary : '',
    action: typeof v.action === 'string' ? v.action : '',
    recordIds: Array.isArray(v.recordIds) ? v.recordIds.filter((id): id is string => typeof id === 'string') : [],
  };
}
export function uniqueItems<T extends { id: string }>(pages: { data: T[] }[] | undefined): T[] {
  return [...new Map((pages || []).flatMap(p => p.data).map(item => [item.id, item])).values()];
}
export function afterSave(current: string, submitted: string) { return current === submitted ? '' : current; }
export function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
