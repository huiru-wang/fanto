import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { AgentHarness, createBashTool, createEditTool, createReadTool, createWriteTool, TODO_CONTEXT, type AgentHarnessTool, type AgentLane, type Entry, type ExecutionToolContext, type Session } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { createNodeSqliteFactory, SqliteSessionRepo } from "@earendil-works/pi-session-backend-sqlite-node";
import { z } from "zod";
import type { AppConfig } from "../env.js";

const sessionId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_OWNER_ENTRY = "fanto.session_owner";
const MAIN_LANE = "main";
const DEFAULT_AGENT_ID = "main";
const forbiddenBash = /(^|[\s;|&])(rm\s+-[a-z]*r|sudo\b|su\b|mount\b|chmod\s+-R|chown\s+-R|curl\b|wget\b|nc\b|ssh\b)/;
const builtInTool = z.enum(["read", "write", "edit", "bash"]);

const definitionSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/),
  provider: z.string().min(1),
  model: z.string().min(1),
  systemPrompt: z.string().min(1),
  context: z.object({
    maxInputTokens: z.number().int().positive(),
    recentTurns: z.number().int().positive(),
  }).strict(),
  tools: z.array(builtInTool).default([]),
}).strict();

type AgentDefinition = z.infer<typeof definitionSchema>;
type SessionOwner = { userId: string; agentId: string };
export type AgentSession = {
  userId: string;
  agentId: string;
  harness: AgentHarness;
  lane: AgentLane;
  session: Session;
  workspace: string;
};

class AgentDefinitions {
  private readonly byId = new Map<string, AgentDefinition>();

  constructor(directory: string) {
    for (const file of readdirSync(directory).filter((item) => item.endsWith(".json"))) {
      const parsed = definitionSchema.safeParse(JSON.parse(readFileSync(resolve(directory, file), "utf8")));
      if (!parsed.success) throw new Error(`Invalid agent definition ${file}: ${parsed.error.message}`);
      if (this.byId.has(parsed.data.id)) throw new Error(`Duplicate agent definition: ${parsed.data.id}`);
      this.byId.set(parsed.data.id, parsed.data);
    }
    if (this.byId.size === 0) throw new Error(`No agent definitions found in ${directory}`);
  }

  get(id: string): AgentDefinition | undefined {
    return this.byId.get(id);
  }
}

export class AgentHarnessManager {
  private readonly repository: SqliteSessionRepo;
  private readonly harnesses = new Map<string, AgentSession>();
  private readonly models = builtinModels();
  private readonly definitions: AgentDefinitions;

  constructor(private readonly config: AppConfig) {
    mkdirSync(config.agentWorkspaceRoot, { recursive: true });
    mkdirSync(config.agentDefinitionsDir, { recursive: true });
    this.definitions = new AgentDefinitions(config.agentDefinitionsDir);
    this.repository = new SqliteSessionRepo({
      directory: dirname(config.agentSessionDatabasePath),
      databasePath: config.agentSessionDatabasePath,
      databaseFactory: createNodeSqliteFactory(),
    });
  }

  async getOrCreate(userId: string, id: string, requestedAgentId = DEFAULT_AGENT_ID): Promise<AgentSession | null> {
    if (!sessionId.test(id)) return null;
    const cached = this.harnesses.get(id);
    if (cached) return cached.userId === userId && cached.agentId === requestedAgentId ? cached : null;

    const metadata = (await this.repository.list(undefined, TODO_CONTEXT)).find((item) => item.id === id);
    if (metadata) return this.openExisting(userId, metadata.id, requestedAgentId);

    const definition = this.definitions.get(requestedAgentId);
    if (!definition) return null;
    const workspace = resolve(this.config.agentWorkspaceRoot, id);
    mkdirSync(workspace, { recursive: true });
    const session = await this.repository.create({ id }, TODO_CONTEXT);
    const value = await this.createRuntime(session, userId, definition, workspace);
    await value.lane.appendCustomEntry(SESSION_OWNER_ENTRY, { userId, agentId: definition.id }, TODO_CONTEXT);
    this.harnesses.set(id, value);
    return value;
  }

