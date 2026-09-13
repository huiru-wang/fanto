import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import type { AgentHarnessManager } from "../../harness-manager.js";
import { logProactiveCreation } from "../../../infrastructure/logger.js";
import type { RecordRepository } from "../../../modules/record/record.repository.js";
import type { Record } from "../../../modules/record/record.js";
import { SqliteCreationRepository, type Creation } from "../../../modules/creation/creation.repository.js";
import { SqliteTaskRepository } from "../../../modules/task/task.repository.js";

const taskSchema = z.object({ recordIds: z.array(z.string().uuid()).min(1).max(20), goal: z.string().min(1).max(2_000), reason: z.string().min(1).max(2_000), creationId: z.string().uuid().optional() }).strict();
const plannerSchema = z.object({ tasks: z.array(taskSchema).max(3) }).strict();
const threadSchema = z.object({ title: z.string().min(1).max(200), overview: z.string().min(1).max(1_000), content: z.string().min(1).max(8_000) }).strict();
type PlannerTask = z.infer<typeof taskSchema>;

const safeJson = (content: unknown) => {
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((part: any) => part.text ?? "").join("") : "";
  const trimmed = text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed);
};
const recordView = (record: Record) => ({ id: record.id, createdAt: record.createdAt, text: record.content.text, blocks: record.content.blocks });
const creationView = (creation: Creation) => ({ id: creation.id, title: creation.title, version: creation.version, summary: creation.summary, content: creation.content });

export class ProactiveCreationWorkflow {
  constructor(private readonly records: RecordRepository, private readonly creations: SqliteCreationRepository, private readonly tasks: SqliteTaskRepository, private readonly sessions: AgentHarnessManager) {}

  async startManual(userId: string) {
    return this.run(await this.tasks.create(userId, "proactive_creation", { schemaVersion: 1, trigger: "manual" }));
  }

  async run(taskId: string) {
    const task = await this.tasks.claim(taskId);
    if (!task) throw new Error("Task is missing or cannot be claimed");
    if (task.type !== "proactive_creation") { await this.tasks.fail(taskId, "UNSUPPORTED_TASK_TYPE", task.type); throw new Error(`Unsupported task type: ${task.type}`); }
    const userId = task.userId;
    logProactiveCreation("info", "workflow started", { taskId, userId });
    try {
      const claimed = await this.records.claimForTask(userId, taskId, 50);
      logProactiveCreation("info", "records claimed", { taskId, userId, count: claimed.length, recordIds: claimed.map(item => item.id) });
      if (!claimed.length) { await this.tasks.complete(taskId); return { taskId, claimedRecordCount: 0, proposalIds: [] as string[] }; }
      const active = await this.creations.activeByUser(userId);
      const pending = await this.creations.listProposals(userId, "pending_confirmation");
      const unavailableUpdates = await this.creations.activeUpdateCreationIds(userId);
      const updateTargets = active.filter(item => !unavailableUpdates.has(item.id));
      const consumed = new Set<string>(); const proposalIds: string[] = [];
      const updateTasks = updateTargets.length ? this.validateTasks(await this.plan(taskId, userId, "proposal-update-agent", { records: claimed.map(recordView), creations: updateTargets.map(creationView), pendingProposals: pending.map(item => ({ creationId: item.creationId, title: item.title, summary: item.summary })) }), claimed, new Set(updateTargets.map(item => item.id)), true) : [];
      logProactiveCreation("info", "update planner completed", { taskId, userId, taskCount: updateTasks.length });
      for (const task of updateTasks) {
        const target = updateTargets.find(item => item.id === task.creationId)!;
        const proposalId = await this.writeThreadProposal(taskId, userId, "update", task, claimed, target);
        proposalIds.push(proposalId); task.recordIds.forEach(id => consumed.add(id));
      }
      const remaining = claimed.filter(item => !consumed.has(item.id));
      const createTasks = remaining.length ? this.validateTasks(await this.plan(taskId, userId, "proposal-create-agent", { records: remaining.map(recordView), creations: active.map(creationView), pendingProposals: pending.map(item => ({ title: item.title, summary: item.summary })) }), remaining, new Set(), false) : [];
      logProactiveCreation("info", "create planner completed", { taskId, userId, taskCount: createTasks.length });
      for (const task of createTasks) proposalIds.push(await this.writeThreadProposal(taskId, userId, "create", task, remaining));
      await this.records.finishTask(userId, taskId);
      await this.tasks.complete(taskId);
      logProactiveCreation("info", "workflow completed", { taskId, userId, claimedRecordCount: claimed.length, proposalIds });
      return { taskId, claimedRecordCount: claimed.length, proposalIds };
    } catch (cause) {
      await this.records.releaseTask(userId, taskId);
      await this.tasks.fail(taskId, this.failureCode(cause), cause instanceof Error ? cause.message : String(cause));
      logProactiveCreation("error", "workflow failed", { taskId, userId, error: cause instanceof Error ? cause.message : String(cause) });
      throw cause;
    }
  }

