import type { Context } from "@earendil-works/pi-agent-core";
import type { AgentBusinessServices } from "../../business-services.js";
import { createRunContext } from "../run-context.js";

export class TaskExecutionContextProvider {
  readonly slot = "task_execution_context";
  readonly required = true;

  constructor(private readonly client: Pick<AgentBusinessServices, "getTaskExecution">) {}

  async build(context: Context): Promise<{ slot: string; content: string }> {
    const data = createRunContext.read(context);
    if (!data.task) throw new Error("TASK_AUTHORITY_REQUIRED");
    const { task, run } = await this.client.getTaskExecution({
      userId: data.userId,
      traceId: data.traceId,
      signal: context.abortSignal,
      sessionId: data.sessionId,
      timeZone: data.timeZone,
      task: data.task,
    }, data.task.taskId, data.task.taskRunId);
    if (run.taskId !== task.taskId || run.workerSessionId !== data.sessionId || run.status !== "running") {
      throw new Error("TASK_AUTHORITY_REQUIRED");
    }
    data.taskAuthorized = true;
    data.taskPlanReady = Boolean(run.plan);
    const filename = task.output.format === "html" ? "result.html" : task.output.format === "markdown" ? "result.md" : "result.txt";
    const lines = [
      `Output format: ${task.output.format}`,
      `Primary result file: ${filename}`,
      `Scheduled at: ${run.scheduledAt}`,
      `Time zone: ${data.timeZone ?? "UTC"}`,
    ];
    if (task.references.recordIds.length) {
      lines.push("Reference Record IDs:", ...task.references.recordIds.map(id => `- ${id}`));
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
