import type { Entry } from "@earendil-works/pi-agent-core";
import { sanitizePresentMediaDetails, type PresentMediaDetails } from "./tools/media.js";
import { sanitizeCreateTaskDetails, type CreateTaskPresentation } from "./tools/task-management.js";
import { sanitizeUserInputRequestDetails, type UserInputRequestDetails } from "./tools/user-input.js";
import type { FantoTool, ToolPresentationAnimation, ToolPresentationConfig } from "./tools/types.js";

export type ToolPresentation = {
  visible: boolean;
  displayContent: string;
  animation?: ToolPresentationAnimation;
};

export type ToolStatus = "succeeded" | "failed";

export type AgentHistoryBlock =
  | { type: "text"; content: string }
  | { type: "user_input_response"; interactionId: string; content: string }
  | { type: "activity"; toolCallId: string; status: ToolStatus; presentation: ToolPresentation }
  | { type: "media"; items: PresentMediaDetails["items"] }
  | { type: "task"; task: CreateTaskPresentation["task"] }
  | { type: "user_input"; request: UserInputRequestDetails & { resolved: boolean } };

export type AgentHistoryMessagePresentation = {
  id: string;
  role: "user" | "assistant";
  blocks: AgentHistoryBlock[];
  state?: "stopped";
};

const USER_INPUT_RESPONSE = /^\[\[fanto-user-input:([^\]]+)\]\]\s*\n?/;
const HIDDEN_PRESENTATION: ToolPresentationConfig = { visible: false };

export function resolveToolPresentation(
  config: ToolPresentationConfig,
  phase: "start" | "end",
  status: ToolStatus = "succeeded",
): ToolPresentation {
  if (!config.visible) return { visible: false, displayContent: "" };
  if (phase === "start") return { visible: true, ...config.start };
  return {
    visible: true,
    ...(status === "failed" ? config.failed : config.succeeded),
  };
}

export function projectHistory(entries: Entry[], tools: readonly FantoTool[]): AgentHistoryMessagePresentation[] {
  const ordered = [...entries].reverse();
  const toolsByName = new Map(tools.map(tool => [tool.name, tool]));
  const resolvedInputs = new Set<string>();

  for (const entry of ordered) {
    if (entry.type !== "message" || entry.message.role !== "user") continue;
    const response = parseUserInputResponse(messageText(entry.message));
    if (response) resolvedInputs.add(response.interactionId);
  }

  const messages: AgentHistoryMessagePresentation[] = [];
  let assistantId: string | null = null;
  let assistantBlocks: AgentHistoryBlock[] = [];
  let assistantStopped = false;

  const flushAssistant = () => {
    if (assistantBlocks.length > 0 || assistantStopped) {
      messages.push({
        id: assistantId ?? `history-assistant-${messages.length}`,
        role: "assistant",
        blocks: assistantBlocks,
        ...(assistantStopped ? {state:"stopped" as const} : {}),
      });
    }
    assistantId = null;
    assistantBlocks = [];
    assistantStopped = false;
  };

  for (const entry of ordered) {
    if (entry.type === "custom" && entry.customType === "fanto.run_stopped") {
      assistantId ??= entry.id;
      assistantStopped=true;
      continue;
    }
    if (entry.type !== "message") continue;
    const message = entry.message;

    if (message.role === "user") {
      flushAssistant();
      const rawText = messageText(message).trim();
      const response = parseUserInputResponse(rawText);
      const text = (response?.visibleText ?? rawText).trim();
      if (text) {
        messages.push({
          id: entry.id,
          role: "user",
          blocks: [response
            ? { type: "user_input_response", interactionId: response.interactionId, content: text }
            : { type: "text", content: text }],
        });
      }
      continue;
    }

    if (message.role === "assistant") {
      if (message.stopReason === "aborted") {assistantStopped=true;assistantId ??= entry.id;}
      const text = messageText(message).trim();
      if (text) {
        assistantId ??= entry.id;
        assistantBlocks.push({ type: "text", content: text });
      }
      continue;
    }

    if (message.role !== "toolResult") continue;
    assistantId ??= entry.id;

    if (message.toolName === "present_media" && message.isError !== true) {
      const media = sanitizePresentMediaDetails(message.details);
      if (media?.items.length) assistantBlocks.push({ type: "media", items: media.items });
      continue;
    }

    if (message.toolName === "create_task" && message.isError !== true) {
      const task = sanitizeCreateTaskDetails(message.details);
      if (task) assistantBlocks.push({ type: "task", task: task.task });
      continue;
    }

    if (message.toolName === "collect_user_input" && message.isError !== true) {
      const request = sanitizeUserInputRequestDetails(message.details);
      if (request) {
        assistantBlocks.push({
          type: "user_input",
          request: { ...request, resolved: resolvedInputs.has(request.interactionId) },
        });
      }
      continue;
    }

    const status: ToolStatus = message.isError ? "failed" : "succeeded";
    const presentation = resolveToolPresentation(toolsByName.get(message.toolName)?.presentation ?? HIDDEN_PRESENTATION, "end", status);
    if (presentation.visible) {
      assistantBlocks.push({
        type: "activity",
        toolCallId: message.toolCallId,
        status,
        presentation,
      });
    }
  }

  flushAssistant();
  return messages;
}

function parseUserInputResponse(text: string): { interactionId: string; visibleText: string } | null {
  const match = text.match(USER_INPUT_RESPONSE);
  if (!match) return null;
  return { interactionId: match[1]!, visibleText: text.replace(USER_INPUT_RESPONSE, "").trim() };
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
