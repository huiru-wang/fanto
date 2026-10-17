import { MemorySessionRepo } from "@earendil-works/pi-agent-core/harness/session";
import { TODO_CONTEXT, insertEntry, type Session, type SessionMetadata, type Entry } from "@earendil-works/pi-agent-core";
import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
import { logWarn } from "../../infrastructure/logging/logger.js";
import { PgSessionRepo } from "./pg-session-repo.js";
import { PgSnapshotStore, SnapshotWriter, type SnapshotStore, type SessionSnapshot } from "./session-snapshots.js";

type Loaded = { metadata: SessionMetadata; handle?: Session; reopening?: Promise<Session>; closing?: Promise<void>; readers: number; managed: boolean; revision: number; restored: boolean };

/** SDK commits are real in-memory commits. PostgreSQL is only a best-effort cold snapshot. */
export class LiveSessionRepo {
  private readonly memory = new MemorySessionRepo();
  private readonly loaded = new Map<string, Loaded>();
  private readonly opening = new Map<string, Promise<SessionMetadata | undefined>>();
  private readonly legacy: PgSessionRepo;
  readonly writer: SnapshotWriter;
  private readonly store: SnapshotStore;
  constructor(db: Kysely<DB>, store?: SnapshotStore) {
    this.legacy = new PgSessionRepo(db);
    this.store = store ?? new PgSnapshotStore(db);
    this.writer = new SnapshotWriter(this.store);
  }
  async create(options: { id: string }, _context = TODO_CONTEXT): Promise<Session> {
    await this.makeRoom();
    const handle = await this.memory.create(options, TODO_CONTEXT);
    this.loaded.set(options.id, { metadata: handle.metadata, handle, readers: 0, managed: true, revision: 0, restored: false });
    return handle;
  }
  async getById(id: string, userId?: string): Promise<SessionMetadata | undefined> {
    // A record is installed before hydration finishes; never expose that partial handle.
    while (this.opening.has(id)) await this.opening.get(id);
    const cached = this.loaded.get(id);
    if (cached) return cached.metadata;
    if (!userId) throw new Error("Owner is required to load a cold session");
    const loading = this.load(id, userId);
    this.opening.set(id, loading);
    try { return await loading; } finally { this.opening.delete(id); }
  }

