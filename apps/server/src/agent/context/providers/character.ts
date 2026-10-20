import type { Context } from "@earendil-works/pi-agent-core";
import type { AgentBusinessServices } from "../../business-services.js";
import { createRunContext } from "../run-context.js";

export class CharacterProvider {
  readonly required = true;
  readonly slots = ["character", "scenario", "character_instructions", "example_dialogues", "fanto_identity"] as const;
  constructor(private readonly client: Pick<AgentBusinessServices, "getFantoConversationSettings">) {}

  async build(context: Context): Promise<Record<string, string>> {
    const run = createRunContext.read(context);
    const config = await this.client.getFantoConversationSettings({ userId: run.userId, sessionId: run.sessionId, signal: context.abortSignal });
    return {
      fanto_identity: JSON.stringify({nickname: config?.nickname??""}),
      character: config?.roleConfig.character??"",
      scenario: config?.roleConfig.scenario??"",
      character_instructions: config?.roleConfig.instructions??"",
      example_dialogues: config?.roleConfig.exampleDialogues??"",
    };
  }
}
