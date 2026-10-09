import { sql, type Kysely } from "kysely";
import {
  createForkSnapshot, StorageBackedSession, value,
  type Context, type Entry, type ForkOptions, type Session,
  type SessionCreateOptions, type SessionMetadata, type SessionRepo, type StoredValue,
} from "@earendil-works/pi-agent-core";
import { uuidv7 } from "@earendil-works/pi-ai";
import type { DB } from "../../infrastructure/database/schema.js";
import { json, safeNumber, decodeEntry, type PgEntryRow } from "./pg-codec.js";
import { PgStorage } from "./pg-storage.js";
import { indexEntry } from "./pg-branches.js";
import { zeroUsage } from "./pg-queries.js";

const STORAGE_VERSION = 1;

export type PgSessionMetadata = SessionMetadata;

type SessionRow = {
  id: string; created_at: number | string; parent_session_id: string | null;
  storage_version: number;
};

function metadataFromRow(row: SessionRow): PgSessionMetadata {
  if (row.storage_version !== STORAGE_VERSION)
    throw new Error(`Unsupported PG Session storage version: ${row.storage_version}`);
  return {
    id: row.id, createdAt: safeNumber(row.created_at, "created_at"),
    storageVersion: row.storage_version,
    ...(row.parent_session_id === null ? {} : { parentSessionId: row.parent_session_id }),
  };
}

/** Provider-neutral PostgreSQL SessionRepo backed by the application's own pool. */
export class PgSessionRepo implements SessionRepo<PgSessionMetadata> {
  private readonly openSessions = new Map<string, Session>();
  private readonly storages = new Map<string, PgStorage>();
  private readonly pendingIds = new Set<string>();
  private closed = false;
  private closePromise?: Promise<void>;

  constructor(private readonly db: Kysely<DB>, private readonly now: () => number = Date.now) {}

  async create(options: SessionCreateOptions | undefined, _context: Context): Promise<Session> {
    this.assertOpen();
    const createdAt = this.now();
    const id = options?.id ?? uuidv7(createdAt);
    this.reserve(id);
    try {
      await sql`INSERT INTO agent_session.sessions
        (id, created_at, parent_session_id, storage_version, metadata, message_count, usage_payload, next_seq)
        VALUES (${id}, ${createdAt}, ${options?.parentSessionId ?? null}, ${STORAGE_VERSION},
          NULL, 0, ${json(zeroUsage())}::jsonb, 1)`.execute(this.db);
      return this.makeSession({
        id, createdAt, storageVersion: STORAGE_VERSION,
        ...(options?.parentSessionId === undefined ? {} : { parentSessionId: options.parentSessionId }),
      });
    } finally {
      this.pendingIds.delete(id);
    }
  }

  async getById(id: string): Promise<PgSessionMetadata | undefined> {
    this.assertOpen();
    const result = await sql<SessionRow>`
      SELECT id, created_at, parent_session_id, storage_version
      FROM agent_session.sessions WHERE id = ${id}
    `.execute(this.db);
    return result.rows[0] ? metadataFromRow(result.rows[0]) : undefined;
  }

  async open(metadata: PgSessionMetadata, _context: Context): Promise<Session> {
    this.assertOpen();
    this.reserve(metadata.id);
    try {
      const persisted = await this.getById(metadata.id);
      if (!persisted) throw new Error(`Unknown PG session: ${metadata.id}`);
      return this.makeSession(persisted);
    } finally {
      this.pendingIds.delete(metadata.id);
    }
  }

  async list(_options: undefined, _context: Context): Promise<PgSessionMetadata[]> {
    this.assertOpen();
    const result = await sql<SessionRow>`
      SELECT id, created_at, parent_session_id, storage_version
      FROM agent_session.sessions ORDER BY created_at DESC, id DESC
    `.execute(this.db);
    return result.rows.map(metadataFromRow);
  }

  async delete(metadata: PgSessionMetadata, _context: Context): Promise<void> {
    this.assertOpen();
    this.reserve(metadata.id);
    try {
      await this.db.transaction().execute(async trx => {
        const locked = await sql`SELECT id FROM agent_session.sessions
          WHERE id = ${metadata.id} FOR UPDATE`.execute(trx);
        if (locked.rows.length !== 1) throw new Error(`Unknown PG session: ${metadata.id}`);
        for (const table of ["entries", "scalar_values", "list_values", "usage_ledger", "branch_entries", "branch_meta"]) {
          await sql`DELETE FROM ${sql.raw("agent_session." + table)} WHERE session_id = ${metadata.id}`.execute(trx);
        }
        await sql`DELETE FROM agent_session.sessions WHERE id = ${metadata.id}`.execute(trx);
      });
    } finally {
      this.pendingIds.delete(metadata.id);
    }
  }

