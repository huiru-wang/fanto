import type { ContextFragment, ContextInput, ContextProvider } from "../types.js";

export class MemoryProvider implements ContextProvider {
  readonly name = "memory";

  async build(_input: ContextInput): Promise<ContextFragment> {
    // TODO: query rewrite + existing memory domain integration.
    return {
      section: "Relevant Memory",
      content: "暂无相关历史记录。",
    };
  }
}
