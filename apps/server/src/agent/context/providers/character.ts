import type { Context } from "@earendil-works/pi-agent-core";
import type { AgentBusinessServices } from "../../business-services.js";
import { createRunContext } from "../run-context.js";
import { DEFAULT_CHARACTER } from "../../../domain/character.js";

export class CharacterProvider {
  readonly slots = ["character", "scenario", "character_instructions", "example_dialogues"] as const;
  constructor(private readonly client: Pick<AgentBusinessServices, "getCharacter">) {}

  async build(context: Context): Promise<Record<string, string>> {
    const run = createRunContext.read(context);
    const config = await this.client.getCharacter({ userId: run.userId, sessionId: run.sessionId, signal: context.abortSignal });
    return {
      character: config.character || DEFAULT_CHARACTER.character,
      scenario: config.scenario,
      character_instructions: config.instructions,
      example_dialogues: config.exampleDialogues,
    };
  }
}
