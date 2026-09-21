import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { TODO_CONTEXT, type AgentHarness, type AgentLane, type Entry, type ExecutionToolContext, type Session } from "@earendil-works/pi-agent-core";
import type { Models } from "@earendil-works/pi-ai";
import { createNodeSqliteFactory, SqliteSessionRepo } from "@earendil-works/pi-session-backend-sqlite-node";
import type { AgentDefinition } from "./definition.js";
import { createHarness } from "./harness.js";
import type { FantoServerClient } from "../fanto/client.js";
import type { SkillLoader } from "../skills/loader.js";
import { createWorkspace } from "../workspace/paths.js";

const SESSION_OWNER_ENTRY = "fanto.session_owner";
const validSessionId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SessionNotFoundError extends Error {}
export class SessionOwnershipError extends Error {}
export class SessionBusyError extends Error {}

export type SessionOwner = { agentId: string; userId: string; revision?: string };

export type ManagedSession = {
  id: string;
  agentId: string;
  userId: string;
  revision: string;
  harness: AgentHarness<ExecutionToolContext>;
  lane: AgentLane;
  session: Session;
  systemPromptTemplate: string;
};

export class AgentSessionManager {
  private readonly repository: SqliteSessionRepo;
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly running = new Set<string>();

  constructor(
    private readonly models: Models,
    private readonly fanto: FantoServerClient,
    private readonly skills: SkillLoader,
    private readonly databasePath: string,
    private readonly workspaceRoot: string,
  ) {
    mkdirSync(dirname(databasePath), { recursive: true });
    mkdirSync(workspaceRoot, { recursive: true });
    this.repository = new SqliteSessionRepo({
      directory: dirname(databasePath),
      databasePath,
      databaseFactory: createNodeSqliteFactory(),
    });
  }

  async create(definition: AgentDefinition, userId: string): Promise<ManagedSession> {
    const id = randomUUID();
    const session = await this.repository.create({ id }, TODO_CONTEXT);
    try {
      const managed = await this.createManaged(session, id, userId, definition);
      await this.writeBinding(managed, definition);
      this.sessions.set(id, managed);
      return managed;
    } catch (cause) {
      await session.close(TODO_CONTEXT);
      throw cause;
    }
  }

  async acquire(definition: AgentDefinition, id: string, userId?: string): Promise<ManagedSession> {
    if (!validSessionId.test(id)) throw new SessionNotFoundError("Invalid session id");
    const cached = this.sessions.get(id);
    if (cached) {
      this.assertOwner(cached, userId);
      if (cached.agentId === definition.id && cached.revision === definition.revision) return cached;
      if (this.running.has(id)) throw new SessionBusyError("Session is already running");
      return this.replaceCachedHarness(cached, definition);
    }
    return this.openAndConfigure(definition, id, userId);
  }

  async assertOwnership(id: string, userId: string): Promise<void> {
    const { close, owner } = await this.openOwner(id);
    try {
      if (owner.userId !== userId) throw new SessionOwnershipError("Session belongs to another user");
    } finally {
      await close();
    }
  }

  reserve(session: ManagedSession): () => void {
    if (this.running.has(session.id)) throw new SessionBusyError("Session is already running");
    this.running.add(session.id);
    return () => this.running.delete(session.id);
  }

  async history(
    id: string,
    cursor: number | undefined,
    limit: number,
    userId: string,
  ): Promise<{ agentId: string; entries: Entry[]; hasMore: boolean; nextCursor: number | null }> {
    const { agentId, session, close } = await this.openForRead(id, userId);
    try {
      const visible: Entry[] = [];
      let currentCursor = cursor;
      let exhausted = false;
      while (visible.length <= limit && !exhausted) {
        const batch = await session.findEntries({
          order: "desc",
          cursor: currentCursor === undefined ? undefined : { seq: currentCursor },
          limit: 100,
        }, TODO_CONTEXT);
        if (batch.length === 0) break;
        currentCursor = batch.at(-1)?.seq;
        for (const entry of batch) if (isVisibleHistoryEntry(entry)) visible.push(entry);
        exhausted = batch.length < 100;
      }
      const data = visible.slice(0, limit);
      return {
        agentId,
        entries: data,
        hasMore: visible.length > limit || !exhausted,
        nextCursor: visible.length > limit ? data.at(-1)?.seq ?? null : null,
      };
    } finally {
      await close();
    }
  }

  async close(): Promise<void> {
    await Promise.all([...this.sessions.values()].map(item => item.harness.close(TODO_CONTEXT)));
    this.sessions.clear();
    await this.repository.close(TODO_CONTEXT);
  }

