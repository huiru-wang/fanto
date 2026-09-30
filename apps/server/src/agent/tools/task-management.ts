import { Type } from "typebox";
import type { AgentHarnessTool, Context, ExecutionToolContext } from "@earendil-works/pi-agent-core";
import type { AgentBusinessServices } from "../business-services.js";
import { createRunContext } from "../context/index.js";
import type { TaskAgentCatalogEntry } from "../harness/registry.js";
import type { DelegateTaskInput, DelegateTaskResult, TaskResultFormat, UpdateTaskInput } from "../../domain/tasks/index.js";

type TaskClient = Pick<AgentBusinessServices, "createTask" | "updateTask" | "getTask">;

type DelegateTaskParams = {
  title: string;
  agentId: string;
  goal: {
    objective: string;
    context?: string;
    constraints?: string[];
    successCriteria?: string[];
  };
  trigger: {
    type: "immediate" | "scheduled";
    schedule?: {
      type: "once" | "recurring";
      at?: string;
      timezone: string;
      rrule?: string;
      startAt?: string;
    };
  };
  timeoutSeconds?: number;
  result?: { format?: TaskResultFormat };
  sources?: { recordIds?: string[]; mediaIds?: string[] };
};

const goalSchema = Type.Object({
  objective: Type.String({ minLength: 1, maxLength: 4000, description: "任务最终要达成的目标。描述结果，不要写执行步骤。" }),
  context: Type.Optional(Type.String({ minLength: 1, maxLength: 8000, description: "完成目标所需的必要背景，不要复制完整聊天历史。" })),
  constraints: Type.Optional(Type.Array(
    Type.String({ minLength: 1, maxLength: 1000 }),
    { maxItems: 20, description: "必须遵守的边界、禁止事项或范围限制。" },
  )),
  successCriteria: Type.Optional(Type.Array(
    Type.String({ minLength: 1, maxLength: 1000 }),
    { maxItems: 20, description: "判断目标是否完成的标准。" },
  )),
}, { additionalProperties: false });

const sourcesSchema = Type.Object({
  recordIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { maxItems: 20, description: "任务必须回查的真实 Record ID。" })),
  mediaIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { maxItems: 20, description: "任务关联的真实 Media ID，仅在已知时填写。" })),
}, { additionalProperties: false });

const scheduleSchema = Type.Object({
  type: Type.Union([Type.Literal("once"), Type.Literal("recurring")]),
  at: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  timezone: Type.String({ minLength: 1, maxLength: 100 }),
  rrule: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
  startAt: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
}, { additionalProperties: false });

export function createTaskSchema(taskAgents: readonly TaskAgentCatalogEntry[]) {
  if (taskAgents.length === 0) throw new Error("create_task requires at least one task-enabled sub-agent");
  const agentIdSchema = Type.Union(
    taskAgents.map(agent => Type.Literal(agent.id)),
    {
      description: [
        "执行该目标的后台 Agent ID。必须从可用 Agent 中选择：",
        ...taskAgents.map(agent => `- ${agent.id}: ${agent.description || "后台任务 Agent"}`),
      ].join("\n"),
    },
  );
  return Type.Object({
    title: Type.String({ minLength: 1, maxLength: 200 }),
    agentId: agentIdSchema,
    goal: goalSchema,
    trigger: Type.Object({
      type: Type.Union([Type.Literal("immediate"), Type.Literal("scheduled")]),
      schedule: Type.Optional(scheduleSchema),
    }, { additionalProperties: false }),
    timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 86400 })),
    result: Type.Optional(Type.Object({
      format: Type.Optional(Type.Union([Type.Literal("markdown"), Type.Literal("text"), Type.Literal("html")])),
    }, { additionalProperties: false })),
    sources: Type.Optional(sourcesSchema),
  }, { additionalProperties: false });
}

function requestContext(context: Context) {
  const run = createRunContext.read(context);
  return {
    userId: run.userId,
    traceId: run.traceId,
    signal: context.abortSignal,
    sessionId: run.sessionId,
    sourceMessageId: run.sourceMessageId,
    timeZone: run.timeZone,
  };
}

function toTrigger(params: DelegateTaskParams["trigger"]): DelegateTaskInput["trigger"] {
  if (params.type === "immediate") {
    if (params.schedule) throw new Error("Immediate task must not include schedule");
    return { type: "immediate" };
  }

  const schedule = params.schedule;
  if (!schedule) throw new Error("Scheduled task requires schedule");
  assertTimeZone(schedule.timezone);
  if (schedule.type === "once") {
    if (!schedule.at) throw new Error("Once schedule requires at");
    assertDate(schedule.at, "schedule.at");
    return { type: "scheduled", schedule: { type: "once", at: schedule.at, timezone: schedule.timezone } };
  }

  if (!schedule.rrule) throw new Error("Recurring schedule requires rrule");
  if (schedule.startAt) assertDate(schedule.startAt, "schedule.startAt");
  return {
    type: "scheduled",
    schedule: {
      type: "recurring",
      rrule: schedule.rrule,
      timezone: schedule.timezone,
      ...(schedule.startAt ? { startAt: schedule.startAt } : {}),
    },
  };
}

