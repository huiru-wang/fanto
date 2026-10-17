import { sql, type Kysely } from "kysely";
import type { Entry, SessionMetadata } from "@earendil-works/pi-agent-core";
import type { DB } from "../../infrastructure/database/schema.js";
import { logInfo, logWarn } from "../../infrastructure/logging/logger.js";

export type SessionSnapshot = {
  format: 1;
  metadata: SessionMetadata;
  userId: string;
  agentId: string;
  revision: number;
  entries: Entry[];
  tip: string | null;
};

export interface SnapshotStore {
  read(id: string, userId: string): Promise<SessionSnapshot | undefined>;
  write(snapshot: SessionSnapshot): Promise<void>;
}

export class PgSnapshotStore implements SnapshotStore {
  constructor(private readonly db: Kysely<DB>) {}
  async read(id: string, userId: string): Promise<SessionSnapshot | undefined> {
    const result = await sql<{ snapshot: SessionSnapshot }>`SELECT snapshot FROM agent_session.snapshots WHERE session_id = ${id} AND user_id = ${userId}`.execute(this.db);
    return result.rows[0]?.snapshot;
  }
  async write(snapshot: SessionSnapshot): Promise<void> {
    await sql`INSERT INTO agent_session.snapshots (session_id, user_id, revision, snapshot)
      VALUES (${snapshot.metadata.id}, ${snapshot.userId}, ${snapshot.revision}, ${JSON.stringify(snapshot)}::jsonb)
      ON CONFLICT (session_id) DO UPDATE SET revision = excluded.revision, snapshot = excluded.snapshot
      WHERE agent_session.snapshots.user_id = excluded.user_id AND agent_session.snapshots.revision < excluded.revision`.execute(this.db);
  }
}

/** One in-flight and one latest pending snapshot per Session. Never awaited by a reply. */
export class SnapshotWriter {
  private readonly jobs = new Map<string, { pending?: SessionSnapshot; running: Promise<void> }>();
  private activeWrites = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly saved = new Map<string, number>();
  constructor(private readonly store: SnapshotStore) {}
  enqueue(snapshot: SessionSnapshot): void {
    const id = snapshot.metadata.id;
    const existing = this.jobs.get(id);
    if (existing) { existing.pending = snapshot; return; }
    const job = { pending: snapshot as SessionSnapshot | undefined, running: Promise.resolve() };
    this.jobs.set(id, job);
    job.running = this.drain(id, job);
  }
  isSaved(id: string, revision: number): boolean { return (this.saved.get(id) ?? -1) >= revision; }
  remember(id: string, revision: number): void { this.saved.set(id, revision); }
  forget(id: string): void { this.saved.delete(id); }
  async flush(): Promise<void> { await Promise.all([...this.jobs.values()].map(job => job.running)); }
  private async write(snapshot: SessionSnapshot): Promise<void> {
    // Leave database connections available for interactive business operations.
    if (this.activeWrites >= 2) await new Promise<void>(resolve => this.waiting.push(resolve));
    else this.activeWrites++;
    try { await this.store.write(snapshot); }
    finally {
      const next = this.waiting.shift();
      if (next) next(); else this.activeWrites--;
    }
  }
  private async drain(id: string, job: { pending?: SessionSnapshot }): Promise<void> {
    try {
      while (job.pending) {
        const snapshot = job.pending;
        job.pending = undefined;
        const startedAt = Date.now();
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            await this.write(snapshot);
            this.saved.set(id, snapshot.revision);
            logInfo("session-snapshot", "saved", { sessionId: id, revision: snapshot.revision, entries: snapshot.entries.length, durationMs: Date.now() - startedAt });
            break;
          } catch {
            logWarn("session-snapshot", "save failed", { sessionId: id, revision: snapshot.revision, attempt: attempt + 1 });
            if (job.pending) break; // Prefer newer data to retrying an obsolete snapshot.
          }
        }
      }
    } finally { this.jobs.delete(id); }
  }
}
