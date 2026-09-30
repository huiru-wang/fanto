import { FANTO_AGENT_ID } from "../config";
import { authorizedFetch } from "../auth/test-session";
import { ApiError, requestJson } from "./http";
import type { TaskOutput, TaskTrigger } from "./tasks";

export type PresentedMedia = {
  mediaId: string;
  mediaType: "image" | "audio";
  mimeType: string;
  width?: number;
  height?: number;
  durationMs?: number;
};

export type PresentedTask = {
  taskId: string;
  title: string;
  status: "active";
  trigger: TaskTrigger;
  nextRunAt: string;
  output: TaskOutput;
};

export type UserInputOption = { value: string; label: string };
export type UserInputQuestion =
  | { id: string; type: "single_select"; label: string; options: UserInputOption[]; allowOther?: boolean }
  | { id: string; type: "multi_select"; label: string; options: UserInputOption[]; allowOther?: boolean }
  | { id: string; type: "text"; label: string; placeholder?: string; multiline?: boolean };

export type PresentedUserInputRequest = {
  interactionId: string;
  title: string;
  description?: string;
  questions: UserInputQuestion[];
  resolved: boolean;
};

export type AgentHistoryMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  media: PresentedMedia[];
  tasks: PresentedTask[];
  inputRequests: PresentedUserInputRequest[];
};

type HistoryEntry = {
  id: string;
  message?: unknown;
};

type HistoryResult = {
  data: HistoryEntry[];
};

export type AgentStreamEvent =
  | { type: "processing" }
  | { type: "delta"; text: string }
  | { type: "presentation"; items: PresentedMedia[] }
  | { type: "task_created"; task: PresentedTask }
  | { type: "user_input_requested"; request: PresentedUserInputRequest }
  | { type: "done" }
  | { type: "error"; message: string };

const USER_INPUT_RESPONSE = /^\[\[fanto-user-input:([^\]]+)\]\]\s*\n?/;

function agentHeaders(): Headers {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  headers.set("X-Trace-Id", crypto.randomUUID());
  headers.set("X-Time-Zone", Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  return headers;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === "string") return part;
        const value = record(part);
        return value?.type === "text" && typeof value.text === "string" ? value.text : "";
      })
      .join("");
  }
  const value = record(content);
  return typeof value?.text === "string" ? value.text : "";
}

function userInputResponse(text: string): { interactionId: string; visibleText: string } | null {
  const match = text.match(USER_INPUT_RESPONSE);
  if (!match) return null;
  return { interactionId: match[1]!, visibleText: text.replace(USER_INPUT_RESPONSE, "").trim() };
}

export function encodeUserInputResponse(interactionId: string, visibleText: string): string {
  return `[[fanto-user-input:${interactionId}]]\n${visibleText.trim()}`;
}

export function extractPresentedMedia(value: unknown): PresentedMedia[] {
  const details = record(value);
  if (!details || !Array.isArray(details.items)) return [];
  return details.items.flatMap((item): PresentedMedia[] => {
    const media = record(item);
    if (!media || typeof media.mediaId !== "string" || typeof media.mimeType !== "string") return [];
    if (media.mediaType !== "image" && media.mediaType !== "audio") return [];
    const output: PresentedMedia = { mediaId: media.mediaId, mediaType: media.mediaType, mimeType: media.mimeType };
    const width = positiveInt(media.width);
    const height = positiveInt(media.height);
    const durationMs = positiveInt(media.durationMs);
    if (width) output.width = width;
    if (height) output.height = height;
    if (durationMs) output.durationMs = durationMs;
    return [output];
  });
}

export function mergePresentedMedia(current: PresentedMedia[], incoming: PresentedMedia[]): PresentedMedia[] {
  if (incoming.length === 0) return current;
  const seen = new Set(current.map(item => item.mediaId));
  const merged = [...current];
  for (const item of incoming) {
    if (seen.has(item.mediaId)) continue;
    seen.add(item.mediaId);
    merged.push(item);
  }
  return merged;
}

