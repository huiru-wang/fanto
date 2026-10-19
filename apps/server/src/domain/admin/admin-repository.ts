import { sql, type Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";

export type UsageTotals = {
  input: number; output: number; cacheRead: number; cacheWrite: number;
  totalTokens: number; estimatedCost: number;
};
export type SessionRow = { sessionId: string; userId: string; agentId: string; title: string | null; createdAt: string; updatedAt: string };
export type UserRow = { userId: string; nickname: string; status: "active" | "disabled"; createdAt: string; lastLoginAt: string | null; providers: string[] };

type UsageAgg = { input: string | number | null; output: string | number | null; cache_read: string | number | null; cache_write: string | number | null; total_tokens: string | number | null; estimated_cost: string | number | null };
type UserDbRow = { user_id: string; nickname: string | null; status: "active" | "disabled"; created_at: Date; last_login_at: Date | null; providers: string[] };
type SessionDbRow = { id: string; user_id: string; agent_id: string; title: string | null; created_at: number | string; updated_at: number | string };
export const EMPTY_USAGE: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, estimatedCost: 0 };

function safeNumber(value: string | number | null | undefined): number {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER) throw new Error("Usage aggregate exceeds supported numeric range");
  return number;
}
export function usageFromAggregate(row?: UsageAgg): UsageTotals {
  if (!row) return { ...EMPTY_USAGE };
  return { input: safeNumber(row.input), output: safeNumber(row.output), cacheRead: safeNumber(row.cache_read),
    cacheWrite: safeNumber(row.cache_write), totalTokens: safeNumber(row.total_tokens), estimatedCost: safeNumber(row.estimated_cost) };
}
const metrics = sql`COALESCE(SUM((u.usage->>'input')::numeric),0) AS input,
  COALESCE(SUM((u.usage->>'output')::numeric),0) AS output,
  COALESCE(SUM((u.usage->>'cacheRead')::numeric),0) AS cache_read,
  COALESCE(SUM((u.usage->>'cacheWrite')::numeric),0) AS cache_write,
  COALESCE(SUM((u.usage->>'totalTokens')::numeric),0) AS total_tokens,
  COALESCE(SUM((u.usage->'cost'->>'total')::numeric),0) AS estimated_cost`;
const toUser = (row: UserDbRow): UserRow => ({ userId: row.user_id, nickname: row.nickname ?? "你", status: row.status,
  createdAt: row.created_at.toISOString(), lastLoginAt: row.last_login_at?.toISOString() ?? null, providers: row.providers });
const toSession = (row: SessionDbRow): SessionRow => ({ sessionId: row.id, userId: row.user_id,
  agentId: row.agent_id, title: row.title, createdAt: new Date(safeNumber(row.created_at)).toISOString(),
  updatedAt: new Date(safeNumber(row.updated_at)).toISOString() });

