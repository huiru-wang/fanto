import type { Context } from "@earendil-works/pi-agent-core";
import type { Task, TaskRun } from "../../../domain/tasks/index.js";
import type { AgentBusinessServices } from "../../business-services.js";
import { createRunContext } from "../run-context.js";

export class TaskExecutionContextProvider {
  readonly slot = "task_execution_context";

  constructor(private readonly client: Pick<AgentBusinessServices, "getTask">) {}

  async build(context: Context): Promise<{ slot: string; content: string }> {
    const data = createRunContext.read(context);
    if (!data.task) return { slot: this.slot, content: "" };
    const loaded = await this.client.getTask({
      userId: data.userId,
      traceId: data.traceId,
      signal: context.abortSignal,
      sessionId: data.sessionId,
      timeZone: data.timeZone,
      task: data.task,
    }, data.task.taskId) as { task: Task; runs: TaskRun[] };
    const run = loaded.runs.find(item => item.runId === data.task!.taskRunId);
    if (!run) throw new Error("Current TaskRun is unavailable");
    const filename = loaded.task.output.format === "html" ? "result.html" : loaded.task.output.format === "markdown" ? "result.md" : "result.txt";
    const lines = [
      `Output format: ${loaded.task.output.format}`,
      `Primary result file: ${filename}`,
      `Scheduled at: ${run.scheduledAt}`,
      `Time zone: ${data.timeZone ?? "UTC"}`,
    ];
    if (loaded.task.references.recordIds.length) {
      lines.push("Reference Record IDs:", ...loaded.task.references.recordIds.map(id => `- ${id}`));
    } else {
      lines.push("Reference Record IDs: none");
    }
    if (run.plan) {
      lines.push(
        "Existing saved plan:",
        run.plan.summary,
        ...run.plan.steps.map(step => `- ${step.title}${step.description ? `: ${step.description}` : ""}`),
      );
    } else {
      lines.push("Existing saved plan: none");
    }
    return { slot: this.slot, content: lines.join("\n") };
  }
}
