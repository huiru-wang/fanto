import type { Kysely, Transaction } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
import type { Task, TaskRun, TaskRunResult, TaskStatus } from "./model.js";

const objectValue = (value: unknown): Record<string, unknown> => {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
};

const iso = (value: Date | string | null): string | null => value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const toTask = (row: any): Task => {
  const extData = objectValue(row.ext_data);
  const source = objectValue(extData.sources);
  return {
    taskId: row.task_id,
    userId: row.user_id,
    title: row.title,
    goal: objectValue(row.goal) as Task["goal"],
    agentId: row.agent_id,
    timeoutSeconds: row.timeout_seconds,
    triggerType: row.trigger_type,
    trigger: objectValue(row.trigger) as Task["trigger"],
    output: objectValue(row.output) as Task["output"],
    sources: {
      recordIds: stringValues(source.recordIds),
      mediaIds: stringValues(source.mediaIds),
    },
    extData,
    status: row.status,
    nextRunAt: iso(row.next_run_at),
    sourceSessionId: row.source_session_id,
    sourceMessageId: row.source_message_id,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
};

function stringValues(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

const toRun = (row: any): TaskRun => ({
  runId: row.run_id,
  taskId: row.task_id,
  userId: row.user_id,
  status: row.status,
  scheduledAt: iso(row.scheduled_at)!,
  workerSessionId: row.worker_session_id,
  resultMediaId: row.result_media_id,
  result: row.result ? objectValue(row.result) as TaskRunResult : null,
  error: row.error ? objectValue(row.error) : null,
  extData: objectValue(row.ext_data),
  startedAt: iso(row.started_at),
  finishedAt: iso(row.finished_at),
  createdAt: iso(row.created_at)!,
  updatedAt: iso(row.updated_at)!,
});

type NewTaskRow = {
  task_id: string;
  user_id: string;
  title: string;
  goal: unknown;
  agent_id: string;
  timeout_seconds: number;
  trigger_type: "immediate" | "scheduled";
  trigger: unknown;
  output: unknown;
  ext_data: unknown;
  status: TaskStatus;
  next_run_at: Date | null;
  source_session_id: string | null;
  source_message_id: string | null;
  created_at: Date;
  updated_at: Date;
};

export class TaskRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async createTask(row: NewTaskRow): Promise<Task> {
    await this.db.insertInto("tasks").values(row).execute();
    return toTask(row);
  }

  async listByUser(userId: string, limit = 100): Promise<Task[]> {
    const rows = await this.db.selectFrom("tasks")
      .selectAll()
      .where("user_id", "=", userId)
      .orderBy("updated_at", "desc")
      .orderBy("task_id", "desc")
      .limit(limit)
      .execute();
    return rows.map(toTask);
  }

  async findById(userId: string, taskId: string): Promise<Task | undefined> {
    const row = await this.db.selectFrom("tasks")
      .selectAll()
      .where("task_id", "=", taskId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    return row ? toTask(row) : undefined;
  }

  async listRuns(userId: string, taskId: string, limit = 100): Promise<TaskRun[]> {
    const rows = await this.db.selectFrom("task_runs")
      .selectAll()
      .where("user_id", "=", userId)
      .where("task_id", "=", taskId)
      .orderBy("created_at", "desc")
      .orderBy("run_id", "desc")
      .limit(limit)
      .execute();
    return rows.map(toRun);
  }

  async findRun(userId: string, taskId: string, runId: string): Promise<TaskRun | undefined> {
    const row = await this.db.selectFrom("task_runs")
      .selectAll()
      .where("user_id", "=", userId)
      .where("task_id", "=", taskId)
      .where("run_id", "=", runId)
      .executeTakeFirst();
    return row ? toRun(row) : undefined;
  }

  async updateTaskStatus(
    userId: string,
    taskId: string,
    status: TaskStatus,
    nextRunAt: Date | null | undefined,
  ): Promise<Task | undefined> {
    const values: { status: TaskStatus; updated_at: Date; next_run_at?: Date | null } = {
      status,
      updated_at: new Date(),
    };
    if (nextRunAt !== undefined) values.next_run_at = nextRunAt;
    const row = await this.db.updateTable("tasks")
      .set(values)
      .where("task_id", "=", taskId)
      .where("user_id", "=", userId)
      .returningAll()
      .executeTakeFirst();
    return row ? toTask(row) : undefined;
  }

  async updateTaskDetails(input: {
    userId: string;
    taskId: string;
    title?: string;
    goal?: unknown;
    timeoutSeconds?: number;
    triggerType?: "immediate" | "scheduled";
    trigger?: unknown;
    output?: unknown;
    sources?: unknown;
    nextRunAt?: Date | null;
  }): Promise<Task | undefined> {
    const values: Record<string, unknown> = { updated_at: new Date() };
    if (input.title !== undefined) values.title = input.title;
    if (input.goal !== undefined) values.goal = input.goal;
    if (input.timeoutSeconds !== undefined) values.timeout_seconds = input.timeoutSeconds;
    if (input.triggerType !== undefined) values.trigger_type = input.triggerType;
    if (input.trigger !== undefined) values.trigger = input.trigger;
    if (input.output !== undefined) values.output = input.output;
    if (input.sources !== undefined) values.ext_data = input.sources;
    if (input.nextRunAt !== undefined) values.next_run_at = input.nextRunAt;
    const row = await this.db.updateTable("tasks")
      .set(values)
      .where("task_id", "=", input.taskId)
      .where("user_id", "=", input.userId)
      .where("status", "in", ["active", "paused"])
      .returningAll()
      .executeTakeFirst();
    return row ? toTask(row) : undefined;
  }

  async cancel(userId: string, taskId: string): Promise<Task | undefined> {
    return this.db.transaction().execute(async trx => {
      const task = await trx.updateTable("tasks")
        .set({ status: "cancelled", next_run_at: null, updated_at: new Date() })
        .where("task_id", "=", taskId)
        .where("user_id", "=", userId)
        .where("status", "in", ["active", "paused"])
        .returningAll()
        .executeTakeFirst();
      if (!task) return undefined;
      return toTask(task);
    });
  }

  async dueTasks(now: Date, limit = 100): Promise<Task[]> {
    const rows = await this.db.selectFrom("tasks")
      .selectAll()
      .where("status", "=", "active")
      .where("next_run_at", "<=", now)
      .orderBy("next_run_at", "asc")
      .orderBy("task_id", "asc")
      .limit(limit)
      .execute();
    return rows.map(toTask);
  }

  async startDueRun(input: {
    taskId: string;
    userId: string;
    expectedNextRunAt: Date;
    scheduledAt: Date;
    nextRunAt: Date | null;
    workerSessionId: string;
  }): Promise<TaskRun | undefined> {
    return this.db.transaction().execute(async trx => {
      const task = await trx.selectFrom("tasks")
        .select(["task_id", "user_id", "next_run_at", "status", "ext_data"])
        .where("task_id", "=", input.taskId)
        .where("user_id", "=", input.userId)
        .forUpdate()
        .executeTakeFirst();
      if (!task || task.status !== "active" || !task.next_run_at) return undefined;
      if (task.next_run_at.getTime() !== input.expectedNextRunAt.getTime()) return undefined;

      const now = new Date();
      const inserted = await trx.insertInto("task_runs").values({
        run_id: crypto.randomUUID(),
        task_id: input.taskId,
        user_id: input.userId,
        status: "running",
        scheduled_at: input.scheduledAt,
        worker_session_id: input.workerSessionId,
        result_media_id: null,
        result: null,
        error: null,
        ext_data: runExtData(task.ext_data),
        started_at: now,
        finished_at: null,
        created_at: now,
        updated_at: now,
      }).onConflict(conflict => conflict.columns(["task_id", "scheduled_at"]).doNothing()).returningAll().executeTakeFirst();
      if (!inserted) return undefined;

      await trx.updateTable("tasks")
        .set({ next_run_at: input.nextRunAt, updated_at: now })
        .where("task_id", "=", input.taskId)
        .where("user_id", "=", input.userId)
        .execute();
      return toRun(inserted);
    });
  }

  async completeRun(input: {
    run: TaskRun;
    resultMediaId: string;
    result: TaskRunResult;
  }): Promise<void> {
    await this.finishRun({
      run: input.run,
      status: "completed",
      resultMediaId: input.resultMediaId,
      result: input.result,
      error: null,
    });
  }

  async failRun(run: TaskRun, error: Record<string, unknown>): Promise<void> {
    await this.finishRun({ run, status: "failed", resultMediaId: null, result: null, error });
  }

  async recoverRunning(): Promise<number> {
    return this.db.transaction().execute(async trx => {
      const running = await trx.selectFrom("task_runs")
        .select(["run_id", "task_id", "user_id"])
        .where("status", "=", "running")
        .forUpdate()
        .execute();
      if (running.length === 0) return 0;

      const now = new Date();
      await trx.updateTable("task_runs")
        .set({
          status: "failed",
          error: { code: "SERVER_RESTARTED", message: "Server restarted while task was running" },
          finished_at: now,
          updated_at: now,
        })
        .where("run_id", "in", running.map(run => run.run_id))
        .where("status", "=", "running")
        .execute();

      const oneShotTasks = new Set(running.map(run => `${run.user_id}\0${run.task_id}`));
      for (const key of oneShotTasks) {
        const [userId, taskId] = key.split("\0");
        await completeOneShotTask(trx, userId!, taskId!, now);
      }
      return running.length;
    });
  }

  private async finishRun(input: {
    run: TaskRun;
    status: "completed" | "failed";
    resultMediaId: string | null;
    result: TaskRunResult | null;
    error: Record<string, unknown> | null;
  }): Promise<void> {
    await this.db.transaction().execute(async trx => {
      const now = new Date();
      const updated = await trx.updateTable("task_runs")
        .set({
          status: input.status,
          result_media_id: input.resultMediaId,
          result: input.result,
          error: input.error,
          finished_at: now,
          updated_at: now,
        })
        .where("run_id", "=", input.run.runId)
        .where("user_id", "=", input.run.userId)
        .where("status", "=", "running")
        .returning(["task_id"])
        .executeTakeFirst();
      if (!updated) return;
      await completeOneShotTask(trx, input.run.userId, updated.task_id, now);
    });
  }
}

function runExtData(taskExtData: unknown): Record<string, unknown> {
  const extData = objectValue(taskExtData);
  return typeof extData.traceId === "string" && extData.traceId
    ? { traceId: extData.traceId }
    : {};
}

async function completeOneShotTask(trx: Transaction<DB>, userId: string, taskId: string, now: Date): Promise<void> {
  const task = await trx.selectFrom("tasks")
    .select(["trigger_type", "trigger"])
    .where("task_id", "=", taskId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  if (!task) return;
  const trigger = objectValue(task.trigger) as Task["trigger"];
  const oneShot = task.trigger_type === "immediate"
    || (trigger.type === "scheduled" && trigger.schedule.type === "once");
  if (!oneShot) return;
  await trx.updateTable("tasks")
    .set({ status: "completed", next_run_at: null, updated_at: now })
    .where("task_id", "=", taskId)
    .where("user_id", "=", userId)
    .where("status", "=", "active")
    .execute();
}
