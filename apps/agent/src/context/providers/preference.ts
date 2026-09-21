import type { FantoServerClient } from "../../clients/fanto-server-client.js";
import type { ContextFragment, ContextInput, ContextProvider } from "../types.js";

type PreferenceClient = Pick<FantoServerClient, "listPreferences">;

export class PreferenceProvider implements ContextProvider {
  readonly name = "preference";

  constructor(private readonly client: PreferenceClient) {}

  async build(input: ContextInput): Promise<ContextFragment> {
    const result = await this.client.listPreferences({ userId: input.userId, traceId: input.traceId, signal: input.signal });
    const content = result.data.map((item, index) =>
      `${index + 1}. preferenceId: ${item.preferenceId} | version: ${item.version} | category: ${item.category}\n   ${item.content}`
    ).join("\n");
    return { section: "User Preferences", content };
  }
}
