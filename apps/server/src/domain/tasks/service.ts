import rrulePackage from "rrule";
import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
import { logInfo } from "../../infrastructure/logging/logger.js";
import type {
  DelegateTaskContext,
  DelegateTaskInput,
  DelegateTaskResult,
  ScheduledTaskTrigger,
  Task,
  TaskAgentPolicy,
  TaskRun,
  TaskTrigger,
  UpdateTaskInput,
} from "./model.js";
import { TaskRepository } from "./repository.js";

const { RRule } = rrulePackage;

export class TaskService {
  private readonly repository: TaskRepository;

  constructor(
    db: Kysely<DB>,
    private readonly timeoutBounds: { minSeconds: number; maxSeconds: number },
  ) {
    this.repository = new TaskRepository(db);
  }

  async delegate(
    context: DelegateTaskContext,
    input: DelegateTaskInput,
    policy: TaskAgentPolicy,
  ): Promise<DelegateTaskResult> {
    const now = new Date();
    const taskId = crypto.randomUUID();
    const title = input.title.trim();
    if (!title) throw new Error("Task title must not be empty");
    const timeoutSeconds = this.resolveTimeout(input.timeoutSeconds, policy);
    const trigger = normalizeTrigger(input.trigger, now);
    const sources = normalizeSources(input.sources);
    const nextRunAt = initialNextRunAt(trigger, now);
    if (trigger.type === "scheduled" && !nextRunAt) {
      throw new Error("Scheduled task has no future occurrence");
    }
    const output = { format: input.result?.format ?? "markdown" as const };
    const row = {
      task_id: taskId,
      user_id: context.userId,
      title,
      goal: normalizeGoal(input.goal),
      agent_id: input.agentId,
      timeout_seconds: timeoutSeconds,
      trigger_type: trigger.type,
      trigger,
      output,
      ext_data: {
        ...(context.traceId ? { traceId: context.traceId } : {}),
        timeZone: trigger.type === "scheduled" ? trigger.schedule.timezone : context.timeZone,
        source: "agent",
        delegate: { requestedByAgentId: "main" },
        sources,
      },
      status: "active" as const,
      next_run_at: nextRunAt,
      source_session_id: context.sourceSessionId ?? null,
      source_message_id: context.sourceMessageId ?? null,
      created_at: now,
      updated_at: now,
    };

    await this.repository.createTask(row);
    logInfo("task", "task_created", {
      traceId: context.traceId,
      taskId,
      agentId: input.agentId,
      triggerType: trigger.type,
      nextRunAt: nextRunAt!.toISOString(),
    });
    return { taskId, status: "active", nextRunAt: nextRunAt!.toISOString() };
  }

  list(userId: string): Promise<Task[]> {
    return this.repository.listByUser(userId);
  }

  find(userId: string, taskId: string): Promise<Task | undefined> {
    return this.repository.findById(userId, taskId);
  }

  listRuns(userId: string, taskId: string): Promise<TaskRun[]> {
    return this.repository.listRuns(userId, taskId);
  }

  findRun(userId: string, taskId: string, runId: string): Promise<TaskRun | undefined> {
    return this.repository.findRun(userId, taskId, runId);
  }

  async pause(userId: string, taskId: string): Promise<Task | undefined> {
    const task = await this.repository.findById(userId, taskId);
    if (!task || task.status !== "active") return task;
    return this.repository.updateTaskStatus(userId, taskId, "paused", undefined);
  }

  async resume(userId: string, taskId: string): Promise<Task | undefined> {
    const task = await this.repository.findById(userId, taskId);
    if (!task || task.status !== "paused") return task;
    let nextRunAt: Date | null | undefined = undefined;
    if (task.trigger.type === "scheduled") {
      if (task.trigger.schedule.type === "once") {
        nextRunAt = new Date(task.trigger.schedule.at);
      } else {
        nextRunAt = nextRecurringOccurrence(task.trigger, new Date(), false);
      }
    }
    return this.repository.updateTaskStatus(userId, taskId, "active", nextRunAt);
  }

  cancel(userId: string, taskId: string): Promise<Task | undefined> {
    return this.repository.cancel(userId, taskId);
  }

