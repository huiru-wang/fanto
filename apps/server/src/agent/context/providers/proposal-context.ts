import type { Context } from "@earendil-works/pi-agent-core";
import type { AgentBusinessServices } from "../../business-services.js";
import { createRunContext } from "../run-context.js";

/** Separate the trigger Record from Project candidates without repeating the authorized lookup. */
export class ProposalContextProvider {
  readonly slots = ["proposal_record", "proposal_projects"] as const;
  readonly required = true;
  constructor(private readonly client: AgentBusinessServices) {}

  async build(context: Context): Promise<Record<(typeof this.slots)[number], string>> {
    const run = createRunContext.read(context);
    if (!run.recordId || !Number.isSafeInteger(run.recordVersion) || (run.recordVersion ?? 0) < 1 || run.projectId || !this.client.creativeContext) {
      throw new Error("CREATIVE_AUTHORITY_REQUIRED");
    }
    const data = await this.client.creativeContext({
      userId: run.userId, sessionId: run.sessionId, recordId: run.recordId,
      recordVersion: run.recordVersion, signal: context.abortSignal,
    });
    if (!("sourceRecord" in data)) throw new Error("PROPOSAL_CONTEXT_INVALID");
    return {
      proposal_record: JSON.stringify(data.sourceRecord, null, 2),
      proposal_projects: JSON.stringify(data.candidateProjects, null, 2),
    };
  }
}