  async fork(source: PgSessionMetadata, options: ForkOptions, _context: Context): Promise<Session> {
    this.assertOpen();
    const id = options.id ?? uuidv7(this.now());
    this.reserve(id);
    try {
      // Serialize against the source storage queue: forks observe commits admitted
      // before fork() but not mutations queued after it.
      await this.storages.get(source.id)?.flush();
      // Source is an MVCC-consistent snapshot, regardless of writes on another connection.
      const snapshot = await this.db.transaction().setIsolationLevel("repeatable read").execute(async trx => {
        const exists = await sql`SELECT id FROM agent_session.sessions WHERE id = ${source.id}`.execute(trx);
        if (!exists.rows.length) throw new Error(`Unknown PG session: ${source.id}`);
        const rows = await sql<PgEntryRow>`
          SELECT id, parent_id, seq, type, custom_type, timestamp, payload
          FROM agent_session.entries WHERE session_id = ${source.id} ORDER BY seq ASC
        `.execute(trx);
        const values = await sql<{ namespace: string; key: string; seq: number | string; value: unknown }>`
          SELECT namespace, key, seq, value FROM agent_session.scalar_values
          WHERE session_id = ${source.id} ORDER BY seq ASC
        `.execute(trx);
        return createForkSnapshot({
          entries: rows.rows.map(decodeEntry),
          scalarValues: values.rows.map(row => ({
            address: value(row.namespace, row.key), value: row.value,
            seq: safeNumber(row.seq, "scalar_values.seq"),
          })) as StoredValue<unknown>[],
          entriesComplete: true,
        }, options);
      });

      const createdAt = this.now();
      const metadata: PgSessionMetadata = {
        id, createdAt, storageVersion: STORAGE_VERSION, parentSessionId: source.id,
      };
      await this.db.transaction().execute(async trx => {
        await sql`INSERT INTO agent_session.sessions
          (id, created_at, parent_session_id, storage_version, metadata, message_count, usage_payload, next_seq)
          VALUES (${id}, ${createdAt}, ${source.id}, ${STORAGE_VERSION},
            NULL, 0, ${json(zeroUsage())}::jsonb, ${snapshot.nextSeq})`.execute(trx);
        const storage = new PgStorage(this.db, { sessionId: id, now: this.now });
        let messageCount = 0;
        for (const entry of [...snapshot.entries.values()].sort((a, b) => a.seq - b.seq)) {
          await storage.insertEntry(trx, entry);
          await indexEntry(trx, id, entry);
          if (entry.type === "message") messageCount++;
        }
        for (const stored of snapshot.scalarValues) {
          await sql`INSERT INTO agent_session.scalar_values
            (session_id, namespace, key, seq, value)
            VALUES (${id}, ${stored.address.namespace}, ${stored.address.key}, ${stored.seq},
              ${json(stored.value)}::jsonb)`.execute(trx);
        }
        await sql`UPDATE agent_session.sessions SET message_count = ${messageCount} WHERE id = ${id}`.execute(trx);
      });
      return this.makeSession(metadata);
    } finally {
      this.pendingIds.delete(id);
    }
  }

  close(context: Context): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.closePromise = (async () => {
      const results = await Promise.allSettled([...this.openSessions.values()].map(session => session.close(context)));
      const errors = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
      if (errors.length) throw new AggregateError(errors, "Failed to close PG Sessions");
    })();
    return this.closePromise;
  }

  private makeSession(metadata: PgSessionMetadata): Session {
    const storage = new PgStorage(this.db, { sessionId: metadata.id, now: this.now });
    const session = new StorageBackedSession(metadata, storage, {
      onClose: () => {
        if (this.openSessions.get(metadata.id) === session) {
          this.openSessions.delete(metadata.id);
          this.storages.delete(metadata.id);
        }
      },
    });
    this.openSessions.set(metadata.id, session);
    this.storages.set(metadata.id, storage);
    return session;
  }

  private reserve(id: string): void {
    if (this.pendingIds.has(id) || this.openSessions.has(id))
      throw new Error(`Session is already open: ${id}`);
    this.pendingIds.add(id);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("PgSessionRepo is closed");
  }
}
