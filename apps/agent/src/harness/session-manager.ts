import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { TODO_CONTEXT, type AgentHarness, type AgentLane, type Entry, type ExecutionToolContext, type Session } from "@earendil-works/pi-agent-core";
import { createNodeSqliteFactory, SqliteSessionRepo } from "@earendil-works/pi-session-backend-sqlite-node";
import type { AgentDefinition } from "../config/agent-config.js";
import { HarnessFactory } from "./harness-factory.js";
import { createWorkspace } from "./workspace.js";

const AGENT_CONFIG_ENTRY = "fanto.agent_config";
const validSessionId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SessionNotFoundError extends Error {}
export class SessionAgentMismatchError extends Error {}
export class SessionBusyError extends Error {}

export type ManagedSession = {
  id: string;
  agentId: string;
  harness: AgentHarness<ExecutionToolContext>;
  lane: AgentLane;
  session: Session;
};

export class AgentSessionManager {
  private readonly repository: SqliteSessionRepo;
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly running = new Set<string>();

  constructor(private readonly factory: HarnessFactory, private readonly databasePath: string, private readonly workspaceRoot: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    mkdirSync(workspaceRoot, { recursive: true });
    this.repository = new SqliteSessionRepo({
      directory: dirname(databasePath),
      databasePath,
      databaseFactory: createNodeSqliteFactory(),
    });
  }

  async acquire(definition: AgentDefinition, requestedSessionId?: string): Promise<ManagedSession> {
    if (!requestedSessionId) return this.create(definition);
    if (!validSessionId.test(requestedSessionId)) throw new SessionNotFoundError("Invalid session id");
    const cached = this.sessions.get(requestedSessionId);
    if (cached) {
      if (cached.agentId !== definition.id) throw new SessionAgentMismatchError("Session belongs to another agent");
      return cached;
    }
    const metadata = (await this.repository.list(undefined, TODO_CONTEXT)).find(item => item.id === requestedSessionId);
    if (!metadata) throw new SessionNotFoundError("Session not found");
    const session = await this.repository.open(metadata, TODO_CONTEXT);
    try {
      const agentId = await this.readAgentId(session);
      if (!agentId) throw new SessionNotFoundError("Session is not an agent session");
      if (agentId !== definition.id) throw new SessionAgentMismatchError("Session belongs to another agent");
      const runtime = await this.factory.create(session, definition, createWorkspace(this.workspaceRoot, requestedSessionId));
      const managed = { id: requestedSessionId, agentId, session, ...runtime };
      this.sessions.set(requestedSessionId, managed);
      return managed;
    } catch (cause) {
      await session.close(TODO_CONTEXT);
      throw cause;
    }
  }

  reserve(session: ManagedSession): () => void {
    if (this.running.has(session.id)) throw new SessionBusyError("Session is already running");
    this.running.add(session.id);
    return () => this.running.delete(session.id);
  }

  async prompt(session: ManagedSession, message: string, signal: AbortSignal, emit: (delta: string) => Promise<void>): Promise<void> {
    let unsubscribe: (() => void) | undefined;
    const abort = () => { void session.lane.abort(TODO_CONTEXT).catch(() => {}); };
    try {
      signal.addEventListener("abort", abort, { once: true });
      signal.throwIfAborted();
      unsubscribe = session.harness.events.on("message_update", async ({ event }) => {
        if (event.type === "text_delta" && !signal.aborted) await emit(event.delta);
      });
      const result = await session.lane.prompt(message, undefined, TODO_CONTEXT);
      signal.throwIfAborted();
      if (!result.ok || result.value.status !== "completed") throw new Error("Agent run did not complete");
    } finally {
      signal.removeEventListener("abort", abort);
      unsubscribe?.();
    }
  }

  async entries(id: string, afterSeq: number, limit: number): Promise<{ agentId: string; entries: Entry[] }> {
    if (!validSessionId.test(id)) throw new SessionNotFoundError("Invalid session id");
    const cached = this.sessions.get(id);
    if (cached) return { agentId: cached.agentId, entries: await cached.session.findEntries({ order: "asc", cursor: { seq: afterSeq }, limit }, TODO_CONTEXT) };
    const metadata = (await this.repository.list(undefined, TODO_CONTEXT)).find(item => item.id === id);
    if (!metadata) throw new SessionNotFoundError("Session not found");
    const session = await this.repository.open(metadata, TODO_CONTEXT);
    try {
      const agentId = await this.readAgentId(session);
      if (!agentId) throw new SessionNotFoundError("Session is not an agent session");
      const entries = await session.findEntries({ order: "asc", cursor: { seq: afterSeq }, limit }, TODO_CONTEXT);
      return { agentId, entries };
    } finally {
      await session.close(TODO_CONTEXT);
    }
  }

  async close(): Promise<void> {
    await Promise.all([...this.sessions.values()].map(item => item.harness.close(TODO_CONTEXT)));
    this.sessions.clear();
    await this.repository.close(TODO_CONTEXT);
  }

  private async create(definition: AgentDefinition): Promise<ManagedSession> {
    const id = randomUUID();
    const session = await this.repository.create({ id }, TODO_CONTEXT);
    try {
      const runtime = await this.factory.create(session, definition, createWorkspace(this.workspaceRoot, id));
      await runtime.lane.appendCustomEntry(AGENT_CONFIG_ENTRY, { agentId: definition.id }, TODO_CONTEXT);
      const managed = { id, agentId: definition.id, session, ...runtime };
      this.sessions.set(id, managed);
      return managed;
    } catch (cause) {
      await session.close(TODO_CONTEXT);
      throw cause;
    }
  }

  private async readAgentId(session: Session): Promise<string | undefined> {
    const entry = await session.findEntry({ type: "custom", customType: AGENT_CONFIG_ENTRY, order: "asc" }, TODO_CONTEXT);
    if (!entry || entry.type !== "custom" || !entry.data || typeof entry.data !== "object") return undefined;
    const value = entry.data as Record<string, unknown>;
    return typeof value.agentId === "string" ? value.agentId : undefined;
  }
}
