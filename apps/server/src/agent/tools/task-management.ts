import { Type } from "typebox";
import type { AgentHarnessTool, Context, ExecutionToolContext } from "@earendil-works/pi-agent-core";
import type { AgentBusinessServices } from "../business-services.js";
import { createRunContext } from "../context/index.js";
import type { TaskAgentCatalogEntry } from "../harness/registry.js";
import type { DelegateTaskInput, DelegateTaskResult, TaskOutput, UpdateTaskInput } from "../../domain/tasks/index.js";

type TaskClient = Pick<AgentBusinessServices, "createTask" | "updateTask" | "getTask">;

export type CreateTaskPresentation = {
  kind: "task_created";
  task: DelegateTaskResult;
};

export function sanitizeCreateTaskDetails(value: unknown): CreateTaskPresentation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const root = value as Record<string, unknown>;
  if (root.kind !== "task_created" || !root.task || typeof root.task !== "object") return undefined;
  const task = root.task as Record<string, unknown>;
  if (typeof task.taskId !== "string" || typeof task.title !== "string" || task.status !== "active" || typeof task.nextRunAt !== "string") return undefined;
  const output = task.output;
  if (!output || typeof output !== "object") return undefined;
  const format = (output as Record<string, unknown>).format;
  if (format !== "markdown" && format !== "text" && format !== "html") return undefined;
  const trigger = task.trigger;
  if (!trigger || typeof trigger !== "object") return undefined;
  const triggerValue = trigger as Record<string, unknown>;
  if (triggerValue.type !== "immediate" && triggerValue.type !== "scheduled") return undefined;
  if (triggerValue.type === "scheduled") {
    const schedule = triggerValue.schedule;
    if (!schedule || typeof schedule !== "object") return undefined;
    const scheduleValue = schedule as Record<string, unknown>;
    if ((scheduleValue.type !== "once" && scheduleValue.type !== "recurring") || typeof scheduleValue.timezone !== "string") return undefined;
    if (scheduleValue.type === "once" && typeof scheduleValue.at !== "string") return undefined;
    if (scheduleValue.type === "recurring" && (typeof scheduleValue.rrule !== "string" || typeof scheduleValue.startAt !== "string")) return undefined;
  }
  return {
    kind: "task_created",
    task: {
      taskId: task.taskId,
      title: task.title,
      status: "active",
      trigger: trigger as DelegateTaskResult["trigger"],
      nextRunAt: task.nextRunAt,
      output: { format },
    },
  };
}

type DelegateTaskParams = {
  title: string;
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
  output: TaskOutput;
  references?: { recordIds?: string[] };
};

const goalSchema = Type.Object({
  objective: Type.String({
    minLength: 1,
    maxLength: 4000,
    description: "最终要交付给用户什么。只描述结果本身，不写工具、文件路径、媒体协议或执行步骤。",
  }),
  context: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 12000,
    description: "保留完成任务真正需要的用户原始诉求、用途、人物、场景、素材背景和已确认信息。不要压缩成一句抽象摘要，也不要加入技术实现细节。",
  })),
  constraints: Type.Optional(Type.Array(
    Type.String({ minLength: 1, maxLength: 1000 }),
    { maxItems: 20, description: "用户真正关心的风格、内容、范围与禁止项。不要写 Fanto 内部实现约束。" },
  )),
  successCriteria: Type.Optional(Type.Array(
    Type.String({ minLength: 1, maxLength: 1000 }),
    { maxItems: 20, description: "从用户视角判断任务是否做好的验收标准。" },
  )),
}, { additionalProperties: false });

const referencesSchema = Type.Object({
  recordIds: Type.Optional(Type.Array(
    Type.String({ minLength: 1, maxLength: 100 }),
    { maxItems: 20, description: "已确认与任务直接相关、需要 Worker 回查的真实 Record ID。不要传 mediaId。" },
  )),
}, { additionalProperties: false });

const scheduleSchema = Type.Object({
  type: Type.Union([Type.Literal("once"), Type.Literal("recurring")]),
  at: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  timezone: Type.String({ minLength: 1, maxLength: 100 }),
  rrule: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
  startAt: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
}, { additionalProperties: false });

const outputSchema = Type.Object({
  format: Type.Union([Type.Literal("markdown"), Type.Literal("text"), Type.Literal("html")], {
    description: "最终交付格式。必须与用户明确要求一致；用户要求 HTML 时必须填写 html。",
  }),
}, { additionalProperties: false });

