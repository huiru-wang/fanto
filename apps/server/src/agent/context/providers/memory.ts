import type { Context } from "@earendil-works/pi-agent-core";
import type { AgentBusinessServices, AgentMemory } from "../../business-services.js";
import { createRunContext } from "../run-context.js";

// Bound serialized context without a provider-specific tokenizer or another model call.
const MAX_CONTEXT_BYTES = 12_000;
const injectedKinds = ["interaction_preferences", "personal_background"] as const;
type Entry = { id: string; content: string; updatedAt: string };

function memoryContext(memories: AgentMemory[]) {
  const sections = {
    interaction_preferences: { entries: [] as Entry[], omitted: 0 },
    personal_background: { entries: [] as Entry[], omitted: 0 },
  };
  const selected = memories.filter(memory => injectedKinds.some(kind => kind === memory.kind));
  const data = { status: selected.length ? "available" : "empty", ...sections };
  for (const kind of injectedKinds) {
    const items = selected.filter(memory => memory.kind === kind);
    sections[kind].omitted = items.length;
  }
  for (const kind of injectedKinds) {
    for (const memory of selected.filter(memory => memory.kind === kind)) {
      const section = sections[kind];
      section.entries.push({ id: memory.memoryId, content: memory.content, updatedAt: memory.updatedAt });
      section.omitted--;
      if (Buffer.byteLength(JSON.stringify(data), "utf8") > MAX_CONTEXT_BYTES) {
        section.entries.pop();
        section.omitted++;
      }
    }
  }
  return JSON.stringify(data);
}

export class MemoryProvider {
  readonly slot = "user_memories";

  constructor(private readonly client: Pick<AgentBusinessServices, "listMemories">) {}

  async build(context: Context): Promise<{ slot: string; content: string }> {
    const run = createRunContext.read(context);
    try {
      // One user-scoped read (at most 50 rows), no embedding or automatic search.
      const memories = await this.client.listMemories({
        userId: run.userId,
        traceId: run.traceId,
        signal: context.abortSignal,
        sessionId: run.sessionId,
        timeZone: run.timeZone,
      });
      return { slot: this.slot, content: memoryContext(memories) };
    } catch (error) {
      if (context.abortSignal?.aborted) throw error;
      return { slot: this.slot, content: JSON.stringify({ status: "unavailable" }) };
    }
  }
}
