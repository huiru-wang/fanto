import type { Context, ExecutionToolContext } from "@earendil-works/pi-agent-core";
import { createRunContext } from "./run-context.js";

export type SystemPromptProvider = {
  readonly slot: string;
  readonly required?: boolean;
  build(context: Context): Promise<{ slot: string; content: string }>;
};

type SystemPromptBuilder = {
  resolve(toolContext: ExecutionToolContext, context: Context): Promise<string>;
  release(context: Context): void;
};

const slotPattern = /\{\{([a-z][a-z0-9_]*)\}\}/g;

export function createSystemPrompt(options: {
  template: string;
  providers: readonly SystemPromptProvider[];
  placeholder?: string;
}): SystemPromptBuilder {
  const providers = new Map<string, SystemPromptProvider>();
  for (const provider of options.providers) {
    if (!/^[a-z][a-z0-9_]*$/.test(provider.slot)) throw new Error(`Invalid context slot: ${provider.slot}`);
    if (providers.has(provider.slot)) throw new Error(`Duplicate context slot provider: ${provider.slot}`);
    providers.set(provider.slot, provider);
  }
  const referenced = [...options.template.matchAll(slotPattern)].map(match => match[1]);
  const slots = [...new Set(referenced)];
  const placeholder = options.placeholder ?? "（无）";

  async function resolve(_toolContext: ExecutionToolContext, context: Context): Promise<string> {
    const data = createRunContext.read(context);
    if (!data.slots.prompt) data.slots.prompt = build(context);
    return data.slots.prompt;
  }

  async function build(context: Context): Promise<string> {
    const data = createRunContext.read(context);
    const selected = slots.flatMap(slot => providers.get(slot) ? [[slot, providers.get(slot)!] as const] : []);
    await Promise.all(selected.map(async ([slot, provider]) => {
      if (data.slots.values.has(slot)) return;
      try {
        const result = await provider.build(context);
        if (result.slot !== slot) throw new Error(`Provider returned unexpected slot: ${result.slot}`);
        data.slots.values.set(slot, result.content);
      } catch (cause) {
        if (provider.required) throw cause;
        if (context.abortSignal?.aborted) throw context.abortSignal.reason ?? cause;
        console.warn(`[context] ${slot} provider failed`, cause instanceof Error ? cause.message : String(cause));
        data.slots.values.set(slot, "");
      }
    }));
    return options.template.replace(slotPattern, (_match, slot: string) => data.slots.values.get(slot)?.trim() || placeholder);
  }

  return {
    resolve,
    release(context) {
      const data = createRunContext.read(context);
      data.slots.prompt = undefined;
      data.slots.values.clear();
    },
  };
}
