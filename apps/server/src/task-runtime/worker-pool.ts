import type { Task } from "../domain/tasks/index.js";

export type TaskExecutor = {
  execute(task: Task): Promise<void>;
};

export class TaskWorkerPool {
  private running = 0;

  constructor(
    private readonly concurrency: number,
    private readonly worker: TaskExecutor,
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error("Task worker concurrency must be a positive integer");
    }
  }

  get available(): number {
    return Math.max(0, this.concurrency - this.running);
  }

  get runningCount(): number {
    return this.running;
  }

  trySubmit(task: Task): Promise<void> | null {
    if (this.available <= 0) return null;
    this.running += 1;
    return this.worker.execute(task).finally(() => {
      this.running -= 1;
    });
  }
}
