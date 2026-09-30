import type { AgentRegistry } from "../agent/harness/registry.js";
import { runAgent } from "../agent/harness/run.js";
import type { AgentSessionManager } from "../agent/harness/session-manager.js";
import type { Task, TaskGoal, TaskRun, TaskService } from "../domain/tasks/index.js";
import { logError, logInfo } from "../infrastructure/logging/logger.js";

type TaskExecutionError = { code: string; message: string };

export class TaskWorker {
  constructor(
    private readonly tasks: TaskService,
    private readonly registry: AgentRegistry,
    private readonly sessions: AgentSessionManager,
    private readonly run: typeof runAgent = runAgent,
  ) {}

  async execute(task: Task): Promise<void> {
    const startedAt = Date.now();
    const traceId = taskTraceId(task);
    const definition = this.registry.get(task.agentId);
    if (!definition?.task?.enabled || definition.id === "main") {
      logError("task-worker", "task_skipped", {
        traceId,
        taskId: task.taskId,
        agentId: task.agentId,
        code: "TASK_AGENT_UNAVAILABLE",
      });
      return;
    }

    let run: TaskRun | undefined;
    let finalError: TaskExecutionError = { code: "TASK_EXECUTION_FAILED", message: "Task execution failed" };

    for (let attempt = 1; attempt <= definition.task.maxAttempts; attempt += 1) {
      let session: Awaited<ReturnType<AgentSessionManager["create"]>> | undefined;
      let releaseReservation: (() => void) | undefined;
      const controller = new AbortController();
      let timedOut = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;

      try {
        session = await this.sessions.create(definition, task.userId);
        releaseReservation = this.sessions.reserve(session);
        if (!run) {
          run = await this.tasks.startDueRun(task, session.id);
          if (!run) return;
        } else {
          run = await this.tasks.rebindRunWorkerSession(run.userId, run.taskId, run.runId, session.id);
          if (!run) return;
        }

        timeout = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, task.timeoutSeconds * 1000);

        logInfo("task-worker", "worker_attempt_started", {
          traceId,
          taskId: task.taskId,
          runId: run.runId,
          sessionId: session.id,
          agentId: task.agentId,
          attempt,
          maxAttempts: definition.task.maxAttempts,
        });

        await this.run(
          session,
          renderTaskBrief(task),
          controller.signal,
          {
            traceId,
            timeZone: taskTimeZone(task),
            task: { taskId: task.taskId, taskRunId: run.runId },
            taskPlanReady: Boolean(run.plan),
          },
          async () => {},
        );

        const completed = await this.tasks.findRun(run.userId, run.taskId, run.runId);
        if (completed?.status === "completed" && completed.result && completed.resultMediaId) {
          logInfo("task-worker", "worker_completed", {
            traceId,
            taskId: task.taskId,
            runId: run.runId,
            agentId: task.agentId,
            mediaId: completed.resultMediaId,
            attempt,
            durationMs: Date.now() - startedAt,
          });
          return;
        }
        if (completed?.status !== "running") return;
        run = completed;
        finalError = {
          code: "TASK_RESULT_NOT_DELIVERED",
          message: "Task Agent finished without successfully calling deliver_task_result",
        };
      } catch (error) {
        if (run) {
          const current = await this.tasks.findRun(run.userId, run.taskId, run.runId).catch(() => undefined);
          if (current?.status === "completed" && current.result && current.resultMediaId) return;
          if (current?.status === "running") run = current;
        }
        finalError = timedOut
          ? { code: "TASK_TIMEOUT", message: "Task execution timed out" }
          : { code: "TASK_EXECUTION_FAILED", message: "Task execution failed" };
        logError("task-worker", "worker_attempt_failed", {
          traceId,
          taskId: task.taskId,
          runId: run?.runId,
          agentId: task.agentId,
          attempt,
          maxAttempts: definition.task.maxAttempts,
          code: finalError.code,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (timeout) clearTimeout(timeout);
        releaseReservation?.();
        if (session) {
          await this.sessions.release(session.id).catch(error => {
            logError("task-worker", "Failed to release task agent session", {
              traceId,
              taskId: task.taskId,
              runId: run?.runId,
              sessionId: session?.id,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }
      }

      if (run && attempt < definition.task.maxAttempts) {
        logInfo("task-worker", "worker_retrying", {
          traceId,
          taskId: task.taskId,
          runId: run.runId,
          agentId: task.agentId,
          nextAttempt: attempt + 1,
          previousCode: finalError.code,
        });
      }
    }

    if (run) {
      await this.tasks.failRun(run, finalError);
      logError("task-worker", "task_failed", {
        traceId,
        taskId: task.taskId,
        runId: run.runId,
        agentId: task.agentId,
        code: finalError.code,
        durationMs: Date.now() - startedAt,
      });
    }
  }
}

export function renderTaskBrief(task: Task): string {
  const sections = [
    "# Task Brief",
    "",
    "## Objective",
    task.goal.objective,
  ];

  pushOptionalSection(sections, "Context", task.goal.context);
  pushListSection(sections, "Constraints", task.goal.constraints);
  pushListSection(sections, "Success Criteria", task.goal.successCriteria);
  return sections.join("\n");
}

function taskTraceId(task: Task): string | undefined {
  return typeof task.extData.traceId === "string" && task.extData.traceId
    ? task.extData.traceId
    : undefined;
}

function taskTimeZone(task: Task): string {
  if (task.trigger.type === "scheduled") return task.trigger.schedule.timezone;
  return typeof task.extData.timeZone === "string" && task.extData.timeZone ? task.extData.timeZone : "UTC";
}

function pushOptionalSection(sections: string[], title: string, value: string | undefined): void {
  if (!value?.trim()) return;
  sections.push("", `## ${title}`, value.trim());
}

function pushListSection(sections: string[], title: string, values: TaskGoal["constraints"]): void {
  const normalized = values?.map(value => value.trim()).filter(Boolean);
  if (!normalized?.length) return;
  sections.push("", `## ${title}`, ...normalized.map(value => `- ${value}`));
}