  private async plan(taskId: string, userId: string, agentId: "proposal-update-agent" | "proposal-create-agent", input: unknown): Promise<PlannerTask[]> {
    const sessionId = randomUUID();
    await this.tasks.addSession(taskId, { role: agentId === "proposal-update-agent" ? "update_planner" : "create_planner", agentId, sessionId });
    const output = await this.promptJson(userId, agentId, JSON.stringify(input), sessionId);
    return plannerSchema.parse(output).tasks;
  }

  private validateTasks(tasks: PlannerTask[], records: Record[], creationIds: Set<string>, updating: boolean) {
    const allowed = new Set(records.map(item => item.id)); const used = new Set<string>();
    return tasks.filter(task => {
      if (updating !== !!task.creationId || (task.creationId && !creationIds.has(task.creationId))) return false;
      if (task.recordIds.some(id => !allowed.has(id) || used.has(id))) return false;
      task.recordIds.forEach(id => used.add(id)); return true;
    });
  }

  private async writeThreadProposal(taskId: string, userId: string, operation: "create" | "update", task: PlannerTask, allRecords: Record[], target?: Creation) {
    const sessionId = randomUUID();
    const proposalId = await this.creations.startProposal({ userId, operation, creationId: target?.id, baseCreationVersion: target?.version, sessionId });
    await this.tasks.addSession(taskId, { role: "thread_proposal", agentId: "thread-agent", sessionId, proposalId });
    logProactiveCreation("info", "proposal generation started", { proposalId, userId, operation, creationId: target?.id ?? null, recordIds: task.recordIds });
    const records = allRecords.filter(item => task.recordIds.includes(item.id)).map(recordView);
    try {
      const output = threadSchema.parse(await this.promptJson(userId, "thread-agent", JSON.stringify({ task, records, currentCreation: target ? creationView(target) : null }), sessionId));
      const summary = { schemaVersion: 1, overview: output.overview, summaryVersion: 1 };
      const saved = await this.creations.completeProposal(userId, proposalId, { title: output.title, summary, content: output.content, source: { records: task.recordIds, creations: target ? [target.id] : [], web: [] } });
      if (!saved) throw new Error(`Proposal ${proposalId} could not be completed`);
      logProactiveCreation("info", "proposal pending confirmation", { proposalId, userId, operation });
      return proposalId;
    } catch (cause) {
      const code = this.failureCode(cause);
      await this.creations.failProposal(userId, proposalId, code, cause instanceof Error ? cause.message : String(cause));
      logProactiveCreation("error", "proposal failed", { proposalId, userId, operation, errorCode: code });
      throw cause;
    }
  }

  private failureCode(cause: unknown) { return cause instanceof z.ZodError || cause instanceof SyntaxError ? "INVALID_AGENT_OUTPUT" : "AGENT_RUN_FAILED"; }

  private async promptJson(userId: string, agentId: string, prompt: string, sessionId: string) {
    const session = await this.sessions.getOrCreate(userId, sessionId, agentId);
    if (!session) throw new Error(`Unable to create ${agentId} session`);
    const result = await session.lane.prompt(prompt, undefined, TODO_CONTEXT);
    if (!result.ok) throw new Error(`Agent rejected run: ${result.error.message}`);
    if (result.value.status !== "completed") throw new Error(`Agent run ${result.value.status}${"error" in result.value && result.value.error ? `: ${result.value.error.message}` : ""}`);
    const entries = await session.lane.findEntries({ order: "newestFirst", limit: 10 }, TODO_CONTEXT);
    const message = entries.find(entry => entry.type === "message" && entry.message.role === "assistant");
    if (!message || message.type !== "message") throw new Error("Agent completed without an assistant message");
    return safeJson((message.message as any).content);
  }
}
