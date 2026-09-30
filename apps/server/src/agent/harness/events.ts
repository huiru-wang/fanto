import type { AgentHarness, ExecutionToolContext } from "@earendil-works/pi-agent-core";
import { sanitizePresentMediaDetails, type PresentMediaDetails } from "../tools/media.js";
import { sanitizeCreateTaskDetails, type CreateTaskPresentation } from "../tools/task-management.js";
import { sanitizeUserInputRequestDetails, type UserInputRequestDetails } from "../tools/user-input.js";
import type { RunData } from "../context/run-context.js";
import { resolveToolPresentation, type ToolPresentation } from "../presentation.js";
import type { FantoTool } from "../tools/types.js";

export type AgentStreamEvent =
  | { type: "turn_start" }
  | { type: "message_start" }
  | { type: "message_end" }
  | { type: "tool_start"; toolCallId: string; toolName: string; presentation: ToolPresentation }
  | { type: "tool_end"; toolCallId: string; toolName: string; status: "succeeded" | "failed"; presentation: ToolPresentation; result?: PresentMediaDetails | CreateTaskPresentation | UserInputRequestDetails }
  | { type: "delta"; text: string };

export function subscribeHarnessEvents(
  harness: AgentHarness<ExecutionToolContext>,
  tools: readonly FantoTool[],
  data: RunData,
  query: string,
  emit: (event: AgentStreamEvent) => Promise<void>,
  isAborted: () => boolean,
  appendOutput: (text: string) => void,
): () => void {
  const toolsByName = new Map(tools.map(tool => [tool.name, tool]));
  const presentationFor = (toolName: string) => toolsByName.get(toolName)?.presentation ?? { visible: false } as const;
  const unsubscribes = [
    harness.events.on("turn_start", async () => { if (!isAborted()) await emit({ type: "turn_start" }); }),
    harness.events.on("message_start", async ({ message }) => {
      if (!isAborted() && message.role === "assistant") await emit({ type: "message_start" });
    }),
    harness.events.on("message_end", async ({ message }) => {
      if (!isAborted() && message.role === "assistant") await emit({ type: "message_end" });
    }),
    harness.events.on("tool_start", async event => {
      if (isAborted()) return;
      await emit({
        type: "tool_start",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        presentation: resolveToolPresentation(presentationFor(event.toolName), "start"),
      });
    }),
    harness.events.on("tool_end", async event => {
      if (isAborted()) return;
      const result = event.isError
        ? undefined
        : event.toolName === "present_media"
          ? sanitizePresentMediaDetails(event.result.details)
          : event.toolName === "create_task"
            ? sanitizeCreateTaskDetails(event.result.details)
            : event.toolName === "collect_user_input"
              ? sanitizeUserInputRequestDetails(event.result.details)
              : undefined;
      const status = event.isError ? "failed" : "succeeded";
      await emit({
        type: "tool_end",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status,
        presentation: resolveToolPresentation(presentationFor(event.toolName), "end", status),
        ...(result ? { result } : {}),
      });
    }),
    harness.events.on("message_update", async ({ event }) => {
      if (event.type !== "text_delta" || isAborted()) return;
      appendOutput(event.delta);
      await emit({ type: "delta", text: event.delta });
    }),
    harness.events.on("entry_added", async ({ entry }) => {
      if (data.sourceMessageId || entry.type !== "message" || entry.message.role !== "user") return;
      if (messageText(entry.message) === query) data.sourceMessageId = entry.id;
    }),
    harness.events.on("run_start", async () => {}),
    harness.events.on("run_resume", async () => {}),
    harness.events.on("run_suspend", async () => {}),
    harness.events.on("run_end", async () => {}),
    harness.events.on("operation_abort", async () => {}),
    harness.events.on("fault", async () => {}),
    harness.events.on("handler_error", async () => {}),
    harness.events.on("turn_end", async () => {}),
  ];
  return () => unsubscribes.forEach(unsubscribe => unsubscribe());
}

export function messageText(message: { content: unknown }): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content.flatMap(block => {
    if (!block || typeof block !== "object") return [];
    const value = block as { type?: unknown; text?: unknown };
    return value.type === "text" && typeof value.text === "string" ? [value.text] : [];
  }).join("\n");
}
