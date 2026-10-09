import { sql, type Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
import {
  prepareStorageCommit, resolveListReadOptions, validateCommittedWrites, value,
  type CommittedWrite, type CommitResult, type Context, type Entry, type EntryScan,
  type EntryStructure, type ListElement, type ListReadOptions, type SessionStats,
  type Storage, type StorageBranchScan, type StoredValue, type UsageRow,
  type UsageScan, type Value, type ValueList, type Write,
} from "@earendil-works/pi-agent-core";
import type { SessionDb } from "./pg-queries.js";
import { addUsage } from "./pg-queries.js";
import { decodeEntry, decodeUsage, json, safeNumber, payloadForEntry, type PgEntryRow, type PgUsageRow } from "./pg-codec.js";
import { indexEntry, scanBranch } from "./pg-branches.js";

export interface PgStorageOptions {
  sessionId: string;
  now?: () => number;
}

/**
 * PostgreSQL implementation of the pi-agent-core Storage contract.
 * Uses only standard PostgreSQL SQL, transactions, JSONB and row-level locks.
 * Its Kysely connection is borrowed; closing a Session never destroys the pool.
 */
export class PgStorage implements Storage {
  private readonly sessionId: string;
  private readonly now: () => number;
  private commitQueue: Promise<void> = Promise.resolve();
  private state: "open" | "closing" | "closed" = "open";
  private closePromise?: Promise<void>;

  constructor(private readonly db: Kysely<DB>, options: PgStorageOptions) {
    this.sessionId = options.sessionId;
    this.now = options.now ?? Date.now;
  }

  private assertOpen(): void {
    if (this.state !== "open") throw new Error("PgStorage is closed");
  }

  async commit(writes: Write[], _context: Context): Promise<CommitResult> {
    this.assertOpen();
    const result = this.commitQueue.then(() => this.applyCommit(writes));
    this.commitQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async applyCommit(writes: Write[]): Promise<CommitResult> {
    return this.db.transaction().execute(async trx => {
      // Commit sequence + statistics are serialized per Session, not globally.
      const locked = await sql<{ next_seq: string | number }>`
        SELECT next_seq FROM agent_session.sessions WHERE id = ${this.sessionId} FOR UPDATE
      `.execute(trx);
      if (!locked.rows[0]) throw new Error(`Unknown PG session: ${this.sessionId}`);
      const firstSeq = safeNumber(locked.rows[0].next_seq, "sessions.next_seq");
      const prepared = prepareStorageCommit(writes, firstSeq, this.now());

      const ids = prepared.writes.filter((w): w is Extract<CommittedWrite, { kind: "entry" | "usage" }> =>
        w.kind === "entry" || w.kind === "usage").map(w => w.id);
      const parents = prepared.writes
        .filter((w): w is Extract<CommittedWrite, { kind: "entry" }> => w.kind === "entry")
        .map(w => w.parentId).filter((v): v is string => v !== null);
      const existing = new Set<string>();
      const existingEntries = new Set<string>();
      if (ids.length || parents.length) {
        const lookup = [...new Set([...ids, ...parents])];
        const found = await sql<{ id: string; kind: string }>`
          SELECT id, 'entry' AS kind FROM agent_session.entries
          WHERE session_id = ${this.sessionId} AND id IN (${sql.join(lookup)})
          UNION ALL
          SELECT id, 'usage' AS kind FROM agent_session.usage_ledger
          WHERE session_id = ${this.sessionId} AND id IN (${sql.join(lookup)})
        `.execute(trx);
        for (const row of found.rows) {
          existing.add(row.id);
          if (row.kind === "entry") existingEntries.add(row.id);
        }
      }
      validateCommittedWrites(prepared.writes, firstSeq, {
        hasEntryOrUsageId: id => existing.has(id),
        hasEntryId: id => existingEntries.has(id),
      });

      // Data and every projection must commit or roll back together.
      for (const write of prepared.writes) {
        switch (write.kind) {
          case "entry":
            await this.insertEntry(trx, write);
            await indexEntry(trx, this.sessionId, write);
            if (write.type === "message") {
              await sql`UPDATE agent_session.sessions SET message_count = message_count + 1
                WHERE id = ${this.sessionId}`.execute(trx);
            }
            break;
          case "usage":
            await sql`INSERT INTO agent_session.usage_ledger
              (session_id, id, seq, entry_id, adjustment, usage, details)
              VALUES (${this.sessionId}, ${write.id}, ${write.seq},
                ${write.entryId ?? null}, ${write.adjustment},
                ${json(write.usage)}::jsonb, ${write.details === undefined ? null : json(write.details)}::jsonb)
            `.execute(trx);
            {
              const stats = await this.getStatsFrom(trx);
              const usage = addUsage(stats.usage as ReturnType<typeof import("./pg-queries.js").zeroUsage>, write.usage as ReturnType<typeof import("./pg-queries.js").zeroUsage>);
              await sql`UPDATE agent_session.sessions SET usage_payload = ${json(usage)}::jsonb
                WHERE id = ${this.sessionId}`.execute(trx);
            }
            break;
          case "value":
            if (write.op === "delete") {
              await sql`DELETE FROM agent_session.scalar_values
                WHERE session_id = ${this.sessionId} AND namespace = ${write.namespace} AND key = ${write.key}`.execute(trx);
            } else {
              await sql`INSERT INTO agent_session.scalar_values
                (session_id, namespace, key, seq, value)
                VALUES (${this.sessionId}, ${write.namespace}, ${write.key}, ${write.seq}, ${json(write.value)}::jsonb)
                ON CONFLICT (session_id, namespace, key)
                DO UPDATE SET seq = excluded.seq, value = excluded.value`.execute(trx);
            }
            break;
          case "list":
            if (write.op === "delete") {
              await sql`DELETE FROM agent_session.list_values
                WHERE session_id = ${this.sessionId} AND namespace = ${write.namespace} AND key = ${write.key}`.execute(trx);
            } else {
              await sql`INSERT INTO agent_session.list_values
                (session_id, namespace, key, seq, value)
                VALUES (${this.sessionId}, ${write.namespace}, ${write.key}, ${write.seq}, ${json(write.value)}::jsonb)`.execute(trx);
            }
            break;
        }
      }
      await sql`UPDATE agent_session.sessions SET next_seq = ${firstSeq + prepared.writes.length}
        WHERE id = ${this.sessionId}`.execute(trx);
      return { ...prepared.result, stats: await this.getStatsFrom(trx) };
    });
  }

  async insertEntry(db: SessionDb, entry: Entry): Promise<void> {
    await sql`INSERT INTO agent_session.entries
      (session_id, id, parent_id, seq, type, custom_type, timestamp, payload)
      VALUES (${this.sessionId}, ${entry.id}, ${entry.parentId}, ${entry.seq}, ${entry.type},
        ${entry.type === "custom" ? entry.customType : null}, ${entry.timestamp},
        ${json(payloadForEntry(entry))}::jsonb)`.execute(db);
  }

  async getEntries(ids: string[], _context: Context): Promise<Map<string, Entry>> {
    this.assertOpen();
    if (ids.length === 0) return new Map();
    const rows = await sql<PgEntryRow>`
      SELECT id, parent_id, seq, type, custom_type, timestamp, payload
      FROM agent_session.entries
      WHERE session_id = ${this.sessionId} AND id IN (${sql.join(ids)})
    `.execute(this.db);
    const byId = new Map(rows.rows.map(row => [row.id, decodeEntry(row)]));
    return new Map(ids.flatMap(id => {
      const entry = byId.get(id);
      return entry ? [[id, entry] as const] : [];
    }));
  }

  async getValue<T>(address: Value<T>, _context: Context): Promise<StoredValue<T> | undefined> {
    this.assertOpen();
    const result = await sql<{ seq: string | number; value: T }>`
      SELECT seq, value FROM agent_session.scalar_values
      WHERE session_id = ${this.sessionId} AND namespace = ${address.namespace} AND key = ${address.key}
    `.execute(this.db);
    const row = result.rows[0];
    return row ? { address, seq: safeNumber(row.seq, "scalar_values.seq"), value: row.value } : undefined;
  }

  async scanValues<T>(prefix: Value<T>, _context: Context): Promise<StoredValue<T>[]> {
    this.assertOpen();
    // C collation makes prefix scans deterministic on any PostgreSQL provider.
    // LIKE must escape user-provided %, _ and backslash.
    const escaped = prefix.key.replace(/[\\%_]/g, "\\$&") + "%";
    const rows = await sql<{ key: string; seq: string | number; value: T }>`
      SELECT key, seq, value FROM agent_session.scalar_values
      WHERE session_id = ${this.sessionId} AND namespace = ${prefix.namespace}
        AND key COLLATE "C" LIKE ${escaped} COLLATE "C"
      ORDER BY key COLLATE "C" ASC
    `.execute(this.db);
    return rows.rows.map(row => ({
      address: value<T>(prefix.namespace, row.key),
      seq: safeNumber(row.seq, "scalar_values.seq"), value: row.value,
    }));
  }

  async readList<T>(address: ValueList<T>, options: ListReadOptions | undefined, _context: Context): Promise<ListElement<T>[]> {
    this.assertOpen();
    const resolved = resolveListReadOptions(options);
    const predicates = [
      sql`session_id = ${this.sessionId}`,
      sql`namespace = ${address.namespace}`, sql`key = ${address.key}`,
    ];
    if (resolved.cursor !== undefined) predicates.push(
      resolved.order === "asc" ? sql`seq > ${resolved.cursor.seq}` : sql`seq < ${resolved.cursor.seq}`,
    );
    const order = resolved.order === "asc" ? sql.raw("ASC") : sql.raw("DESC");
    const rows = await sql<{ seq: string | number; value: T }>`
      SELECT seq, value FROM agent_session.list_values
      WHERE ${sql.join(predicates, sql` AND `)}
      ORDER BY seq ${order} LIMIT ${resolved.limit}
    `.execute(this.db);
    return rows.rows.map(row => ({ seq: safeNumber(row.seq, "list_values.seq"), value: row.value }));
  }

  async scanBranch(query: StorageBranchScan, _context: Context): Promise<Entry[]> {
    this.assertOpen();
    return this.db.transaction().setIsolationLevel("repeatable read").execute(trx =>
      scanBranch(trx, this.sessionId, query));
  }

  async scanBranchStructure(query: StorageBranchScan, _context: Context): Promise<EntryStructure[]> {
    this.assertOpen();
    return this.db.transaction().setIsolationLevel("repeatable read").execute(trx =>
      scanBranch(trx, this.sessionId, query, true));
  }

  async scanEntries(query: EntryScan, _context: Context): Promise<Entry[]> {
    this.assertOpen();
    const predicates = [sql`session_id = ${this.sessionId}`];
    if (query.type !== undefined) predicates.push(sql`type = ${query.type}`);
    if (query.customType !== undefined) predicates.push(sql`custom_type = ${query.customType}`);
    if (query.fromSeq !== undefined) predicates.push(sql`seq >= ${query.fromSeq}`);
    if (query.toSeq !== undefined) predicates.push(sql`seq <= ${query.toSeq}`);
    const order = query.order === "desc" ? sql.raw("DESC") : sql.raw("ASC");
    const limit = query.limit === undefined ? sql`` : sql`LIMIT ${Math.max(0, query.limit)}`;
    const rows = await sql<PgEntryRow>`
      SELECT id, parent_id, seq, type, custom_type, timestamp, payload
      FROM agent_session.entries WHERE ${sql.join(predicates, sql` AND `)}
      ORDER BY seq ${order} ${limit}
    `.execute(this.db);
    return rows.rows.map(decodeEntry);
  }

  async scanUsage(query: UsageScan, _context: Context): Promise<UsageRow[]> {
    this.assertOpen();
    const predicates = [sql`session_id = ${this.sessionId}`];
    if (query.fromSeq !== undefined) predicates.push(sql`seq >= ${query.fromSeq}`);
    if (query.toSeq !== undefined) predicates.push(sql`seq <= ${query.toSeq}`);
    const order = query.order === "desc" ? sql.raw("DESC") : sql.raw("ASC");
    const limit = query.limit === undefined ? sql`` : sql`LIMIT ${Math.max(0, query.limit)}`;
    const rows = await sql<PgUsageRow>`
      SELECT id, seq, entry_id, adjustment, usage, details FROM agent_session.usage_ledger
      WHERE ${sql.join(predicates, sql` AND `)} ORDER BY seq ${order} ${limit}
    `.execute(this.db);
    return rows.rows.map(decodeUsage);
  }

  async getStats(_context: Context): Promise<SessionStats> {
    this.assertOpen();
    return this.getStatsFrom(this.db);
  }

  private async getStatsFrom(db: SessionDb): Promise<SessionStats> {
    const result = await sql<{ message_count: string | number; usage_payload: SessionStats["usage"] }>`
      SELECT message_count, usage_payload FROM agent_session.sessions WHERE id = ${this.sessionId}
    `.execute(db);
    const row = result.rows[0];
    if (!row) throw new Error(`Unknown PG session: ${this.sessionId}`);
    return { messageCount: safeNumber(row.message_count, "message_count"), usage: row.usage_payload };
  }

  async flush(): Promise<void> {
    await this.commitQueue;
  }

  close(_context: Context): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.state = "closing";
    this.closePromise = this.commitQueue.finally(() => { this.state = "closed"; });
    return this.closePromise;
  }
}