  async open(metadata: SessionMetadata, _context = TODO_CONTEXT, managed = false): Promise<Session> {
    await this.getById(metadata.id);
    const record = this.loaded.get(metadata.id);
    if (!record) throw new Error("Unknown session");
    await record.closing;
    if (!record.handle) {
      record.reopening ??= this.memory.open(record.metadata, TODO_CONTEXT);
      try { record.handle = await record.reopening; } finally { record.reopening = undefined; }
    }
    if (managed) record.managed = true; else record.readers++;
    return record.handle;
  }
  /** The Harness closes its handle; the underlying MemorySessionRepo retains the conversation. */
  closedHandle(id: string): void {
    const record = this.loaded.get(id);
    if (record) { record.handle = undefined; record.managed = false; }
  }
  async closeReadHandle(id: string): Promise<void> {
    const record = this.loaded.get(id);
    if (!record) return;
    record.readers = Math.max(0, record.readers - 1);
    if (!record.managed && record.readers === 0 && record.handle) {
      const handle = record.handle;
      record.handle = undefined;
      record.closing = handle.close(TODO_CONTEXT);
      try { await record.closing; } finally { record.closing = undefined; }
    }
  }
  restored(id: string): boolean { return this.loaded.get(id)?.restored ?? false; }
  async checkpoint(id: string, userId: string, agentId: string): Promise<void> {
    const record = this.loaded.get(id);
    if (!record?.handle) return;
    // These reads only touch memory. Capture while the Session reservation is still held.
    const entries = await record.handle.findEntries({ order: "asc" }, TODO_CONTEXT);
    const tip = await (await record.handle.branch("main", TODO_CONTEXT))?.getTipId(TODO_CONTEXT) ?? null;
    const snapshot: SessionSnapshot = { format: 1, metadata: record.metadata, userId, agentId,
      revision: ++record.revision, entries: structuredClone(entries), tip };
    if (Buffer.byteLength(JSON.stringify(snapshot)) > 1024 * 1024) {
      logWarn("session-snapshot", "snapshot exceeds size limit", { sessionId: id });
      return;
    }
    this.writer.enqueue(snapshot);
  }
  isSaved(id: string): boolean { const record = this.loaded.get(id); return !!record && this.writer.isSaved(id, record.revision); }
  private async makeRoom(): Promise<void> {
    for (const [id, record] of this.loaded) {
      if (this.loaded.size < 128) return;
      if (!record.managed && record.readers === 0 && this.isSaved(id)) await this.evict(id);
    }
    if (this.loaded.size >= 128) throw new Error("Session memory capacity reached; try again later");
  }
  async evict(id: string): Promise<void> {
    const record = this.loaded.get(id);
    if (!record || record.managed || record.readers > 0 || !this.writer.isSaved(id, record.revision)) return;
    if (record.handle) { await record.handle.close(TODO_CONTEXT); record.handle = undefined; }
    await record.closing;
    await this.memory.delete(record.metadata, TODO_CONTEXT);
    this.loaded.delete(id);
    this.writer.forget(id);
  }
  async close(_context = TODO_CONTEXT): Promise<void> {
    await Promise.race([this.writer.flush(), new Promise<void>(resolve => { const timer = setTimeout(resolve, 2000); timer.unref(); })]);
    await this.memory.close(TODO_CONTEXT);
    await this.legacy.close(TODO_CONTEXT);
  }
  private async load(id: string, userId: string): Promise<SessionMetadata | undefined> {
    let snapshot = await this.store.read(id, userId);
    if (!snapshot) {
      const metadata = await this.legacy.getById(id);
      if (!metadata) return undefined;
      const legacy = await this.legacy.open(metadata, TODO_CONTEXT);
      try {
        const bindingEntry = await legacy.findEntry({ type: "custom", customType: "fanto.session_owner", order: "desc" }, TODO_CONTEXT);
        if (bindingEntry?.type !== "custom" || (bindingEntry.data as {userId?: string})?.userId !== userId) return undefined;
        const entries = await legacy.findEntries({ order: "asc" }, TODO_CONTEXT);
        const tip = await (await legacy.branch("main", TODO_CONTEXT))?.getTipId(TODO_CONTEXT) ?? null;
        const owner = entries.find(entry => entry.type === "custom" && entry.customType === "fanto.session_owner");
        if (owner?.type !== "custom") return undefined;
        const binding = owner.data as { userId: string; agentId: string };
        snapshot = { format: 1, metadata, entries, tip, revision: 0, userId: binding.userId, agentId: binding.agentId };
      } finally { await legacy.close(TODO_CONTEXT); }
    }
    if (snapshot.userId !== userId) return undefined;
    if (snapshot.format !== 1 || snapshot.metadata.id !== id || !Number.isSafeInteger(snapshot.revision)) throw new Error("Unsupported session snapshot");
    const handle = await this.create({ id });
    try {
      // Never restore live operations or pending effects. Keep stable identities and transcript only.
      const entries = stableEntries(snapshot.entries);
      await handle.mutate(mutator => mutator.commit(entries.map(entry => insertEntry(entry)), TODO_CONTEXT), TODO_CONTEXT);
      const tip = entries.some(entry => entry.id === snapshot.tip) ? snapshot.tip : entries.at(-1)?.id ?? null;
      await handle.createBranch("main", tip, TODO_CONTEXT);
      const record = this.loaded.get(id)!;
      record.managed = false;
      record.revision = snapshot.revision;
      record.restored = true;
      this.writer.remember(id, snapshot.revision);
      return record.metadata;
    } catch (error) {
      await handle.close(TODO_CONTEXT);
      await this.memory.delete(handle.metadata, TODO_CONTEXT);
      this.loaded.delete(id);
      throw error;
    }
  }
}

/** Legacy interrupted calls must never be replayed or sent to a model without matching results. */
export function stableEntries(source: Entry[]): Entry[] {
  const completed = new Set(source.flatMap(entry => entry.type === "message" && entry.message.role === "toolResult" ? [entry.message.toolCallId] : []));
  const calls = new Set(source.flatMap(entry => entry.type === "message" && entry.message.role === "assistant"
    ? entry.message.content.flatMap(block => block.type === "toolCall" ? [block.id] : []) : []));
  return source.map(entry => {
    if (entry.type !== "message") return entry;
    if (entry.message.role === "toolResult" && !calls.has(entry.message.toolCallId)) {
      return { type: "custom", id: entry.id, parentId: entry.parentId, seq: entry.seq, timestamp: entry.timestamp,
        customType: "fanto.ignored_tool_result", data: {} };
    }
    if (entry.message.role !== "assistant") return entry;
    const content = entry.message.content.filter(block => block.type !== "toolCall" || completed.has(block.id));
    return { ...entry, message: { ...entry.message, content,
      ...(content.length !== entry.message.content.length ? { stopReason: "aborted" as const } : {}) } };
  });
}