export function createTaskSchema() {
  return Type.Object({
    title: Type.String({ minLength: 1, maxLength: 200, description: "面向用户的简洁任务名称。" }),
    goal: goalSchema,
    trigger: Type.Object({
      type: Type.Union([Type.Literal("immediate"), Type.Literal("scheduled")]),
      schedule: Type.Optional(scheduleSchema),
    }, { additionalProperties: false }),
    output: outputSchema,
    references: Type.Optional(referencesSchema),
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

function taskAgent(taskAgents: readonly TaskAgentCatalogEntry[]): TaskAgentCatalogEntry {
  if (taskAgents.length === 0) throw new Error("create_task requires one task-enabled sub-agent");
  if (taskAgents.length > 1) throw new Error("create_task currently requires exactly one task-enabled sub-agent");
  return taskAgents[0]!;
}

function toInput(params: DelegateTaskParams, taskAgents: readonly TaskAgentCatalogEntry[]): DelegateTaskInput {
  return {
    title: params.title.trim(),
    agentId: taskAgent(taskAgents).id,
    goal: {
      objective: params.goal.objective.trim(),
      ...(params.goal.context?.trim() ? { context: params.goal.context.trim() } : {}),
      ...(params.goal.constraints?.length ? { constraints: params.goal.constraints } : {}),
      ...(params.goal.successCriteria?.length ? { successCriteria: params.goal.successCriteria } : {}),
    },
    trigger: toTrigger(params.trigger),
    output: params.output,
    ...(params.references ? { references: params.references } : {}),
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

export function createCreateTaskTool(
  client: TaskClient,
  taskAgents: readonly TaskAgentCatalogEntry[],
): AgentHarnessTool<ExecutionToolContext, ReturnType<typeof createTaskSchema>, CreateTaskPresentation> {
  taskAgent(taskAgents);
  return {
    name: "create_task",
    label: "创建后台任务",
    description: [
      "把一个已经理解清楚、适合后台独立完成或按时间执行的用户目标交给 Fanto 后台。",
      "goal 是用户需求说明，不是 Worker 技术指令：objective 写最终结果；context 保留必要的原始诉求和背景；constraints 写用户真实边界；successCriteria 写用户视角的验收标准。",
      "不要在 goal 中出现 Workspace、Tool、文件路径、result.html、mediaId、fanto-media、OSS 等内部实现概念。",
      "output.format 必填并与用户要求一致。references 只传已确认相关的 Record ID。",
    ].join("\n"),
    parameters: createTaskSchema(),
    executionMode: "sequential",
    replay: "never",
    async execute(_toolCallId, params, _onUpdate, _toolContext, _invocation, context) {
      const task = await client.createTask(requestContext(context), toInput(params as DelegateTaskParams, taskAgents));
      return result({ kind: "task_created" as const, task });
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
  output: Type.Optional(outputSchema),
  references: Type.Optional(referencesSchema),
  status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("paused"), Type.Literal("cancelled")])),
}, { additionalProperties: false });

const getSchema = Type.Object({ taskId: Type.String({ minLength: 1 }) }, { additionalProperties: false });

export function createUpdateTaskTool(
  client: TaskClient,
): AgentHarnessTool<ExecutionToolContext, typeof updateSchema, unknown> {
  return {
    name: "update_task",
    label: "更新后台任务",
    description: "更新已有任务的用户目标、标题、调度、交付格式、相关记录或状态。taskId 来自此前创建任务或 get_task 的结果。",
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
        ...(value.output ? { output: value.output } : {}),
        ...(value.references ? { references: value.references } : {}),
        ...(value.status ? { status: value.status } : {}),
      };
      return result(await client.updateTask(requestContext(context), taskId, input));
    },
  };
}

export function createGetTaskTool(client: TaskClient): AgentHarnessTool<ExecutionToolContext, typeof getSchema, unknown> {
  return {
    name: "get_task",
    label: "查看后台任务",
    description: "读取一个已存在的后台任务及其执行记录。taskId 必须来自当前任务上下文或此前 create_task 的真实结果。",
    parameters: getSchema,
    executionMode: "parallel",
    replay: "safe",
    async execute(_toolCallId, params, _onUpdate, _toolContext, _invocation, context) {
      return result(await client.getTask(requestContext(context), params.taskId));
    },
  };
}
