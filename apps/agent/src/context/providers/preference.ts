import type { ContextFragment, ContextInput, ContextProvider } from "../types.js";

export class PreferenceProvider implements ContextProvider {
  readonly name = "preference";

  async build(_input: ContextInput): Promise<ContextFragment> {
    // TODO: connect preference domain after server implementation.
    return {
      section: "User Preferences",
      content: "暂无用户长期偏好。",
    };
  }
}
