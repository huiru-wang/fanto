import { MemorySessionRepo, TODO_CONTEXT, type Session, type SessionMetadata } from "@earendil-works/pi-agent-core";
import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
import { CheckpointRepository } from "../checkpoint/postgres-repository.js";
import { restoreCheckpoint } from "../checkpoint/restore.js";

type Loaded = {
  metadata: SessionMetadata;
  handle?: Session;
  restored: boolean;
  closing?: Promise<void>;
};

/** Pi SDK remains in-memory. The checkpoint module owns PostgreSQL persistence. */
export class LiveSessionRepo {
  private readonly memory = new MemorySessionRepo();
  private readonly loaded = new Map<string, Loaded>();
  private readonly opening = new Map<string, Promise<SessionMetadata | undefined>>();
  readonly checkpoints: CheckpointRepository;
  constructor(db: Kysely<DB>, checkpoints?: CheckpointRepository) {
    this.checkpoints = checkpoints ?? new CheckpointRepository(db);
  }

  async create(options: { id: string }, _context = TODO_CONTEXT): Promise<Session> {
    const handle = await this.memory.create(options, TODO_CONTEXT);
    this.loaded.set(options.id, { metadata: handle.metadata, handle, restored: false });
    return handle;
  }

  async getById(id: string, userId?: string): Promise<SessionMetadata | undefined> {
    // Hydration installs the memory handle before its Entries are restored.
    // Wait for the whole restore even if it already appears in loaded.
    const inFlight = this.opening.get(id);
    if (inFlight) return inFlight;
    const cached = this.loaded.get(id);
    if (cached) return cached.metadata;
    if (!userId) throw new Error("Owner is required to load cold session");
    const loading = this.load(id, userId);
    this.opening.set(id, loading);
    try { return await loading; }
    finally { this.opening.delete(id); }
  }

  private async load(id: string, userId: string): Promise<SessionMetadata | undefined> {
    const stored = await this.checkpoints.getSession(id, userId);
    if (!stored) return undefined;
    const handle = await this.create({ id });
    try {
      await restoreCheckpoint(handle, id, this.checkpoints);
      const record = this.loaded.get(id)!;
      record.restored = true;
      return record.metadata;
    } catch (error) {
      await handle.close(TODO_CONTEXT);
      await this.memory.delete(handle.metadata, TODO_CONTEXT);
      this.loaded.delete(id);
      throw error;
    }
  }

  async open(metadata: SessionMetadata, _context = TODO_CONTEXT): Promise<Session> {
    const record = this.loaded.get(metadata.id);
    if (!record) throw new Error("Session has not been loaded");
    await record.closing;
    if (!record.handle) record.handle = await this.memory.open(record.metadata, TODO_CONTEXT);
    return record.handle;
  }

  closedHandle(id: string): void {
    const record = this.loaded.get(id);
    if (record) record.handle = undefined;
  }

  restored(id: string): boolean { return this.loaded.get(id)?.restored ?? false; }
  isSaved(id: string): boolean { return this.loaded.has(id); }

  async evict(id: string): Promise<void> {
    const record = this.loaded.get(id);
    if (!record) return;
    if (record.handle) await record.handle.close(TODO_CONTEXT);
    await record.closing;
    await this.memory.delete(record.metadata, TODO_CONTEXT);
    this.loaded.delete(id);
  }

  async close(_context = TODO_CONTEXT): Promise<void> {
    await this.memory.close(TODO_CONTEXT);
  }
}
