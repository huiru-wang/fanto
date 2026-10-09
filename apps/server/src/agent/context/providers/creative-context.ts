import type { Context } from "@earendil-works/pi-agent-core";
import type { AgentBusinessServices } from "../../business-services.js";
import { createRunContext } from "../run-context.js";

export class CreativeContextProvider {
  readonly slot = "creative_context";
  readonly required = true;
  constructor(private readonly client: AgentBusinessServices) {}

  async build(context: Context) {
    const run = createRunContext.read(context);
    if (!run.recordId || !Number.isSafeInteger(run.recordVersion) || (run.recordVersion ?? 0) < 1 || run.projectId || !this.client.creativeContext) {
      throw new Error("CREATIVE_AUTHORITY_REQUIRED");
    }
    const data = await this.client.creativeContext({
      userId: run.userId, sessionId: run.sessionId, recordId: run.recordId,
      recordVersion: run.recordVersion, signal: context.abortSignal,
    });
    return { slot: this.slot, content: JSON.stringify(data) };
  }
}
