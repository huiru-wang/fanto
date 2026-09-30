import type { MediaService } from "../domain/media/index.js";
import type { PreferenceCategory, PreferenceService, UserPreference } from "../domain/preferences/index.js";
import type { RecordService } from "../domain/records/index.js";
import type { DelegateTaskInput, DelegateTaskResult, TaskAgentPolicy, TaskPlanAction, TaskRunPlan, TaskRunPlanInput, TaskService, UpdateTaskInput } from "../domain/tasks/index.js";
import type { TaskDeliveryInput, TaskResultPublisher } from "../task-runtime/result-publisher.js";
import type { DeepSeekWebSearchClient, WebSearchResult } from "./web/deepseek-web-search.js";

export type AgentRequestContext = {
  userId: string;
  traceId?: string;
  signal?: AbortSignal;
  sessionId?: string;
  sourceMessageId?: string;
  timeZone?: string;
  task?: { taskId: string; taskRunId: string };
  workspace?: string;
};
export type AgentRecord = NonNullable<Awaited<ReturnType<RecordService["find"]>>>;
export type AgentRecordList = Awaited<ReturnType<RecordService["list"]>>;
export type AgentRecordSearch = { data: Awaited<ReturnType<RecordService["search"]>> };
export type AgentMediaMetadata = NonNullable<Awaited<ReturnType<MediaService["readyMetadata"]>>>;
export type AgentPreference = UserPreference;
export type AgentPreferenceList = { data: AgentPreference[] };
export type AgentPreferenceCategory = PreferenceCategory;

export type AgentBusinessServices = {
  getRecord(context: AgentRequestContext, recordId: string): Promise<AgentRecord>;
  listRecords(context: AgentRequestContext, input: { limit: number; cursor?: string }): Promise<AgentRecordList>;
  searchRecords(context: AgentRequestContext, input: { query: string; limit: number }): Promise<AgentRecordSearch>;
  searchWeb(context: AgentRequestContext, query: string): Promise<WebSearchResult>;
  getMediaMetadata(context: AgentRequestContext, mediaId: string): Promise<AgentMediaMetadata>;
  listPreferences(context: AgentRequestContext): Promise<AgentPreferenceList>;
  createPreference(context: AgentRequestContext, input: { category: AgentPreferenceCategory; content: string; source: { sessionId: string; messageId: string; quote: string } }): Promise<{ preference: AgentPreference; reused: boolean }>;
  updatePreference(context: AgentRequestContext, preferenceId: string, input: { expectedVersion: number; category: AgentPreferenceCategory; content: string; source: { sessionId: string; messageId: string; quote: string } }): Promise<AgentPreference>;
  deletePreference(context: AgentRequestContext, preferenceId: string, expectedVersion: number): Promise<{ preferenceId: string }>;
  createTask(context: AgentRequestContext, input: DelegateTaskInput): Promise<DelegateTaskResult>;
  updateTask(context: AgentRequestContext, taskId: string, input: UpdateTaskInput): Promise<unknown>;
  getTask(context: AgentRequestContext, taskId: string): Promise<unknown>;
  listTasks(context: AgentRequestContext): Promise<unknown>;
  manageTaskPlan(context: AgentRequestContext, input: { action: TaskPlanAction; plan: TaskRunPlanInput }): Promise<TaskRunPlan>;
  deliverTaskResult(context: AgentRequestContext, input: TaskDeliveryInput): Promise<{ mediaId: string; result: unknown }>;
};

async function withRunAbort<T>(context: AgentRequestContext, operation: () => Promise<T>): Promise<T> {
  context.signal?.throwIfAborted();
  const result = await operation();
  context.signal?.throwIfAborted();
  return result;
}

