export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; estimatedCost: number };
export type User = { userId: string; nickname: string; status: "active" | "disabled"; createdAt: string; lastLoginAt: string | null; providers: string[] };
export type UserSummary = User & { sessionCount: number; usage: Usage };
export type Session = { sessionId: string; userId: string; agentId: string; title: string | null; createdAt: string; updatedAt: string; usage: Usage };
export type Page<T> = { data: T[]; hasMore: boolean; nextCursor: string | null };
export type UserUsage = { userId: string; sessionCount: number; usage: Usage };
export type SessionUsage = { session: Omit<Session, "usage">; usage: Usage; models: { provider: string; model: string; usage: Usage }[] };
export class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }

export async function request<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` }, cache: "no-store" });
  const body = await response.json().catch(() => null) as { result?: T; errorMsg?: string; success?: boolean } | null;
  if (!response.ok || body?.success !== true) throw new ApiError(body?.errorMsg ?? `请求失败（${response.status}）`, response.status);
  return body.result as T;
}
export const adminApi = {
  users: (token: string, params: URLSearchParams) => request<Page<UserSummary>>(`/api/admin/users?${params}`, token),
  user: (token: string, id: string) => request<User>(`/api/admin/users/${encodeURIComponent(id)}`, token),
  userUsage: (token: string, id: string) => request<UserUsage>(`/api/admin/users/${encodeURIComponent(id)}/usage`, token),
  sessions: (token: string, id: string, params: URLSearchParams) => request<Page<Session>>(`/api/admin/users/${encodeURIComponent(id)}/sessions?${params}`, token),
  sessionUsage: (token: string, id: string) => request<SessionUsage>(`/api/admin/sessions/${encodeURIComponent(id)}/usage`, token),
};