export function extractPresentedTask(value: unknown): PresentedTask | null {
  const root = record(value);
  if (!root || root.kind !== "task_created") return null;
  const task = record(root.task);
  const output = record(task?.output);
  const trigger = record(task?.trigger);
  if (!task || typeof task.taskId !== "string" || typeof task.title !== "string" || task.status !== "active"
    || typeof task.nextRunAt !== "string" || !output || !trigger) return null;
  if (output.format !== "markdown" && output.format !== "text" && output.format !== "html") return null;
  if (trigger.type !== "immediate" && trigger.type !== "scheduled") return null;
  return {
    taskId: task.taskId,
    title: task.title,
    status: "active",
    trigger: task.trigger as TaskTrigger,
    nextRunAt: task.nextRunAt,
    output: { format: output.format },
  };
}

export function mergePresentedTasks(current: PresentedTask[], incoming: PresentedTask[]): PresentedTask[] {
  if (incoming.length === 0) return current;
  const seen = new Set(current.map(item => item.taskId));
  const merged = [...current];
  for (const item of incoming) {
    if (seen.has(item.taskId)) continue;
    seen.add(item.taskId);
    merged.push(item);
  }
  return merged;
}

export function extractUserInputRequest(value: unknown): PresentedUserInputRequest | null {
  const root = record(value);
  if (!root || root.kind !== "user_input_requested" || typeof root.interactionId !== "string" || typeof root.title !== "string" || !Array.isArray(root.questions)) return null;
  const questions: UserInputQuestion[] = [];
  for (const raw of root.questions) {
    const question = record(raw);
    if (!question || typeof question.id !== "string" || typeof question.label !== "string") return null;
    if (question.type === "text") {
      questions.push({
        id: question.id,
        type: "text",
        label: question.label,
        ...(typeof question.placeholder === "string" ? { placeholder: question.placeholder } : {}),
        ...(typeof question.multiline === "boolean" ? { multiline: question.multiline } : {}),
      });
      continue;
    }
    if ((question.type !== "single_select" && question.type !== "multi_select") || !Array.isArray(question.options)) return null;
    const options = question.options.flatMap(rawOption => {
      const option = record(rawOption);
      return option && typeof option.value === "string" && typeof option.label === "string"
        ? [{ value: option.value, label: option.label }]
        : [];
    });
    if (options.length !== question.options.length) return null;
    questions.push({
      id: question.id,
      type: question.type,
      label: question.label,
      options,
      ...(typeof question.allowOther === "boolean" ? { allowOther: question.allowOther } : {}),
    });
  }
  return {
    interactionId: root.interactionId,
    title: root.title,
    ...(typeof root.description === "string" ? { description: root.description } : {}),
    questions,
    resolved: false,
  };
}

export function mergeUserInputRequests(current: PresentedUserInputRequest[], incoming: PresentedUserInputRequest[]): PresentedUserInputRequest[] {
  const seen = new Set(current.map(item => item.interactionId));
  return [...current, ...incoming.filter(item => !seen.has(item.interactionId))];
}