export function createAgentBusinessServices(services: {
  records: RecordService;
  media: MediaService;
  preferences: PreferenceService;
  tasks: TaskService;
  resolveTaskAgent(agentId: string): TaskAgentPolicy | undefined;
  taskResultPublisher?: TaskResultPublisher;
  webSearch: DeepSeekWebSearchClient;
}): AgentBusinessServices {
  return {
    async getRecord(context, recordId) {
      const record = await withRunAbort(context, () => services.records.find(context.userId, recordId));
      if (!record) throw new Error("Record not found or not accessible");
      return record;
    },
    listRecords: (context, input) => withRunAbort(context, () => services.records.list(context.userId, input.cursor, input.limit)),
    async searchRecords(context, input) {
      return { data: await withRunAbort(context, () => services.records.search(context.userId, input.query, input.limit)) };
    },
    searchWeb: (context, query) => withRunAbort(context, () => services.webSearch.search(query, context.signal)),
    async getMediaMetadata(context, mediaId) {
      const media = await withRunAbort(context, () => services.media.readyMetadata(context.userId, mediaId));
      if (!media) throw new Error("Media not found or not accessible");
      return media;
    },
    async listPreferences(context) { return { data: await withRunAbort(context, () => services.preferences.list(context.userId)) }; },
    async createPreference(context, input) {
      const result = await withRunAbort(context, () => services.preferences.create({ userId: context.userId, ...input }));
      if (result.kind === "limit_reached") throw new Error("Preference limit reached");
      return result;
    },
    async updatePreference(context, preferenceId, input) {
      const result = await withRunAbort(context, () => services.preferences.update({ userId: context.userId, preferenceId, ...input }));
      if (result.kind !== "ok") throw new Error(result.kind === "not_found" ? "Preference not found" : "Preference was changed by another request");
      return result.preference;
    },
    async deletePreference(context, preferenceId, expectedVersion) {
      const result = await withRunAbort(context, () => services.preferences.delete({ userId: context.userId, preferenceId, expectedVersion }));
      if (result.kind !== "ok") throw new Error(result.kind === "not_found" ? "Preference not found" : "Preference was changed by another request");
      return { preferenceId: result.preference.preferenceId };
    },
    async createTask(context, input) {
      const policy = services.resolveTaskAgent(input.agentId);
      if (!policy) throw new Error("Task agent is not available");
      return withRunAbort(context, () => services.tasks.delegate({
        userId: context.userId,
        sourceSessionId: context.sessionId,
        sourceMessageId: context.sourceMessageId,
        traceId: context.traceId,
        timeZone: context.timeZone ?? "UTC",
      }, input, policy));
    },
    async updateTask(context, taskId, input) {
      const current = await services.tasks.find(context.userId, taskId);
      if (!current) throw new Error("Task not found or not accessible");
      const policy = services.resolveTaskAgent(current.agentId);
      const task = await withRunAbort(context, () => services.tasks.update(context.userId, taskId, input, policy));
      if (!task) throw new Error("Task could not be updated");
      return task;
    },
    async getTask(context, taskId) {
      const task = await withRunAbort(context, () => services.tasks.find(context.userId, taskId));
      if (!task) throw new Error("Task not found or not accessible");
      const runs = await withRunAbort(context, () => services.tasks.listRuns(context.userId, taskId));
      return { task, runs };
    },
    async listTasks(context) {
      return { data: await withRunAbort(context, () => services.tasks.list(context.userId)) };
    },
    async manageTaskPlan(context, input) {
      const taskContext = context.task;
      if (!taskContext || !context.sessionId) throw new Error("当前 Agent 运行不是任务 Worker，不能管理任务计划。");
      const run = await services.tasks.findRun(context.userId, taskContext.taskId, taskContext.taskRunId);
      if (!run || run.status !== "running") throw new Error("任务执行记录不存在或已经结束，不能管理计划。");
      if (run.workerSessionId !== context.sessionId) throw new Error("当前 Worker Session 与任务执行记录不匹配，不能管理计划。");
      const updated = await withRunAbort(context, () => services.tasks.manageRunPlan({
        userId: context.userId,
        taskId: taskContext.taskId,
        runId: taskContext.taskRunId,
        action: input.action,
        plan: input.plan,
      }));
      if (!updated?.plan) throw new Error("任务计划没有保存成功。");
      return updated.plan;
    },
    async deliverTaskResult(context, input) {
      const taskContext = context.task;
      if (!taskContext || !context.sessionId || !context.workspace) throw new Error("当前 Agent 运行不是任务 Worker，不能交付任务结果。");
      const task = await services.tasks.find(context.userId, taskContext.taskId);
      const run = await services.tasks.findRun(context.userId, taskContext.taskId, taskContext.taskRunId);
      if (!task || !run) throw new Error("任务或执行记录不存在，无法交付结果。");
      if (run.status !== "running") throw new Error(`任务当前状态为 ${run.status}，不能交付结果。`);
      if (run.workerSessionId !== context.sessionId) throw new Error("当前 Worker Session 与任务执行记录不匹配，不能交付结果。");
      if (!run.plan) throw new Error("任务尚未建立执行计划。请先调用 task_plan_manage 创建计划后再交付结果。");
      if (!services.taskResultPublisher) throw new Error("任务结果发布服务不可用。");
      const published = await services.taskResultPublisher.publish(task, run, context.workspace, context.sessionId, input);
      await services.tasks.completeRun({ run, resultMediaId: published.primaryMediaId, result: published.result });
      return { mediaId: published.primaryMediaId, result: published.result };
    },
  };
}
