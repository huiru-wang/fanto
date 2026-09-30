import type { AgentRegistry } from "../agent/harness/registry.js";
import { runAgent } from "../agent/harness/run.js";
import type { AgentSessionManager } from "../agent/harness/session-manager.js";
import type { Task, TaskGoal, TaskRun, TaskService } from "../domain/tasks/index.js";
import { logError, logInfo } from "../infrastructure/logging/logger.js";

export class TaskWorker {
  constructor(
    private readonly tasks: TaskService,
    private readonly registry: AgentRegistry,
    private readonly sessions: AgentSessionManager,
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

    let session: Awaited<ReturnType<AgentSessionManager["create"]>> | undefined;
    let releaseReservation: (() => void) | undefined;
    let run: TaskRun | undefined;
    const controller = new AbortController();
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      session = await this.sessions.create(definition, task.userId);
      releaseReservation = this.sessions.reserve(session);
      run = await this.tasks.startDueRun(task, session.id);
      if (!run) return;
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, task.timeoutSeconds * 1000);

      logInfo("task-worker", "worker_started", {
        traceId,
        taskId: task.taskId,
        runId: run.runId,
        sessionId: session.id,
        agentId: task.agentId,
      });

      await runAgent(
        session,
        renderTaskGoal(task, run),
        controller.signal,
        {
          traceId,
          timeZone: taskTimeZone(task),
          task: { taskId: task.taskId, taskRunId: run.runId },
        },
        async () => {},
      );

      const completed = await this.tasks.findRun(run.userId, run.taskId, run.runId);
      if (completed?.status !== "completed" || !completed.result || !completed.resultMediaId) {
        await this.tasks.failRun(run, {
          code: "TASK_RESULT_NOT_DELIVERED",
          message: "Task Agent finished without successfully calling deliver_task_result",
        });
        logError("task-worker", "task_failed", {
          traceId,
          taskId: run.taskId,
          runId: run.runId,
          agentId: task.agentId,
          code: "TASK_RESULT_NOT_DELIVERED",
        });
        return;
      }
      logInfo("task-worker", "worker_completed", {
        traceId,
        taskId: task.taskId,
        runId: run?.runId,
        agentId: task.agentId,
        mediaId: completed.resultMediaId,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const taskError = timedOut
        ? { code: "TASK_TIMEOUT", message: "Task execution timed out" }
        : { code: "TASK_EXECUTION_FAILED", message: "Task execution failed" };
      logError("task-worker", "task_failed", {
        traceId,
        taskId: task.taskId,
        runId: run?.runId,
        agentId: task.agentId,
        code: taskError.code,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      if (run) await this.tasks.failRun(run, taskError);
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
  }
}

export function renderTaskGoal(task: Task, run: TaskRun): string {
  const sections = [
    "# Task Goal",
    "",
    "## Objective",
    task.goal.objective,
  ];

  pushOptionalSection(sections, "Context", task.goal.context);
  pushListSection(sections, "Constraints", task.goal.constraints);
  pushListSection(sections, "Success Criteria", task.goal.successCriteria);
  pushListSection(sections, "Source Record IDs", task.sources.recordIds);
  pushListSection(sections, "Source Media IDs", task.sources.mediaIds);

  sections.push(
    "",
    "## Execution Context",
    `- Scheduled at: ${run.scheduledAt}`,
    `- Time zone: ${taskTimeZone(task)}`,
    `- Result format: ${task.output.format}`,
    "",
    `Write the primary result as ${resultFilename(task.output.format)} using a relative path in the workspace.`,
    "When source Record IDs are provided, call record_get for the relevant records before using their facts.",
    "When every result file is ready, call deliver_task_result. Ordinary text is not task delivery.",
  );
  return sections.join("\n");
}

function resultFilename(format: Task["output"]["format"]): string {
  return format === "html" ? "result.html" : format === "markdown" ? "result.md" : "result.txt";
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
