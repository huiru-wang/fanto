import type { Context } from "@earendil-works/pi-agent-core";
import type { AgentBusinessServices } from "../../business-services.js";
import { createRunContext } from "../run-context.js";

export class CreationContextProvider {
  readonly slot = "creation_context";
  readonly required = true;
  constructor(private readonly client: AgentBusinessServices) {}

  async build(context: Context) {
    const run = createRunContext.read(context);
    if (!run.projectId || run.recordId || run.recordVersion !== undefined || !this.client.creativeContext) {
      throw new Error("CREATIVE_AUTHORITY_REQUIRED");
    }
    const data = await this.client.creativeContext({
      userId: run.userId, sessionId: run.sessionId,
      projectId: run.projectId, signal: context.abortSignal,
    });
    return { slot: this.slot, content: JSON.stringify(data) };
  }
}
