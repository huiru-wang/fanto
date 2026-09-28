import type { Context } from "@earendil-works/pi-agent-core";
import type { AgentBusinessServices } from "../../business-services.js";
import { createRunContext } from "../index.js";

type PreferenceClient = Pick<AgentBusinessServices, "listPreferences">;

export class PreferenceProvider {
  readonly slot = "user_preferences";

  constructor(private readonly client: PreferenceClient) {}

  async build(context: Context): Promise<{ slot: string; content: string }> {
    const input = createRunContext.read(context);
    const result = await this.client.listPreferences({ userId: input.userId, traceId: input.traceId, signal: context.abortSignal });
    const content = result.data.map((item, index) =>
      `${index + 1}. preferenceId: ${item.preferenceId} | version: ${item.version} | category: ${item.category}\n   ${item.content}`
    ).join("\n");
    return { slot: this.slot, content };
  }
}
