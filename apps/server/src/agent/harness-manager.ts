import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { AgentHarness, createBashTool, type Entry, type HarnessTool } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { createNodeSqliteFactory, SqliteSessionRepository } from "@earendil-works/pi-session-backend-sqlite-node";
import { createGetRecordsTool, createSearchRecordsTool } from "./tools/record-memory.js";
import type { RecordMemoryService } from "../application/memory/record-memory.js";
import type { AppConfig } from "../env.js";

const sessionId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const forbiddenBash = /(^|[\s;|&])(rm\s+-[a-z]*r|sudo\b|su\b|mount\b|chmod\s+-R|chown\s+-R|curl\b|wget\b|nc\b|ssh\b)/;

export type AgentSession = { userId: string; harness: AgentHarness; workspace: string };

export class AgentHarnessManager {
  private readonly repository: SqliteSessionRepository;
  private readonly harnesses = new Map<string, AgentSession>();
  private readonly models = builtinModels();

  constructor(private readonly config: AppConfig, private readonly memory: RecordMemoryService) {
    mkdirSync(config.agentWorkspaceRoot, { recursive: true });
    const env = new NodeExecutionEnv({ cwd: config.agentWorkspaceRoot });
    this.repository = new SqliteSessionRepository({ env, sqlite: createNodeSqliteFactory(), databasePath: config.agentSessionDatabasePath });
  }

  async getOrCreate(userId: string, id: string): Promise<AgentSession | null> {
    if (!sessionId.test(id)) return null;
    const cached = this.harnesses.get(id);
    if (cached) return cached.userId === userId ? cached : null;
    const metadata = (await this.repository.list()).find(item => item.id === id);
    if (metadata && metadata.metadata?.userId !== userId) return null;
    const workspace = resolve(this.config.agentWorkspaceRoot, id);
    const session = metadata
      ? await this.repository.open(metadata)
      : await this.repository.create({ id, cwd: workspace, metadata: { userId } });
    const model = this.models.getModel(this.config.provider, this.config.model)
      ?? this.models.getModels().find(item => item.id === this.config.model);
    if (!model) throw new Error(`Model "${this.config.model}" not found`);
    mkdirSync(workspace, { recursive: true });
    const executionEnv = new NodeExecutionEnv({ cwd: workspace, shellEnv: {} });
    const bash = createBashTool({
      prepare: execution => {
        if (forbiddenBash.test(execution.command)) throw new Error("Command is not permitted in the agent workspace");
        execution.cwd = workspace;
        execution.env = {};
        execution.inheritEnv = false;
      },
    });
    const searchRecords = createSearchRecordsTool(); const getRecords = createGetRecordsTool();
    const created = await AgentHarness.create({
      session,
      models: this.models,
      model,
      tools: [bash as unknown as HarnessTool, searchRecords as unknown as HarnessTool, getRecords as unknown as HarnessTool],
      activeToolNames: [bash.name, searchRecords.name, getRecords.name],
      toolContext: { env: executionEnv, userId, memory: this.memory },
      toolExecution: "sequential",
    });
    const value = { userId, harness: created.harness, workspace };
    this.harnesses.set(id, value);
    return value;
  }

  async entries(userId: string, id: string, afterSeq = 0, limit = 50): Promise<Entry[] | null> {
    if (!sessionId.test(id)) return null;
    const cached = this.harnesses.get(id);
    if (cached) return cached.userId === userId ? cached.harness.session.findEntries({ order: "oldestFirst", cursor: { afterSeq }, limit }) : null;
    const metadata = (await this.repository.list()).find(item => item.id === id);
    if (!metadata || metadata.metadata?.userId !== userId) return null;
    return (await this.repository.open(metadata)).findEntries({ order: "oldestFirst", cursor: { afterSeq }, limit });
  }

  async close() {
    await Promise.all([...this.harnesses.values()].map(item => item.harness.close()));
    this.harnesses.clear();
    await this.repository.close();
  }
}
