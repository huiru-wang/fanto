import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { RecordDto, RecordReadDto, TopicDto } from '@fanto/shared';
import { USER_ID } from './model';

export class ApiError extends Error {
  constructor(message: string, public status = 0, public uncertain = false) { super(message); }
}
export async function request<T>(path: string, method: 'GET' | 'POST' | 'PATCH' = 'GET', data?: object): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), path === '/contemplate' ? 180000 : 20000);
  try {
    const response = await fetch(`/api${path}`, {
      method, signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-user-id': USER_ID },
      body: data ? JSON.stringify(data) : undefined,
    });
    const body = await response.json();
    if (!response.ok || !body || body.success !== true) {
      const message = response.status === 404 ? '内容不存在或已被移除。' : response.status === 409 ? '正在整理，请稍后再试。' : body?.errorMsg || `请求失败（${response.status}）`;
      throw new ApiError(message, response.status, method !== 'GET' && response.status >= 500);
    }
    return body.result as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(method === 'GET' ? '连接失败，请检查网络或后端服务。' : '未确认是否保存，请先查看最新记录。', 0, method !== 'GET');
  } finally { window.clearTimeout(timer); }
}
export type Page<T> = { data: T[]; nextCursor: string | null; hasMore: boolean };
export function useList<T extends RecordReadDto | TopicDto>(kind: 'records' | 'topics', topicId?: string) {
  return useInfiniteQuery({ queryKey: [kind, 'list', topicId || ''], initialPageParam: '',
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '20' });
      if (pageParam) params.set('cursor', pageParam);
      if (topicId) params.set('topicId', topicId);
      const page = await request<Page<T>>(`/${kind}?${params}`);
      if (!page || !Array.isArray(page.data) || typeof page.hasMore !== 'boolean' || (page.hasMore && typeof page.nextCursor !== 'string')) throw new ApiError('服务返回的分页数据不完整。');
      return page;
    },
    getNextPageParam: last => last.hasMore && last.nextCursor ? last.nextCursor : undefined,
  });
}
export function useRecord(id: string) { return useQuery({ queryKey: ['records', 'detail', id], queryFn: () => request<RecordReadDto>(`/records/${encodeURIComponent(id)}`), enabled: !!id }); }
export function useTopic(id: string) { return useQuery({ queryKey: ['topics', 'detail', id], queryFn: () => request<TopicDto>(`/topics/${encodeURIComponent(id)}`), enabled: !!id }); }
export const createRecord = (text: string) => request<RecordDto>('/records', 'POST', { text, media: [], source: 'home' });
export const updateRecord = (id: string, text: string, record: RecordReadDto) => request<RecordDto>(`/records/${encodeURIComponent(id)}`, 'PATCH', { text, media: record.content.blocks.map(block => ({ mediaId: block.mediaId, ...('transcript' in block && block.transcript ? { transcript: block.transcript } : {}) })), expectedVersion: record.version });
