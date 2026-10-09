import type { CreativeService } from "../domain/projects/creative-service.js";
import type { CreativeContext, ImageInput, ProjectManageInput } from "../domain/projects/creative-model.js";
import type { CreateProposalInput } from "../domain/projects/index.js";
import type { MediaService } from "../domain/media/index.js";
import type { RecordService } from "../domain/records/index.js";
import type { DelegateTaskInput, DelegateTaskResult, TaskAgentPolicy, TaskPlanAction, TaskRunPlan, TaskRunPlanInput, TaskService, UpdateTaskInput } from "../domain/tasks/index.js";
import type { TaskDeliveryInput, TaskResultPublisher } from "../domain/tasks/result-publisher.js";
import type { Memory, MemoryKind, MemorySearchResult, MemoryService } from "../domain/memory/index.js";
import type { DeepSeekWebSearchClient, WebSearchResult } from "./web/deepseek-web-search.js";

export type AgentRequestContext = {
  userId: string;
  projectId?: string;
  recordId?: string;
  recordVersion?: number;
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
export type AgentMemory = Omit<Memory, "userId">;
export type AgentMemorySearch = Omit<MemorySearchResult, "userId">;

export type AgentBusinessServices = {
  creativeContext?(context: AgentRequestContext): ReturnType<CreativeService["context"]>;
  readProject?(context: AgentRequestContext, input: Parameters<CreativeService["readProject"]>[1]): ReturnType<CreativeService["readProject"]>;
  createProposal?(context: AgentRequestContext, input: CreateProposalInput): ReturnType<CreativeService["createProposal"]>;
  getTaskExecution(context: AgentRequestContext, taskId: string, runId: string): Promise<{ task: NonNullable<Awaited<ReturnType<TaskService["find"]>>>; run: NonNullable<Awaited<ReturnType<TaskService["findRun"]>>> }>;
  generateImage?(context: AgentRequestContext, input: ImageInput): ReturnType<CreativeService["generateImage"]>;
  reviewImage?(context: AgentRequestContext, input: {mediaId: string; brief: string; referenceMediaIds?: string[]}): ReturnType<CreativeService["reviewImage"]>;
  manageProject?(context: AgentRequestContext, input: ProjectManageInput): ReturnType<CreativeService["projectManage"]>;
  readRecords(context: AgentRequestContext, input: { recordIds?: string[]; query?: string }): Promise<AgentRecord[]>;
  listRecords(context: AgentRequestContext, input: { limit: number; cursor?: string }): Promise<AgentRecordList>;
  searchRecords(context: AgentRequestContext, input: { query: string; limit: number }): Promise<AgentRecordSearch>;
  searchWeb(context: AgentRequestContext, query: string): Promise<WebSearchResult>;
  getMediaMetadata(context: AgentRequestContext, mediaId: string): Promise<AgentMediaMetadata>;
  createTask(context: AgentRequestContext, input: DelegateTaskInput): Promise<DelegateTaskResult>;
  updateTask(context: AgentRequestContext, taskId: string, input: UpdateTaskInput): Promise<unknown>;
  getTask(context: AgentRequestContext, taskId: string): Promise<unknown>;
  listTasks(context: AgentRequestContext): Promise<unknown>;
  listMemories(context: AgentRequestContext, input?: { kind?: MemoryKind }): Promise<AgentMemory[]>;
  searchMemories(context: AgentRequestContext, input: { query: string; limit: number }): Promise<AgentMemorySearch[]>;
  createMemory(context: AgentRequestContext, input: { kind: MemoryKind; content: string }): Promise<AgentMemory>;
  updateMemory(context: AgentRequestContext, memoryId: string, input: { kind: MemoryKind; content: string }): Promise<AgentMemory>;
  deleteMemory(context: AgentRequestContext, memoryId: string): Promise<void>;
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
  creative?: CreativeService;
  media: MediaService;
  tasks: TaskService;
  memories: MemoryService;
  resolveTaskAgent(agentId: string): TaskAgentPolicy | undefined;
  taskResultPublisher?: TaskResultPublisher;
  webSearch: DeepSeekWebSearchClient;
}): AgentBusinessServices {
  const creative = () => { if (!services.creative) throw new Error("CREATIVE_AGENT_DISABLED"); return services.creative; };
  return {
    creativeContext: context => creative().context(context),
    readProject: (context, input) => creative().readProject(context, input),
    createProposal: (context, input) => creative().createProposal(context, input),
    generateImage: (context, input) => creative().generateImage(context, input),
    reviewImage: (context, input) => creative().reviewImage(context, input),
    manageProject: (context, input) => creative().projectManage(context, input),
    async readRecords(context, input) {
      if (context.recordId || context.projectId) return withRunAbort(context, () => creative().readRecords(context, input));
      const recordIds = input.recordIds
        ?? (await withRunAbort(context, () => services.records.search(context.userId, input.query!, 3))).map(result => result.recordId);
      return withRunAbort(context, () => services.records.findMany(context.userId, recordIds));
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
    async getTaskExecution(context, taskId, runId) {
      return withRunAbort(context, async () => {
        const task = await services.tasks.find(context.userId, taskId);
        const run = await services.tasks.findRun(context.userId, taskId, runId);
        if (!task || !run) throw new Error("TASK_AUTHORITY_REQUIRED");
        return { task, run };
      });
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
    async listMemories(context, input = {}) {
      const memories = await withRunAbort(context, () => services.memories.list(context.userId, input));
      return memories.map(({ userId: _userId, ...memory }) => memory);
    },
    async searchMemories(context, input) {
      const memories = await withRunAbort(context, () => services.memories.search(context.userId, input.query, input.limit));
      return memories.map(({ userId: _userId, ...memory }) => memory);
    },
    async createMemory(context, input) {
      const memory = await withRunAbort(context, () => services.memories.create(context.userId, input));
      const { userId: _userId, ...result } = memory;
      return result;
    },
    async updateMemory(context, memoryId, input) {
      const memory = await withRunAbort(context, () => services.memories.update(context.userId, memoryId, input));
      if (!memory) throw new Error("Memory not found or not accessible");
      const { userId: _userId, ...result } = memory;
      return result;
    },
    async deleteMemory(context, memoryId) {
      const deleted = await withRunAbort(context, () => services.memories.remove(context.userId, memoryId));
      if (!deleted) throw new Error("Memory not found or not accessible");
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
