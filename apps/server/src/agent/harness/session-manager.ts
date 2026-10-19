import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { TODO_CONTEXT, type Session } from "@earendil-works/pi-agent-core";
import type { Models } from "@earendil-works/pi-ai";
import { type Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
import { SessionCheckpoint } from "../checkpoint/checkpoint.js";
import type { CheckpointRepository } from "../checkpoint/postgres-repository.js";
import { liveAssistantEntry } from "./run.js";
import { LiveSessionRepo } from "../session/live-session-repo.js";
import type { AgentDefinition } from "./definition.js";
import { buildRuntime, type HarnessRuntime } from "./build-runtime.js";
import { createTools } from "../tools/index.js";
import type { FantoTool } from "../tools/types.js";
import type { AgentBusinessServices } from "../business-services.js";
import type { SkillLoader } from "../skills/loader.js";
import { createWorkspace } from "../workspace/paths.js";

const validSessionId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SessionNotFoundError extends Error {}
export class SessionOwnershipError extends Error {}
export class SessionBusyError extends Error {}

export type ManagedSession = {
  id: string;
  agentId: string;
  userId: string;
  revision: string;
  runtime: HarnessRuntime;
  session: Session;
  checkpoint: SessionCheckpoint;
};

export class AgentSessionManager {
  private readonly repository: LiveSessionRepo;
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly running = new Set<string>();
  private readonly idleWaiters = new Map<string, Set<(error?: unknown) => void>>();

  constructor(
    private readonly models: Models,
    private readonly fanto: AgentBusinessServices,
    private readonly skills: SkillLoader,
    private readonly db: Kysely<DB>,
    private readonly workspaceRoot: string,
    checkpointStore?: CheckpointRepository,
  ) {
    mkdirSync(workspaceRoot, { recursive: true });
    this.repository = new LiveSessionRepo(db, checkpointStore);
  }

  async create(definition: AgentDefinition, userId: string): Promise<ManagedSession> {
    await this.makeRoom();
    const id = randomUUID();
    const session = await this.repository.create({ id }, TODO_CONTEXT);
    try {
      await this.repository.checkpoints.createSession(id, userId, definition.id);
      const managed = await this.createManaged(session, id, userId, definition);
      this.sessions.set(id, managed);
      await this.checkpoint(id);
      return managed;
    } catch (cause) {
      await session.close(TODO_CONTEXT);
      this.repository.closedHandle(id);
      throw cause;
    }
  }

  async acquire(definition: AgentDefinition, id: string, userId?: string): Promise<ManagedSession> {
    if (!validSessionId.test(id)) throw new SessionNotFoundError("Invalid session id");
    if (this.running.has(id)) throw new SessionBusyError("Session is already running");
    const cached = this.sessions.get(id);
    if (cached) {
      this.assertOwner(cached, userId);
      if (cached.agentId !== definition.id) throw new SessionOwnershipError("Session agent identity cannot change");
      if (cached.agentId === definition.id && cached.revision === definition.revision) return cached;
      if (this.running.has(id)) throw new SessionBusyError("Session is already running");
      return this.replaceCachedHarness(cached, definition);
    }
    await this.makeRoom();
    return this.openAndConfigure(definition, id, userId);
  }

  async resolveAgentId(id: string, userId: string): Promise<string> {
    if (!validSessionId.test(id)) throw new SessionNotFoundError("Invalid session id");
    const cached = this.sessions.get(id);
    if (cached) { this.assertOwner(cached, userId); return cached.agentId; }
    const owner = await this.repository.checkpoints.getSession(id);
    if (!owner) throw new SessionNotFoundError("Session not found");
    if (owner.userId !== userId) throw new SessionOwnershipError("Session belongs to another user");
    return owner.agentId;
  }

  async assertOwnership(id: string, userId: string): Promise<void> {
    if (!validSessionId.test(id)) throw new SessionNotFoundError("Invalid session id");
    const cached = this.sessions.get(id);
    if (cached) { this.assertOwner(cached, userId); return; }
    const owner = await this.repository.checkpoints.getSession(id);
    if (!owner) throw new SessionNotFoundError("Session not found");
    if (owner.userId !== userId) throw new SessionOwnershipError("Session belongs to another user");
  }

  reserve(session: ManagedSession): (error?: unknown) => void {
    if (this.running.has(session.id)) throw new SessionBusyError("Session is already running");
    this.running.add(session.id);
    let released = false;
    return (error) => {
      if (released) return;
      released = true;
      this.running.delete(session.id);
      for (const resolve of this.idleWaiters.get(session.id) ?? []) resolve(error);
      this.idleWaiters.delete(session.id);
    };
  }

  isRunning(id: string): boolean { return this.running.has(id); }

  async waitUntilIdle(id: string): Promise<void> {
    if (!this.running.has(id)) return;
    await new Promise<void>((resolve,reject) => {
      const waiters = this.idleWaiters.get(id) ?? new Set<(error?: unknown) => void>();
      waiters.add(error => error === undefined ? resolve() : reject(error));
      this.idleWaiters.set(id, waiters);
    });
  }

  async history(id: string, cursor: number | undefined, limit: number, userId: string) {
    const owner = await this.repository.checkpoints.getSession(id);
    if (!owner) throw new SessionNotFoundError("Session not found");
    if (owner.userId !== userId) throw new SessionOwnershipError("Session belongs to another user");
    const page = await this.repository.checkpoints.history(id, cursor, limit);
    const live = cursor === undefined ? liveAssistantEntry(id) : undefined;
    const unsaved = cursor === undefined
      ? this.sessions.get(id)?.checkpoint?.unpersistedEntries() ?? []
      : [];
    // Complete Pi Entry commits are visible before their asynchronous UI stream ends.
    // The DB page and unsaved tail are de-duplicated by stable SDK Entry IDs.
    const entries = [...page.entries.reverse()];
    const seen = new Set(entries.map(entry => entry.id));
    for (const entry of unsaved) {
      if (!seen.has(entry.id)) { entries.unshift(entry); seen.add(entry.id); }
    }
    if (live) entries.unshift(live);
    return { agentId: owner.agentId, ...page, entries };
  }

  async list(userId: string, agentId: string, cursor: string | undefined, limit: number) {
    return this.repository.checkpoints.list(userId, agentId, cursor, limit);
  }

  toolsForHistory(definition: AgentDefinition, id: string, userId: string): FantoTool[] {
    const cached = this.sessions.get(id);
    if (cached) {
      this.assertOwner(cached, userId);
      if (cached.agentId === definition.id && cached.revision === definition.revision) return cached.runtime.tools;
    }
    return createTools(
      definition.tools,
      createWorkspace(this.workspaceRoot, userId, id),
      this.fanto,
      this.skills,
      definition.skills,
    );
  }

  async release(id: string, reservedOwner = false): Promise<void> {
    if (this.running.has(id) && !reservedOwner) throw new SessionBusyError("Session is still running");
    const current = this.sessions.get(id);
    if (!current) return;
    await this.checkpoint(id);
    await current.checkpoint?.close();
    this.sessions.delete(id);
    await current.runtime.close();
    this.repository.closedHandle(id);
  }

  async checkpoint(id: string): Promise<void> {
    const current = this.sessions.get(id);
    if (current) await current.checkpoint.flush();
  }

  restored(id: string): boolean { return this.repository.restored(id); }

  async close(): Promise<void> {
    await Promise.all([...this.sessions.values()].map(async item => { await item.checkpoint.close(); await item.runtime.close(); }));
    this.sessions.clear();
    await this.repository.close(TODO_CONTEXT);
  }

  private async makeRoom(): Promise<void> {
    if (this.sessions.size < 128) return;
    for (const [id, current] of this.sessions) {
      if (!this.running.has(id) && this.repository.isSaved(id) && !current.checkpoint.hasPending) {
        this.sessions.delete(id);
        await current.checkpoint?.close();
        await current.runtime.close();
        this.repository.closedHandle(id);
        await this.repository.evict(id);
        return;
      }
    }
    throw new SessionBusyError("Session memory capacity reached");
  }

  private async replaceCachedHarness(current: ManagedSession, definition: AgentDefinition): Promise<ManagedSession> {
    this.sessions.delete(current.id);
    await current.checkpoint?.close();
    await current.runtime.close();
    this.repository.closedHandle(current.id);
    return this.openAndConfigure(definition, current.id, current.userId);
  }

  private async openAndConfigure(definition: AgentDefinition, id: string, userId?: string): Promise<ManagedSession> {
    // Session identity belongs to PG, not to a historical custom Entry.
    const owner = await this.repository.checkpoints.getSession(id);
    if (!owner) throw new SessionNotFoundError("Session not found");
    if (userId && owner.userId !== userId) throw new SessionOwnershipError("Session belongs to another user");
    if (owner.agentId !== definition.id) throw new SessionOwnershipError("Session agent identity cannot change");
    const metadata = await this.repository.getById(id, owner.userId);
    if (!metadata) throw new SessionNotFoundError("Session not found");
    const session = await this.repository.open(metadata, TODO_CONTEXT);
    try {
      // A new Harness always receives the current definition. Hot revisions
      // rebuild through replaceCachedHarness; no persisted revision marker needed.
      const managed = await this.createManaged(session, id, owner.userId, definition);
      this.sessions.set(id, managed);
      return managed;
    } catch (cause) {
      await session.close(TODO_CONTEXT);
      this.repository.closedHandle(id);
      throw cause;
    }
  }

  private async createManaged(
    session: Session,
    id: string,
    userId: string,
    definition: AgentDefinition,
  ): Promise<ManagedSession> {
    const runtime = await buildRuntime(
      session,
      definition,
      createWorkspace(this.workspaceRoot, userId, id),
      { models: this.models, fanto: this.fanto, skills: this.skills },
    );
    return {
      id,
      agentId: definition.id,
      userId,
      revision: definition.revision,
      session,
      checkpoint: new SessionCheckpoint(id, this.repository.checkpoints, runtime.harness),
      runtime,
    };
  }

  private assertOwner(session: ManagedSession, userId: string | undefined): void {
    if (userId && session.userId !== userId) throw new SessionOwnershipError("Session belongs to another user");
  }

}
