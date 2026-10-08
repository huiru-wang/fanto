import type { Context } from "@earendil-works/pi-agent-core";
import type { AgentBusinessServices } from "../../business-services.js";
import { createRunContext } from "../run-context.js";
export class CreativeContextProvider {
  readonly required = true;
  constructor(readonly slot: "creative_context" | "creation_context", private readonly client: AgentBusinessServices) {}
  async build(context: Context) {
    const run = createRunContext.read(context);
    const isProposal = this.slot === "creative_context";
    if ((isProposal ? run.creative?.role !== "proposal" : !run.projectId) || !this.client.creativeContext) throw new Error("CREATIVE_AUTHORITY_REQUIRED");
    const data = await this.client.creativeContext({ userId: run.userId, sessionId: run.sessionId, creative: run.creative, projectId: run.projectId, signal: context.abortSignal });
    return { slot: this.slot, content: JSON.stringify(data) };
  }
}