  private async replaceCachedHarness(current: ManagedSession, definition: AgentDefinition): Promise<ManagedSession> {
    this.sessions.delete(current.id);
    await current.harness.close(TODO_CONTEXT);
    return this.openAndConfigure(definition, current.id, current.userId);
  }

  private async openAndConfigure(definition: AgentDefinition, id: string, userId?: string): Promise<ManagedSession> {
    const metadata = (await this.repository.list(undefined, TODO_CONTEXT)).find(item => item.id === id);
    if (!metadata) throw new SessionNotFoundError("Session not found");
    const session = await this.repository.open(metadata, TODO_CONTEXT);
    try {
      const owner = await this.readOwner(session);
      if (!owner) throw new SessionNotFoundError("Session is not an agent session");
      if (userId && owner.userId !== userId) throw new SessionOwnershipError("Session belongs to another user");
      const managed = await this.createManaged(session, id, owner.userId, definition);
      if (owner.agentId !== definition.id || owner.revision !== definition.revision) {
        await this.writeBinding(managed, definition);
      }
      this.sessions.set(id, managed);
      return managed;
    } catch (cause) {
      await session.close(TODO_CONTEXT);
      throw cause;
    }
  }

  private async createManaged(
    session: Session,
    id: string,
    userId: string,
    definition: AgentDefinition,
  ): Promise<ManagedSession> {
    const runtime = await createHarness(
      session,
      definition,
      createWorkspace(this.workspaceRoot, id),
      { models: this.models, fanto: this.fanto, skills: this.skills },
    );
    await runtime.lane.setModel({ provider: definition.provider, modelId: definition.model }, TODO_CONTEXT);
    await runtime.lane.setActiveTools(definition.tools, TODO_CONTEXT);
    return {
      id,
      agentId: definition.id,
      userId,
      revision: definition.revision,
      session,
      systemPromptTemplate: definition.systemPrompt,
      ...runtime,
    };
  }

  private async writeBinding(session: ManagedSession, definition: AgentDefinition): Promise<void> {
    await session.lane.appendCustomEntry(
      SESSION_OWNER_ENTRY,
      { agentId: definition.id, userId: session.userId, revision: definition.revision },
      TODO_CONTEXT,
    );
  }

  private assertOwner(session: ManagedSession, userId: string | undefined): void {
    if (userId && session.userId !== userId) throw new SessionOwnershipError("Session belongs to another user");
  }

  private async openForRead(
    id: string,
    userId: string,
  ): Promise<{ agentId: string; session: Session; close: () => Promise<void> }> {
    if (!validSessionId.test(id)) throw new SessionNotFoundError("Invalid session id");
    const cached = this.sessions.get(id);
    if (cached) {
      this.assertOwner(cached, userId);
      return { agentId: cached.agentId, session: cached.session, close: async () => {} };
    }
    const { session, owner, close } = await this.openOwner(id);
    if (owner.userId !== userId) {
      await close();
      throw new SessionOwnershipError("Session belongs to another user");
    }
    return { agentId: owner.agentId, session, close };
  }

  private async openOwner(
    id: string,
  ): Promise<{ session: Session; owner: SessionOwner; close: () => Promise<void> }> {
    if (!validSessionId.test(id)) throw new SessionNotFoundError("Invalid session id");
    const cached = this.sessions.get(id);
    if (cached) {
      return {
        session: cached.session,
        owner: { agentId: cached.agentId, userId: cached.userId, revision: cached.revision },
        close: async () => {},
      };
    }
    const metadata = (await this.repository.list(undefined, TODO_CONTEXT)).find(item => item.id === id);
    if (!metadata) throw new SessionNotFoundError("Session not found");
    const session = await this.repository.open(metadata, TODO_CONTEXT);
    const owner = await this.readOwner(session);
    if (!owner) {
      await session.close(TODO_CONTEXT);
      throw new SessionNotFoundError("Session is not an agent session");
    }
    return { session, owner, close: () => session.close(TODO_CONTEXT) };
  }

  private async readOwner(session: Session): Promise<SessionOwner | undefined> {
    const entry = await session.findEntry(
      { type: "custom", customType: SESSION_OWNER_ENTRY, order: "desc" },
      TODO_CONTEXT,
    );
    if (!entry || entry.type !== "custom" || !entry.data || typeof entry.data !== "object") return undefined;
    const value = entry.data as Record<string, unknown>;
    if (typeof value.agentId !== "string" || typeof value.userId !== "string") return undefined;
    return {
      agentId: value.agentId,
      userId: value.userId,
      revision: typeof value.revision === "string" ? value.revision : undefined,
    };
  }
}

function isVisibleHistoryEntry(entry: Entry): boolean {
  return entry.type !== "compaction" && !(entry.type === "custom" && entry.customType.startsWith("fanto."));
}