function toInput(params: DelegateTaskParams, taskAgents: readonly TaskAgentCatalogEntry[]): DelegateTaskInput {
  if (!taskAgents.some(agent => agent.id === params.agentId)) {
    throw new Error(`Task agent "${params.agentId}" is not available`);
  }
  return {
    title: params.title.trim(),
    agentId: params.agentId,
    goal: {
      objective: params.goal.objective.trim(),
      ...(params.goal.context?.trim() ? { context: params.goal.context.trim() } : {}),
      ...(params.goal.constraints?.length ? { constraints: params.goal.constraints } : {}),
      ...(params.goal.successCriteria?.length ? { successCriteria: params.goal.successCriteria } : {}),
    },
    trigger: toTrigger(params.trigger),
    ...(params.timeoutSeconds !== undefined ? { timeoutSeconds: params.timeoutSeconds } : {}),
    ...(params.result ? { result: params.result } : {}),
    ...(params.sources ? { sources: params.sources } : {}),
  };
}

function assertTimeZone(value: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
  } catch {
    throw new Error("schedule.timezone must be a valid IANA time zone");
  }
}

function assertDate(value: string, field: string): void {
  if (!Number.isFinite(new Date(value).getTime())) throw new Error(`${field} must be a valid ISO date-time`);
}

function result<T>(details: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(details) }],
    details,
  };
}

function toolDescription(taskAgents: readonly TaskAgentCatalogEntry[]): string {
  return [
    "当目标适合在后台独立完成、需要较长时间或需要按指定时间执行时使用。",
    "用 goal 描述要达成什么，不要替子 Agent 规划步骤。任务创建后不会立即执行；由后台调度器统一领取。",
    "任务依赖已读取的 Record 或 Media 时，必须在 sources 中传入真实 ID，供 Worker 回查原始资料。",
    "可用后台 Agent：",
    ...taskAgents.map(agent => `- ${agent.id}: ${agent.description || "后台任务 Agent"}`),
  ].join("\n");
}

export function createCreateTaskTool(
  client: TaskClient,
  taskAgents: readonly TaskAgentCatalogEntry[],
): AgentHarnessTool<ExecutionToolContext, ReturnType<typeof createTaskSchema>, DelegateTaskResult> {
  const schema = createTaskSchema(taskAgents);
  return {
    name: "create_task",
    label: "创建后台任务",
    description: toolDescription(taskAgents),
    parameters: schema,
    executionMode: "sequential",
    replay: "never",
    async execute(_toolCallId, params, _onUpdate, _toolContext, _invocation, context) {
      return result(await client.createTask(requestContext(context), toInput(params as DelegateTaskParams, taskAgents)));
    },
  };
}

const updateSchema = Type.Object({
  taskId: Type.String({ minLength: 1 }),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  goal: Type.Optional(goalSchema),
  trigger: Type.Optional(Type.Object({
    type: Type.Union([Type.Literal("immediate"), Type.Literal("scheduled")]),
    schedule: Type.Optional(scheduleSchema),
  }, { additionalProperties: false })),
  timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 86400 })),
  result: Type.Optional(Type.Object({ format: Type.Optional(Type.Union([Type.Literal("markdown"), Type.Literal("text"), Type.Literal("html")])) }, { additionalProperties: false })),
  sources: Type.Optional(sourcesSchema),
  status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("paused"), Type.Literal("cancelled")])),
}, { additionalProperties: false });

const getSchema = Type.Object({ taskId: Type.String({ minLength: 1 }) }, { additionalProperties: false });

export function createUpdateTaskTool(
  client: TaskClient,
): AgentHarnessTool<ExecutionToolContext, typeof updateSchema, unknown> {
  return {
    name: "update_task",
    label: "更新后台任务",
    description: "更新已有任务的目标、标题、调度、产出格式、超时或状态。taskId 来自此前创建任务或 get_task 的结果。",
    parameters: updateSchema,
    executionMode: "sequential",
    replay: "never",
    async execute(_toolCallId, params, _onUpdate, _toolContext, _invocation, context) {
      const { taskId, ...value } = params as typeof params & { taskId: string };
      if (Object.keys(value).length === 0) throw new Error("至少需要提供一个要更新的字段。");
      const input: UpdateTaskInput = {
        ...(value.title !== undefined ? { title: value.title } : {}),
        ...(value.goal ? { goal: value.goal } : {}),
        ...(value.trigger ? { trigger: toTrigger(value.trigger) } : {}),
        ...(value.timeoutSeconds !== undefined ? { timeoutSeconds: value.timeoutSeconds } : {}),
        ...(value.result ? { result: value.result } : {}),
        ...(value.sources ? { sources: value.sources } : {}),
        ...(value.status ? { status: value.status } : {}),
      };
      return result(await client.updateTask(requestContext(context), taskId, input));
    },
  };
}

export function createGetTaskTool(client: TaskClient): AgentHarnessTool<ExecutionToolContext, typeof getSchema, unknown> {
  return {
    name: "get_task",
    label: "查询后台任务",
    description: "读取任务定义、执行记录、Worker Session 和已交付文件。",
    parameters: getSchema,
    executionMode: "parallel",
    replay: "safe",
    async execute(_toolCallId, params, _onUpdate, _toolContext, _invocation, context) {
      return result(await client.getTask(requestContext(context), params.taskId));
    },
  };
}
