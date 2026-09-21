import type { ContextFragment, ContextInput, ContextProvider } from "./types.js";

export class ContextBuilder {
  constructor(private readonly providers: ContextProvider[]) {}

  async build(input: ContextInput): Promise<ContextFragment[]> {
    return Promise.all(this.providers.map(async provider => {
      try {
        return await provider.build(input);
      } catch (cause) {
        if (input.signal?.aborted) throw input.signal.reason ?? cause;
        console.warn(`[context] ${provider.name} provider failed`, cause instanceof Error ? cause.message : String(cause));
        return { section: sectionFor(provider.name), content: "" };
      }
    }));
  }
}

function sectionFor(name: string): ContextFragment["section"] {
  if (name === "character") return "Character";
  if (name === "current_time") return "Current Time";
  if (name === "preference") return "User Preferences";
  return "Relevant Memory";
}