  async entries(userId: string, id: string, afterSeq = 0, limit = 50): Promise<Entry[] | null> {
    if (!sessionId.test(id)) return null;
    const runtime = this.harnesses.get(id) ?? await this.openExisting(userId, id);
    if (!runtime || runtime.userId !== userId) return null;
    return runtime.lane.findEntries({ order: "oldestFirst", cursor: { seq: afterSeq }, limit }, TODO_CONTEXT);
  }

  async close(): Promise<void> {
    await Promise.all([...this.harnesses.values()].map((item) => item.harness.close(TODO_CONTEXT)));
    this.harnesses.clear();
    await this.repository.close(TODO_CONTEXT);
  }

  private async openExisting(userId: string, id: string, requestedAgentId?: string): Promise<AgentSession | null> {
    const cached = this.harnesses.get(id);
    if (cached) return cached.userId === userId && (!requestedAgentId || cached.agentId === requestedAgentId) ? cached : null;
    const metadata = (await this.repository.list(undefined, TODO_CONTEXT)).find((item) => item.id === id);
    if (!metadata) return null;
    const session = await this.repository.open(metadata, TODO_CONTEXT);
    const owner = await this.readOwner(session);
    if (!owner || owner.userId !== userId || (requestedAgentId && owner.agentId !== requestedAgentId)) {
      await session.close(TODO_CONTEXT);
      return null;
    }
    const definition = this.definitions.get(owner.agentId);
    if (!definition) {
      await session.close(TODO_CONTEXT);
      throw new Error(`Agent definition "${owner.agentId}" is not available`);
    }
    const workspace = resolve(this.config.agentWorkspaceRoot, id);
    mkdirSync(workspace, { recursive: true });
    const value = await this.createRuntime(session, owner.userId, definition, workspace);
    this.harnesses.set(id, value);
    return value;
  }

  private async createRuntime(session: Session, userId: string, definition: AgentDefinition, workspace: string): Promise<AgentSession> {
    const model = this.models.getModel(definition.provider, definition.model);
    if (!model) throw new Error(`Model "${definition.provider}/${definition.model}" not found`);
    const tools = this.createBuiltInTools(definition.tools);
    const { harness } = await AgentHarness.create<ExecutionToolContext>({
      session,
      models: this.models,
      model,
      systemPrompt: definition.systemPrompt,
      tools,
      activeToolNames: tools.map((tool) => tool.name),
      toolContext: { env: new NodeExecutionEnv({ cwd: workspace, shellEnv: {} }) },
      compaction: { enabled: true, reserveTokens: 4096, keepRecentTokens: Math.min(definition.context.maxInputTokens, 16_000) },
    }, TODO_CONTEXT);
    harness.hooks.on("before_tool", ({ toolName, args }) => {
      if (["read", "write", "edit"].includes(toolName) && typeof args.path === "string" && !this.isWorkspacePath(workspace, args.path)) {
        return { block: { reason: "File paths must stay inside the session workspace", terminate: true } };
      }
      return undefined;
    });
    const lane = await harness.lane(MAIN_LANE, { createAt: null }, TODO_CONTEXT);
    return { userId, agentId: definition.id, harness, lane, session, workspace };
  }

  private createBuiltInTools(names: AgentDefinition["tools"]): AgentHarnessTool<ExecutionToolContext>[] {
    return names.map((name) => {
      if (name === "read") return createReadTool();
      if (name === "write") return createWriteTool();
      if (name === "edit") return createEditTool();
      return createBashTool({
        prepare: (execution) => {
          if (forbiddenBash.test(execution.command)) throw new Error("Command is not permitted in the agent workspace");
          execution.cwd = resolve(execution.cwd);
          execution.env = {};
          execution.inheritEnv = false;
        },
      });
    });
  }

  private isWorkspacePath(workspace: string, path: string): boolean {
    const target = resolve(workspace, path);
    const difference = relative(workspace, target);
    return difference === "" || (!difference.startsWith("..") && !difference.includes("../"));
  }

  private async readOwner(session: Session): Promise<SessionOwner | undefined> {
    const entry = await session.findEntry({ type: "custom", customType: SESSION_OWNER_ENTRY, order: "asc" }, TODO_CONTEXT);
    if (!entry || entry.type !== "custom" || !entry.data || typeof entry.data !== "object") return undefined;
    const data = entry.data as Record<string, unknown>;
    return typeof data.userId === "string" && typeof data.agentId === "string"
      ? { userId: data.userId, agentId: data.agentId }
      : undefined;
  }
}
