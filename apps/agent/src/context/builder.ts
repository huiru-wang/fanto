import type { ContextFragment, ContextInput, ContextProvider } from "./types.js";

export class ContextBuilder {
  constructor(private readonly providers: ContextProvider[]) {}

  async build(input: ContextInput): Promise<ContextFragment[]> {
    return Promise.all(this.providers.map(provider => provider.build(input)));
  }
}
