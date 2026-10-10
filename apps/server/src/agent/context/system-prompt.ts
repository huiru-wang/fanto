import type { Context, ExecutionToolContext } from "@earendil-works/pi-agent-core";
import { createRunContext } from "./run-context.js";

type SingleSlotProvider = {
  readonly slot: string;
  readonly required?: boolean;
  build(context: Context): Promise<{ slot: string; content: string }>;
};

type MultiSlotProvider = {
  readonly slots: readonly string[];
  readonly required?: boolean;
  build(context: Context): Promise<Record<string, string>>;
};

/** One provider may resolve multiple related prompt slots from a single authorized fetch. */
export type SystemPromptProvider = SingleSlotProvider | MultiSlotProvider;

type SystemPromptBuilder = {
  resolve(toolContext: ExecutionToolContext, context: Context): Promise<string>;
  release(context: Context): void;
};

const slotPattern = /\{\{([a-z][a-z0-9_]*)\}\}/g;
const validSlot = /^[a-z][a-z0-9_]*$/;

export function createSystemPrompt(options: {
  template: string;
  providers: readonly SystemPromptProvider[];
  placeholder?: string;
}): SystemPromptBuilder {
  const providers = new Map<string, SystemPromptProvider>();
  for (const provider of options.providers) {
    const owned = "slots" in provider ? provider.slots : [provider.slot];
    if (owned.length === 0 || new Set(owned).size !== owned.length) throw new Error("Invalid context provider slots");
    for (const slot of owned) {
      if (!validSlot.test(slot)) throw new Error(`Invalid context slot: ${slot}`);
      if (providers.has(slot)) throw new Error(`Duplicate context slot provider: ${slot}`);
      providers.set(slot, provider);
    }
  }
  const slots = [...new Set([...options.template.matchAll(slotPattern)].map(match => match[1]!))];
  const placeholder = options.placeholder ?? "（无）";

  async function resolve(_toolContext: ExecutionToolContext, context: Context): Promise<string> {
    const data = createRunContext.read(context);
    if (!data.slots.prompt) data.slots.prompt = build(context);
    return data.slots.prompt;
  }

  async function build(context: Context): Promise<string> {
    const data = createRunContext.read(context);
    const selected = [...new Set(slots.flatMap(slot => {
      const provider = providers.get(slot);
      return provider ? [provider] : [];
    }))];
    await Promise.all(selected.map(async provider => {
      const owned = "slots" in provider ? provider.slots : [provider.slot];
      if (owned.every(slot => data.slots.values.has(slot))) return;
      try {
        if ("slots" in provider) {
          const result = await provider.build(context);
          for (const slot of owned) {
            if (typeof result[slot] !== "string") throw new Error(`Provider omitted context slot: ${slot}`);
          }
          for (const slot of owned) data.slots.values.set(slot, result[slot]!);
        } else {
          const result = await provider.build(context);
          if (result.slot !== provider.slot) throw new Error(`Provider returned unexpected slot: ${result.slot}`);
          data.slots.values.set(provider.slot, result.content);
        }
      } catch (cause) {
        if (provider.required) throw cause;
        if (context.abortSignal?.aborted) throw context.abortSignal.reason ?? cause;
        console.warn(`[context] ${owned.join(",")} provider failed`, cause instanceof Error ? cause.message : String(cause));
        for (const slot of owned) data.slots.values.set(slot, "");
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
