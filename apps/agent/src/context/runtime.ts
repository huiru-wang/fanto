import { ContextBuilder } from "./builder.js";
import type { ContextFragment, ContextInput } from "./types.js";

export class ContextRuntime {
  constructor(private readonly builder: ContextBuilder) {}

  build(input: ContextInput): Promise<ContextFragment[]> {
    return this.builder.build(input);
  }
}