export function projectAgentHistory(entries: HistoryEntry[]): AgentHistoryMessage[] {
  const ordered = [...entries].reverse();
  const resolved = new Set<string>();
  for (const entry of ordered) {
    const message = record(entry.message);
    if (message?.role !== "user") continue;
    const response = userInputResponse(extractMessageText(message.content));
    if (response) resolved.add(response.interactionId);
  }

  const messages: AgentHistoryMessage[] = [];
  let assistantId: string | null = null;
  let assistantText = "";
  let assistantMedia: PresentedMedia[] = [];
  let assistantTasks: PresentedTask[] = [];
  let assistantInputs: PresentedUserInputRequest[] = [];

  const flushAssistant = () => {
    const text = assistantText.trim();
    if (text || assistantMedia.length > 0 || assistantTasks.length > 0 || assistantInputs.length > 0) {
      messages.push({ id: assistantId ?? `history-assistant-${messages.length}`, role: "assistant", text, media: assistantMedia, tasks: assistantTasks, inputRequests: assistantInputs });
    }
    assistantId = null;
    assistantText = "";
    assistantMedia = [];
    assistantTasks = [];
    assistantInputs = [];
  };

  for (const entry of ordered) {
    const message = record(entry.message);
    if (!message || typeof message.role !== "string") continue;

    if (message.role === "user") {
      flushAssistant();
      const rawText = extractMessageText(message.content).trim();
      const response = userInputResponse(rawText);
      const text = (response?.visibleText ?? rawText).trim();
      if (text) messages.push({ id: entry.id, role: "user", text, media: [], tasks: [], inputRequests: [] });
      continue;
    }

    if (message.role === "assistant") {
      assistantId = entry.id;
      assistantText += extractMessageText(message.content);
      continue;
    }

    if (message.role === "toolResult" && message.toolName === "present_media" && message.isError !== true) {
      const items = extractPresentedMedia(message.details);
      if (items.length > 0) {
        assistantId ??= entry.id;
        assistantMedia = mergePresentedMedia(assistantMedia, items);
      }
    }

    if (message.role === "toolResult" && message.toolName === "create_task" && message.isError !== true) {
      const task = extractPresentedTask(message.details);
      if (task) {
        assistantId ??= entry.id;
        assistantTasks = mergePresentedTasks(assistantTasks, [task]);
      }
    }

    if (message.role === "toolResult" && message.toolName === "collect_user_input" && message.isError !== true) {
      const request = extractUserInputRequest(message.details);
      if (request) {
        assistantId ??= entry.id;
        assistantInputs = mergeUserInputRequests(assistantInputs, [{ ...request, resolved: resolved.has(request.interactionId) }]);
      }
    }
  }

  flushAssistant();
  return messages;
}

export async function createAgentSession(): Promise<string> {
  const result = await requestJson<{ sessionId: string }>("/api/agent/sessions", {
    method: "POST",
    headers: agentHeaders(),
    body: JSON.stringify({ agentId: FANTO_AGENT_ID }),
  });
  return result.sessionId;
}

export async function fetchAgentHistory(sessionId: string): Promise<AgentHistoryMessage[]> {
  const result = await requestJson<HistoryResult>(`/api/agent/sessions/${encodeURIComponent(sessionId)}/history?limit=100`, { headers: agentHeaders() });
  return projectAgentHistory(result.data);
}

export async function streamAgentMessage(
  sessionId: string,
  message: string,
  onEvent: (event: AgentStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const headers = agentHeaders();
  headers.set("Accept", "text/event-stream");
  const response = await authorizedFetch("/api/agent/stream", {
    method: "POST",
    headers,
    body: JSON.stringify({ agentId: FANTO_AGENT_ID, sessionId, message }),
    signal,
  });
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new ApiError(payload?.error ?? `Agent request failed (${response.status})`, response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deliver = (block: string) => {
    if (!block.trim() || block.startsWith(":")) return;
    let eventName = "";
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    const rawData = data.join("\n");
    switch (eventName) {
      case "turn_start":
      case "tool_start":
        onEvent({ type: "processing" });
        break;
      case "tool_end": {
        const payload = JSON.parse(rawData) as { toolName?: string; status?: string; result?: unknown };
        if (payload.toolName === "present_media" && payload.status === "succeeded") {
          const items = extractPresentedMedia(payload.result);
          if (items.length > 0) onEvent({ type: "presentation", items });
        }
        if (payload.toolName === "create_task" && payload.status === "succeeded") {
          const task = extractPresentedTask(payload.result);
          if (task) onEvent({ type: "task_created", task });
        }
        if (payload.toolName === "collect_user_input" && payload.status === "succeeded") {
          const request = extractUserInputRequest(payload.result);
          if (request) onEvent({ type: "user_input_requested", request });
        }
        break;
      }
      case "delta": {
        const payload = JSON.parse(rawData) as { text?: string };
        if (payload.text) onEvent({ type: "delta", text: payload.text });
        break;
      }
      case "done":
        onEvent({ type: "done" });
        break;
      case "error": {
        const payload = JSON.parse(rawData) as { error?: string };
        onEvent({ type: "error", message: payload.error ?? "这次回复没有完成。" });
        break;
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    blocks.forEach(deliver);
    if (done) {
      if (buffer.trim()) deliver(buffer);
      break;
    }
  }
}