  async update(userId: string, taskId: string, input: UpdateTaskInput, policy?: TaskAgentPolicy): Promise<Task | undefined> {
    const current = await this.repository.findById(userId, taskId);
    if (!current) return undefined;
    if (input.status === "cancelled") return this.cancel(userId, taskId);
    if (input.status === "paused") await this.pause(userId, taskId);
    if (input.status === "active") await this.resume(userId, taskId);

    const task = await this.repository.findById(userId, taskId);
    if (!task) return undefined;
    const now = new Date();
    const trigger = input.trigger ? normalizeTrigger(input.trigger, now) : task.trigger;
    const title = input.title === undefined ? undefined : input.title.trim();
    if (title !== undefined && !title) throw new Error("Task title must not be empty");
    const timeoutSeconds = input.timeoutSeconds === undefined
      ? undefined
      : this.resolveTimeout(input.timeoutSeconds, policy ?? { defaultTimeoutSeconds: task.timeoutSeconds, maxTimeoutSeconds: task.timeoutSeconds });
    const nextRunAt = input.trigger
      ? initialNextRunAt(trigger, now)
      : undefined;
    const sources = input.sources === undefined ? undefined : {
      ...task.extData,
      sources: normalizeSources(input.sources),
    };
    const updated = await this.repository.updateTaskDetails({
      userId,
      taskId,
      ...(title !== undefined ? { title } : {}),
      ...(input.goal ? { goal: normalizeGoal(input.goal) } : {}),
      ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}),
      ...(input.trigger ? { triggerType: trigger.type, trigger, nextRunAt } : {}),
      ...(input.result ? { output: { format: input.result.format ?? task.output.format } } : {}),
      ...(sources !== undefined ? { sources } : {}),
    });
    if (updated) logInfo("task", "task_updated", { taskId, userId });
    return updated;
  }

  dueTasks(now = new Date(), limit?: number): Promise<Task[]> {
    return this.repository.dueTasks(now, limit);
  }

  async startDueRun(task: Task, workerSessionId: string, now = new Date()): Promise<TaskRun | undefined> {
    if (!task.nextRunAt) return undefined;
    const expectedNextRunAt = new Date(task.nextRunAt);
    let scheduledAt = expectedNextRunAt;
    let nextRunAt: Date | null = null;
    if (task.trigger.type === "scheduled" && task.trigger.schedule.type === "recurring") {
      const latest = previousRecurringOccurrence(task.trigger, now, true);
      if (latest && latest >= scheduledAt) scheduledAt = latest;
      nextRunAt = nextRecurringOccurrence(task.trigger, now, false);
    }
    return this.repository.startDueRun({
      taskId: task.taskId,
      userId: task.userId,
      expectedNextRunAt,
      scheduledAt,
      nextRunAt,
      workerSessionId,
    });
  }

  completeRun(input: Parameters<TaskRepository["completeRun"]>[0]): Promise<void> {
    return this.repository.completeRun(input);
  }

  failRun(run: TaskRun, error: Record<string, unknown>): Promise<void> {
    return this.repository.failRun(run, error);
  }

  recoverRunning(): Promise<number> {
    return this.repository.recoverRunning();
  }

  private resolveTimeout(requested: number | undefined, policy: TaskAgentPolicy): number {
    const value = requested ?? policy.defaultTimeoutSeconds;
    const max = Math.min(policy.maxTimeoutSeconds, this.timeoutBounds.maxSeconds);
    if (!Number.isInteger(value) || value < this.timeoutBounds.minSeconds || value > max) {
      throw new Error(`timeoutSeconds must be between ${this.timeoutBounds.minSeconds} and ${max}`);
    }
    return value;
  }
}

function normalizeGoal(goal: DelegateTaskInput["goal"]): DelegateTaskInput["goal"] {
  const objective = goal.objective.trim();
  if (!objective) throw new Error("Task goal objective must not be empty");
  return {
    objective,
    ...(goal.context?.trim() ? { context: goal.context.trim() } : {}),
    ...(goal.constraints?.length ? { constraints: goal.constraints.map(value => value.trim()).filter(Boolean) } : {}),
    ...(goal.successCriteria?.length ? { successCriteria: goal.successCriteria.map(value => value.trim()).filter(Boolean) } : {}),
  };
}

function normalizeSources(sources: DelegateTaskInput["sources"]): { recordIds: string[]; mediaIds: string[] } {
  return {
    recordIds: normalizeSourceIds(sources?.recordIds),
    mediaIds: normalizeSourceIds(sources?.mediaIds),
  };
}

