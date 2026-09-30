import type { TaskService } from "../domain/tasks/index.js";
import { logError, logInfo } from "../infrastructure/logging/logger.js";
import type { TaskWorkerPool } from "./worker-pool.js";

export class TaskScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;

  constructor(
    private readonly tasks: TaskService,
    private readonly workers: TaskWorkerPool,
    private readonly intervalMs: number,
  ) {
    if (!Number.isInteger(intervalMs) || intervalMs < 1) {
      throw new Error("Task scheduler interval must be a positive integer");
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch(error => {
        logError("task-scheduler", "Task scheduler tick failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(now = new Date()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const available = this.workers.available;
      if (available <= 0) return;
      const tasks = await this.tasks.dueTasks(now, available);
      for (const task of tasks) {
        const execution = this.workers.trySubmit(task);
        if (!execution) {
          continue;
        }
        logInfo("task-scheduler", "task_dispatched", {
          traceId: taskTraceId(task),
          taskId: task.taskId,
          scheduledAt: task.nextRunAt,
        });
        void execution.catch(error => {
          logError("task-worker", "Task worker execution escaped error handling", {
            traceId: taskTraceId(task),
            taskId: task.taskId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    } finally {
      this.ticking = false;
    }
  }
}

function taskTraceId(task: { extData?: Record<string, unknown> }): string | undefined {
  return typeof task.extData?.traceId === "string" ? task.extData.traceId : undefined;
}