/** Separate, read-only SQL projection. Does not import the Agent runtime or checkpoint repositories. */
export class AdminRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async listUsers(args: { limit: number; query?: string; status?: "active" | "disabled"; before?: { createdAt: string; userId: string } }) {
    const query = args.query ? `%${args.query.replace(/[!%_]/g, "!$&")}%` : undefined;
    const search = query ? sql`(u.user_id ILIKE ${query} ESCAPE '!' OR p.nickname ILIKE ${query} ESCAPE '!')` : sql`TRUE`;
    const status = args.status ? sql`u.status = ${args.status}` : sql`TRUE`;
    const before = args.before ? sql`(u.created_at, u.user_id) < (${new Date(args.before.createdAt)}, ${args.before.userId})` : sql`TRUE`;
    const rows = await sql<UserDbRow>`SELECT u.user_id, u.status, u.created_at, p.nickname,
      COALESCE((SELECT ARRAY_AGG(DISTINCT i.provider ORDER BY i.provider) FROM user_login_identities i
        WHERE i.user_id=u.user_id AND i.revoked_at IS NULL), ARRAY[]::text[]) AS providers,
      (SELECT MAX(i.last_used_at) FROM user_login_identities i WHERE i.user_id=u.user_id AND i.revoked_at IS NULL) AS last_login_at
      FROM users u LEFT JOIN user_profiles p ON p.user_id=u.user_id
      WHERE ${search} AND ${status} AND ${before}
      ORDER BY u.created_at DESC, u.user_id DESC LIMIT ${args.limit + 1}`.execute(this.db);
    return { data: rows.rows.slice(0, args.limit).map(toUser), hasMore: rows.rows.length > args.limit };
  }

  async getUser(userId: string): Promise<UserRow | undefined> {
    const rows = await sql<UserDbRow>`SELECT u.user_id, u.status, u.created_at, p.nickname,
      COALESCE((SELECT ARRAY_AGG(DISTINCT i.provider ORDER BY i.provider) FROM user_login_identities i
        WHERE i.user_id=u.user_id AND i.revoked_at IS NULL), ARRAY[]::text[]) AS providers,
      (SELECT MAX(i.last_used_at) FROM user_login_identities i WHERE i.user_id=u.user_id AND i.revoked_at IS NULL) AS last_login_at
      FROM users u LEFT JOIN user_profiles p ON p.user_id=u.user_id WHERE u.user_id=${userId}`.execute(this.db);
    return rows.rows[0] ? toUser(rows.rows[0]) : undefined;
  }

  async usageForUsers(userIds: string[]): Promise<Map<string, { sessionCount: number; usage: UsageTotals }>> {
    const result = new Map<string, { sessionCount: number; usage: UsageTotals }>();
    if (!userIds.length) return result;
    const ids = sql.join(userIds.map(id => sql`${id}`));
    const rows = await sql<UsageAgg & { user_id: string; session_count: number | string }>`
      SELECT s.user_id, COUNT(DISTINCT s.id) AS session_count, ${metrics}
      FROM agent_session.sessions s LEFT JOIN agent_session.usage_ledger u ON u.session_id=s.id
      WHERE s.user_id IN (${ids}) GROUP BY s.user_id`.execute(this.db);
    for (const row of rows.rows) result.set(row.user_id, { sessionCount: safeNumber(row.session_count), usage: usageFromAggregate(row) });
    return result;
  }

  async listSessions(userId: string, args: { limit: number; agentId?: string; before?: { updatedAt: number; sessionId: string } }) {
    const agent = args.agentId ? sql`agent_id = ${args.agentId}` : sql`TRUE`;
    const before = args.before ? sql`(updated_at, id) < (${args.before.updatedAt}, ${args.before.sessionId})` : sql`TRUE`;
    const rows = await sql<SessionDbRow>`SELECT id,user_id,agent_id,title,created_at,updated_at
      FROM agent_session.sessions WHERE user_id=${userId} AND ${agent} AND ${before}
      ORDER BY updated_at DESC,id DESC LIMIT ${args.limit + 1}`.execute(this.db);
    return { data: rows.rows.slice(0, args.limit).map(toSession), hasMore: rows.rows.length > args.limit };
  }

  async usageForSessions(sessionIds: string[]): Promise<Map<string, UsageTotals>> {
    const result = new Map<string, UsageTotals>();
    if (!sessionIds.length) return result;
    const ids = sql.join(sessionIds.map(id => sql`${id}`));
    const rows = await sql<UsageAgg & { session_id: string }>`SELECT u.session_id, ${metrics}
      FROM agent_session.usage_ledger u WHERE u.session_id IN (${ids}) GROUP BY u.session_id`.execute(this.db);
    for (const row of rows.rows) result.set(row.session_id, usageFromAggregate(row));
    return result;
  }

  async getSession(sessionId: string): Promise<SessionRow | undefined> {
    const rows = await sql<SessionDbRow>`SELECT id,user_id,agent_id,title,created_at,updated_at
      FROM agent_session.sessions WHERE id=${sessionId}`.execute(this.db);
    return rows.rows[0] ? toSession(rows.rows[0]) : undefined;
  }

  async sessionModels(sessionId: string) {
    const rows = await sql<UsageAgg & { provider: string; model: string }>`
      SELECT COALESCE(u.provider,'unknown') AS provider, COALESCE(u.model,'unknown') AS model, ${metrics}
      FROM agent_session.usage_ledger u WHERE u.session_id=${sessionId}
      GROUP BY u.provider,u.model ORDER BY total_tokens DESC,provider,model`.execute(this.db);
    return rows.rows.map(row => ({ provider: row.provider, model: row.model, usage: usageFromAggregate(row) }));
  }
}
