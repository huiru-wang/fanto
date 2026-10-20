import type { Context } from "@earendil-works/pi-agent-core";
import type { AgentBusinessServices, AgentMemory } from "../../business-services.js";
import { createRunContext } from "../run-context.js";

// Bound serialized context without a provider-specific tokenizer or another model call.
const MAX_CONTEXT_BYTES = 12_000;
const injectedKinds = ["interaction_preferences", "personal_background"] as const;
type Entry = { id: string; content: string; updatedAt: string };

export function memoryContext(memories: AgentMemory[]) {
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

/** Targeted, at most one embedding lookup for personal continuity cues; never a model rewrite. */
const relevantKinds = ["important_relationships", "current_focus"] as const;
const continuityCue = /记得|记不记|上次|之前|以前|过去|曾经|聊过|说过|约定|答应|共同|一起|我们|咱们|后来|进展|那件事|那天|前几天|最近|还记|继续|我的(朋友|家人|孩子|女儿|儿子|同事|对象)|咱俩|你还|你说|我说|他(呢|现在)|她(呢|现在)/;
const MAX_QUERY_CHARS = 360;
const MAX_RELEVANT_MEMORIES = 3;

export function relevantMemoryQuery(query: string, recentMessages: readonly {role: string; text: string}[]): string | undefined {
  const current = query.trim();
  if (!current || current.length < 3 || !continuityCue.test(current)) return undefined;
  // A short anaphoric reply needs its nearest user topic, not the assistant's invented narrative.
  const shortFollowUp = current.length <= 20 && /^(那|这|他|她|后来|然后|我们|咱们|上次|之前|继续|还记)/.test(current);
  const previous = shortFollowUp ? recentMessages.filter(message => message.role === "user").at(-1)?.text.trim() : undefined;
  return [previous?.slice(0, 160), current].filter(Boolean).join("；").slice(0, MAX_QUERY_CHARS);
}

export class RelevantMemoryProvider {
  readonly slot = "relevant_memories";
  constructor(private readonly client: Pick<AgentBusinessServices, "searchMemories">) {}

  async build(context: Context): Promise<{slot: string; content: string}> {
    const run = createRunContext.read(context);
    const query = relevantMemoryQuery(run.query, run.recentMessages);
    if (!query) return { slot: this.slot, content: "（本轮无需额外检索）" };
    try {
      const candidates = await this.client.searchMemories({
        userId: run.userId, sessionId: run.sessionId, traceId: run.traceId,
        signal: context.abortSignal, timeZone: run.timeZone,
      }, { query, limit: MAX_RELEVANT_MEMORIES, kinds: relevantKinds });
      if (!candidates.length) return { slot: this.slot, content: "（未检索到相关条目）" };
      return { slot: this.slot, content: JSON.stringify(candidates.map(item => ({
        id: item.memoryId, kind: item.kind, content: item.content.slice(0, 800), updatedAt: item.updatedAt,
      }))) };
    } catch (error) {
      if (context.abortSignal?.aborted) throw error;
      return { slot: this.slot, content: "（相关记忆暂不可用）" };
    }
  }
}
