import { ContextBuilder } from "./builder.js";
import { composePrompt, hasContextSlots } from "./composer.js";
import type { ContextInput } from "./types.js";

export class ContextRuntime {
  constructor(private readonly builder: ContextBuilder) {}

  async buildPrompt(template: string, input: ContextInput): Promise<string> {
    if (!hasContextSlots(template)) return template;
    return composePrompt(template, await this.builder.build(input));
  }
}