function normalizeSourceIds(values: string[] | undefined): string[] {
  if (!values) return [];
  if (values.length > 20) throw new Error("Task sources support at most 20 IDs per type");
  const normalized = values.map(value => value.trim()).filter(Boolean);
  if (normalized.some(value => value.length > 100)) throw new Error("Task source ID must be at most 100 characters");
  return [...new Set(normalized)];
}

function normalizeTrigger(trigger: DelegateTaskInput["trigger"], now: Date): TaskTrigger {
  if (trigger.type === "immediate") return { type: "immediate" };
  assertTimeZone(trigger.schedule.timezone);
  if (trigger.schedule.type === "once") {
    const at = validDate(trigger.schedule.at, "schedule.at");
    return {
      type: "scheduled",
      schedule: { type: "once", at: at.toISOString(), timezone: trigger.schedule.timezone },
    };
  }
  const startAt = validDate(trigger.schedule.startAt ?? now.toISOString(), "schedule.startAt");
  const normalized: ScheduledTaskTrigger = {
    type: "scheduled",
    schedule: {
      type: "recurring",
      rrule: normalizeRRule(trigger.schedule.rrule),
      timezone: trigger.schedule.timezone,
      startAt: startAt.toISOString(),
    },
  };
  createRule(normalized);
  return normalized;
}

function initialNextRunAt(trigger: TaskTrigger, now: Date): Date | null {
  if (trigger.type === "immediate") return now;
  if (trigger.schedule.type === "once") return validDate(trigger.schedule.at, "schedule.at");
  return nextRecurringOccurrence(trigger, new Date(now.getTime() - 1), false);
}

function normalizeRRule(value: string): string {
  const trimmed = value.trim().replace(/^RRULE:/i, "");
  if (!trimmed) throw new Error("Recurring schedule requires rrule");
  return trimmed;
}

function validDate(value: string, field: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${field} must be a valid ISO date-time`);
  return date;
}

function assertTimeZone(value: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
  } catch {
    throw new Error("schedule.timezone must be a valid IANA time zone");
  }
}

function createRule(trigger: ScheduledTaskTrigger): InstanceType<typeof RRule> {
  if (trigger.schedule.type !== "recurring") throw new Error("Recurring schedule required");
  const options = RRule.parseString(trigger.schedule.rrule);
  return new RRule({
    ...options,
    dtstart: toFloatingDate(new Date(trigger.schedule.startAt), trigger.schedule.timezone),
    tzid: null,
  });
}

export function nextRecurringOccurrence(
  trigger: ScheduledTaskTrigger,
  after: Date,
  inclusive: boolean,
): Date | null {
  if (trigger.schedule.type !== "recurring") throw new Error("Recurring schedule required");
  const floating = createRule(trigger).after(toFloatingDate(after, trigger.schedule.timezone), inclusive);
  return floating ? fromFloatingDate(floating, trigger.schedule.timezone) : null;
}

function previousRecurringOccurrence(
  trigger: ScheduledTaskTrigger,
  before: Date,
  inclusive: boolean,
): Date | null {
  if (trigger.schedule.type !== "recurring") throw new Error("Recurring schedule required");
  const floating = createRule(trigger).before(toFloatingDate(before, trigger.schedule.timezone), inclusive);
  return floating ? fromFloatingDate(floating, trigger.schedule.timezone) : null;
}

const timeZoneFormatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = timeZoneFormatters.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  timeZoneFormatters.set(timeZone, created);
  return created;
}

function toFloatingDate(instant: Date, timeZone: string): Date {
  const values: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(instant)) {
    if (part.type === "year" || part.type === "month" || part.type === "day"
      || part.type === "hour" || part.type === "minute" || part.type === "second") {
      values[part.type] = Number(part.value);
    }
  }
  return new Date(Date.UTC(
    values.year!,
    values.month! - 1,
    values.day!,
    values.hour!,
    values.minute!,
    values.second!,
  ));
}

function fromFloatingDate(floating: Date, timeZone: string): Date {
  const target = Date.UTC(
    floating.getUTCFullYear(),
    floating.getUTCMonth(),
    floating.getUTCDate(),
    floating.getUTCHours(),
    floating.getUTCMinutes(),
    floating.getUTCSeconds(),
  );
  let candidate = target;
  for (let index = 0; index < 4; index += 1) {
    const wallAtCandidate = toFloatingDate(new Date(candidate), timeZone).getTime();
    const next = candidate + (target - wallAtCandidate);
    if (next === candidate) break;
    candidate = next;
  }
  return new Date(candidate);
}
