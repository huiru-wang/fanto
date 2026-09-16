import type { AgentRegistry } from "../config/agent-registry.js";
import { AgentSessionManager, SessionBusyError } from "../harness/session-manager.js";
import { AgentTaskRepository } from "./task-repository.js";

export class TaskRunner {
  private draining = false;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly tasks: AgentTaskRepository, private readonly sessions: AgentSessionManager, private readonly registry: AgentRegistry) {}

  start(): void {
    this.tasks.recoverInterrupted();
    this.timer = setInterval(() => { void this.drain(); }, 250);
    void this.drain();
  }

  wake(): void {
    void this.drain();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (;;) {
        const task = this.tasks.claimNext();
        if (!task) return;
        const definition = this.registry.get(task.agentId);
        if (!definition) {
          this.tasks.fail(task.id, "Agent configuration no longer exists");
          continue;
        }
        try {
          const session = await this.sessions.acquire(definition, task.sessionId);
          let release: (() => void) | undefined;
          try {
            release = this.sessions.reserve(session);
          } catch (cause) {
            if (cause instanceof SessionBusyError) {
              this.tasks.retry(task.id);
              return;
            }
            throw cause;
          }
          try {
            const output = await this.sessions.prompt(session, task.input, new AbortController().signal, { taskId: task.id, traceId: task.traceId ?? undefined }, async () => {});
            this.tasks.complete(task.id, output);
          } finally {
            release();
          }
        } catch (cause) {
          this.tasks.fail(task.id, cause instanceof Error ? cause.message : "Agent task failed");
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
