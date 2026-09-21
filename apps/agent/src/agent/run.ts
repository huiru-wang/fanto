import { TODO_CONTEXT, type AgentHarness, type AgentLane, type ExecutionToolContext } from "@earendil-works/pi-agent-core";
import { composePrompt, hasContextSlots } from "../context/composer.js";
import type { ContextRuntime } from "../context/runtime.js";
import type { ContextMessage } from "../context/types.js";
import { sanitizePresentMediaDetails, type PresentMediaDetails } from "../tools/media.js";
import { createRunContext, type RunMetadata } from "./run-context.js";

export type AgentStreamEvent =
  | { type: "turn_start" }
  | { type: "tool_start"; toolCallId: string; toolName: string }
  | { type: "tool_end"; toolCallId: string; toolName: string; status: "succeeded" | "failed"; result?: PresentMediaDetails }
  | { type: "delta"; text: string };

export type RunSession = {
  id: string;
  userId: string;
  harness: AgentHarness<ExecutionToolContext>;
  lane: AgentLane;
  systemPromptTemplate: string;
};

export async function runAgent(
  session: RunSession,
  message: string,
  signal: AbortSignal,
  metadata: Pick<RunMetadata, "taskId" | "traceId" | "timeZone">,
  contextRuntime: ContextRuntime | undefined,
  emit: (event: AgentStreamEvent) => Promise<void>,
): Promise<string> {
  const unsubscribes: Array<() => void> = [];
  let output = "";
  const abort = () => { void session.lane.abort(TODO_CONTEXT).catch(() => {}); };

  try {
    signal.addEventListener("abort", abort, { once: true });
    signal.throwIfAborted();

    unsubscribes.push(session.harness.events.on("turn_start", async () => {
      if (!signal.aborted) await emit({ type: "turn_start" });
    }));
    unsubscribes.push(session.harness.events.on("tool_start", async event => {
      if (!signal.aborted) await emit({ type: "tool_start", toolCallId: event.toolCallId, toolName: event.toolName });
    }));
    unsubscribes.push(session.harness.events.on("tool_end", async event => {
      if (signal.aborted) return;
      const result = !event.isError && event.toolName === "present_media"
        ? sanitizePresentMediaDetails(event.result.details)
        : undefined;
      await emit({
        type: "tool_end",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: event.isError ? "failed" : "succeeded",
        ...(result ? { result } : {}),
      });
    }));
    unsubscribes.push(session.harness.events.on("message_update", async ({ event }) => {
      if (event.type !== "text_delta" || signal.aborted) return;
      output += event.delta;
      await emit({ type: "delta", text: event.delta });
    }));

    const recentMessages = await readRecentMessages(session.lane);
    const contextInput = {
      userId: session.userId,
      sessionId: session.id,
      message,
      recentMessages,
      signal,
      traceId: metadata.traceId,
      timeZone: metadata.timeZone,
    };
    const fragments = contextRuntime && hasContextSlots(session.systemPromptTemplate)
      ? await contextRuntime.build(contextInput)
      : undefined;
    const systemPrompt = fragments
      ? composePrompt(session.systemPromptTemplate, fragments)
      : session.systemPromptTemplate;
    if (fragments) {
      console.log("[context] dynamic fragments", fragments);
      console.log("[context] composed system prompt\n%s", systemPrompt);
    }

    signal.throwIfAborted();
    const runMetadata: RunMetadata = {
      userId: session.userId,
      ...metadata,
      sessionId: session.id,
      currentMessage: message,
      systemPrompt,
    };
    unsubscribes.push(session.harness.events.on("entry_added", async ({ entry }) => {
      if (runMetadata.sourceMessageId || entry.type !== "message" || entry.message.role !== "user") return;
      if (messageText(entry.message) === message) runMetadata.sourceMessageId = entry.id;
    }));

    const result = await session.lane.prompt(message, undefined, createRunContext(runMetadata));
    signal.throwIfAborted();
    if (!result.ok || result.value.status !== "completed") throw new Error("Agent run did not complete");
    return output;
  } finally {
    signal.removeEventListener("abort", abort);
    unsubscribes.forEach(unsubscribe => unsubscribe());
  }
}

async function readRecentMessages(lane: AgentLane): Promise<ContextMessage[]> {
  const entries = await lane.findEntries({ type: "message", order: "newestFirst", limit: 12 }, TODO_CONTEXT);
  return entries.reverse().flatMap(entry => {
    if (entry.type !== "message" || (entry.message.role !== "user" && entry.message.role !== "assistant")) return [];
    const text = messageText(entry.message).trim();
    return text ? [{ role: entry.message.role, text } as ContextMessage] : [];
  }).slice(-8);
}

function messageText(message: { content: unknown }): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content.flatMap(block => {
    if (!block || typeof block !== "object") return [];
    const value = block as { type?: unknown; text?: unknown };
    return value.type === "text" && typeof value.text === "string" ? [value.text] : [];
  }).join("\n");
}
