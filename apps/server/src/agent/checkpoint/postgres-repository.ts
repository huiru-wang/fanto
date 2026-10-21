import { sql, type Kysely } from "kysely";
import type { Entry, UsageRow } from "@earendil-works/pi-agent-core";
import type { DB } from "../../infrastructure/database/schema.js";
import { decodeEntry, decodeUsage, json, safeNumber, payloadForEntry, type PgEntryRow, type PgUsageRow } from "./codec.js";

export type CheckpointItem =
  | { kind: "entry"; entry: Entry; runId: string | null }
  | { kind: "usage"; row: UsageRow; runId: string | null };

export type StoredSession = {
  id: string; userId: string; agentId: string; scopeKey?: string; createdAt: number;
  updatedAt: number; title: string | null; tipId: string | null;
};

export class CheckpointRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async createSession(id: string, userId: string, agentId: string, scopeKey: string): Promise<void> {
    const now = Date.now();
    await sql`INSERT INTO agent_session.sessions
      (id, created_at, next_seq, user_id, agent_id, scope_key, updated_at)
      VALUES (${id}, ${now}, 0, ${userId}, ${agentId}, ${scopeKey}, ${now})`.execute(this.db);
  }

  async getSession(id: string, userId?: string): Promise<StoredSession | undefined> {
    const owner = userId === undefined ? sql`TRUE` : sql`user_id = ${userId}`;
    const result = await sql<{
      id: string; user_id: string; agent_id: string; scope_key: string; created_at: string | number;
      updated_at: string | number; title: string | null; tip_entry_id: string | null;
    }>`SELECT id, user_id, agent_id, scope_key, created_at, updated_at, title, tip_entry_id
      FROM agent_session.sessions WHERE id = ${id} AND ${owner}
        AND user_id IS NOT NULL AND agent_id IS NOT NULL`.execute(this.db);
    const row = result.rows[0];
    return row ? { id: row.id, userId: row.user_id, agentId: row.agent_id, scopeKey: row.scope_key,
      createdAt: safeNumber(row.created_at, "session.created_at"),
      updatedAt: safeNumber(row.updated_at, "session.updated_at"),
      title: row.title, tipId: row.tip_entry_id } : undefined;
  }

  async persist(id: string, items: readonly CheckpointItem[]): Promise<void> {
    if (items.length === 0) return;
    await this.db.transaction().execute(async trx => {
      const result = await sql<{ next_seq: string | number }>`
        SELECT next_seq FROM agent_session.sessions WHERE id = ${id} AND user_id IS NOT NULL FOR UPDATE`.execute(trx);
      if (!result.rows[0]) throw new Error("Checkpoint session not found");
      let nextSeq = safeNumber(result.rows[0].next_seq, "session.next_seq");
      const entryRows: ReturnType<typeof sql>[] = [];
      const usageRows: ReturnType<typeof sql>[] = [];
      const assistantByEntry = new Map(items.flatMap(item =>
        item.kind === "entry" && item.entry.type === "message" && item.entry.message.role === "assistant"
          ? [[item.entry.id, { provider: item.entry.message.provider, model: item.entry.message.model }] as const]
          : []));
      let tip: string | null = null;
      for (const item of items) {
        const seq = nextSeq++;
        if (item.kind === "entry") {
          const e = item.entry;
          entryRows.push(sql`(${id}, ${e.id}, ${e.parentId}, ${seq}, ${e.type},
            ${e.type === "custom" ? e.customType : null}, ${e.timestamp},
            ${json(payloadForEntry(e))}::jsonb, ${item.runId})`);
          tip = e.id;
        } else {
          const r = item.row;
          const details = r.details === undefined ? null : json(r.details);
          const source = assistantByEntry.get(r.entryId ?? "");
          usageRows.push(sql`(${id}, ${r.id}, ${seq}, ${r.entryId ?? null},
            ${r.adjustment}, ${json(r.usage)}::jsonb, ${details}::jsonb, ${item.runId},
            ${Date.now()}, ${source?.provider ?? null}, ${source?.model ?? null})`);
        }
      }
      if (entryRows.length) {
        await sql`INSERT INTO agent_session.entries
          (session_id,id,parent_id,seq,type,custom_type,timestamp,payload,run_id)
          VALUES ${sql.join(entryRows)}
          ON CONFLICT (session_id,id) DO NOTHING`.execute(trx);
      }
      if (usageRows.length) {
        await sql`INSERT INTO agent_session.usage_ledger
          (session_id,id,seq,entry_id,adjustment,usage,details,run_id,created_at,provider,model)
          VALUES ${sql.join(usageRows)}
          ON CONFLICT (session_id,id) DO NOTHING`.execute(trx);
      }
      const now = Date.now();
      if (tip) {
        await sql`UPDATE agent_session.sessions SET next_seq = ${nextSeq},
          updated_at = ${now}, tip_entry_id = ${tip} WHERE id = ${id}`.execute(trx);
      } else {
        await sql`UPDATE agent_session.sessions SET next_seq = ${nextSeq},
          updated_at = ${now} WHERE id = ${id}`.execute(trx);
      }
    });
  }

  async loadEntries(id: string): Promise<Entry[]> {
    const result = await sql<PgEntryRow>`
      SELECT id, parent_id, seq, type, custom_type, timestamp, payload
      FROM agent_session.entries WHERE session_id = ${id} ORDER BY seq ASC`.execute(this.db);
    return result.rows.map(decodeEntry);
  }

  async loadUsage(id: string): Promise<UsageRow[]> {
    const result = await sql<PgUsageRow>`
      SELECT id, seq, entry_id, adjustment, usage, details
      FROM agent_session.usage_ledger WHERE session_id = ${id} ORDER BY seq ASC`.execute(this.db);
    return result.rows.map(decodeUsage);
  }

  async history(id: string, cursor: number | undefined, limit: number): Promise<{ entries: Entry[]; hasMore: boolean; nextCursor: number | null }> {
    const cutoff = cursor === undefined ? sql`TRUE` : sql`MIN(seq) < ${cursor}`;
    const result = await sql<{ run_id: string; start_seq: string | number }>`
      SELECT run_id, MIN(seq) AS start_seq FROM agent_session.entries
      WHERE session_id = ${id} AND run_id IS NOT NULL
      GROUP BY run_id HAVING ${cutoff} ORDER BY start_seq DESC LIMIT ${limit + 1}`.execute(this.db);
    const hasMore = result.rows.length > limit;
    const runRows = result.rows.slice(0, limit);
    if (!runRows.length) return { entries: [], hasMore: false, nextCursor: null };
    const ids = runRows.map(row => sql`${row.run_id}`);
    const entries = await sql<PgEntryRow>`
      SELECT id, parent_id, seq, type, custom_type, timestamp, payload
      FROM agent_session.entries WHERE session_id = ${id} AND run_id IN (${sql.join(ids)})
      ORDER BY seq ASC`.execute(this.db);
    return { entries: entries.rows.map(decodeEntry), hasMore,
      nextCursor: hasMore ? safeNumber(runRows[runRows.length - 1]!.start_seq, "run.cursor") : null };
  }

  async list(userId: string, agentId: string, cursor: string | undefined, limit: number) {
    let cutoff = sql`TRUE`;
    if (cursor) {
      let value: { updatedAt?: number; id?: string };
      try { value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as typeof value; }
      catch { throw new Error("Invalid session list cursor"); }
      if (!Number.isSafeInteger(value.updatedAt) || typeof value.id !== "string"
        || !/^[0-9a-f-]{36}$/i.test(value.id)) throw new Error("Invalid session list cursor");
      cutoff = sql`(updated_at, id) < (${value.updatedAt!}, ${value.id})`;
    }
    const result = await sql<{id:string;agent_id:string;title:string|null;created_at:number|string;updated_at:number|string}>`
      SELECT id, agent_id, title, created_at, updated_at FROM agent_session.sessions
      WHERE user_id = ${userId} AND agent_id = ${agentId} AND ${cutoff}
      ORDER BY updated_at DESC, id DESC LIMIT ${limit + 1}`.execute(this.db);
    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    const tail = rows.at(-1);
    return { data: rows.map(row => ({ sessionId: row.id, agentId: row.agent_id, title: row.title,
      createdAt: new Date(safeNumber(row.created_at, "created_at")).toISOString(),
      updatedAt: new Date(safeNumber(row.updated_at, "updated_at")).toISOString() })),
      hasMore, nextCursor: hasMore && tail
        ? Buffer.from(JSON.stringify({ updatedAt: safeNumber(tail.updated_at, "updated_at"), id: tail.id })).toString("base64url")
        : null };
  }
}
