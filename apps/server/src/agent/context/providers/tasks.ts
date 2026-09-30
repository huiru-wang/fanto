import type { Context } from "@earendil-works/pi-agent-core";
import type { Task } from "../../../domain/tasks/index.js";
import type { AgentBusinessServices } from "../../business-services.js";
import { createRunContext } from "../index.js";

type TaskClient = Pick<AgentBusinessServices, "listTasks">;

export class TaskProvider {
  readonly slot = "current_tasks";

  constructor(private readonly client: TaskClient) {}

  async build(context: Context): Promise<{ slot: string; content: string }> {
    const input = createRunContext.read(context);
    const result = await this.client.listTasks({
      userId: input.userId,
      traceId: input.traceId,
      signal: context.abortSignal,
    }) as { data: Task[] };
    const content = result.data.map(task => [
      `- taskId: ${task.taskId} | status: ${task.status} | agent: ${task.agentId}`,
      `  title: ${task.title}`,
      `  objective: ${task.goal.objective}`,
      ...(task.references.recordIds.length ? [`  referenceRecordIds: ${task.references.recordIds.join(", ")}`] : []),
    ].join("\n")).join("\n");
    return { slot: this.slot, content };
  }
}
