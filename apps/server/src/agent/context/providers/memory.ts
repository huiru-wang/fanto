import type { Context } from "@earendil-works/pi-agent-core";
import type { AgentBusinessServices } from "../../business-services.js";
import { createRunContext } from "../run-context.js";

export class MemoryProvider {
  readonly slot = "user_memories";

  constructor(private readonly client: Pick<AgentBusinessServices, "listMemories">) {}

  async build(context: Context): Promise<{ slot: string; content: string }> {
    const run = createRunContext.read(context);
    const memories = await this.client.listMemories({
      userId: run.userId,
      traceId: run.traceId,
      signal: context.abortSignal,
      sessionId: run.sessionId,
      timeZone: run.timeZone,
      task: run.task,
    }, { kind: "guidance" });
    return {
      slot: this.slot,
      content: memories.map(memory => `- [${memory.memoryId}] ${memory.content}`).join("\n"),
    };
  }
}
