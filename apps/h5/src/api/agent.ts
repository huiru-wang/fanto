import { authorizedFetch } from "../auth/test-session";
import { ApiError, requestJson } from "./http";

export type PresentedMedia = {
  mediaId: string;
  mediaType: "image" | "audio";
  mimeType: string;
  width?: number;
  height?: number;
  durationMs?: number;
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

export type ToolPresentation = {
  visible: boolean;
  displayContent: string;
  animation?: "thinking" | "searching" | "working";
};

export type AgentMessageBlock =
  | { type: "text"; content: string }
  | { type: "user_input_response"; interactionId: string; content: string }
  | { type: "activity"; toolCallId: string; status: "running" | "succeeded" | "failed"; presentation: ToolPresentation }
  | { type: "media"; items: PresentedMedia[] }
  | { type: "user_input"; request: PresentedUserInputRequest };

export type AgentHistoryMessage = {
  id: string;
  role: "user" | "assistant";
  blocks: AgentMessageBlock[];
  state?: "stopped";
};

type HistoryResult = {
  hasMore: boolean;
  nextCursor: number | null;
  running: boolean;
  stopping?: boolean;
  restored?: boolean;
  messages: AgentHistoryMessage[];
};

export type AgentStreamEvent =
  | { type: "finalizing" }
  | { type: "processing" }
  | { type: "message_start" }
  | { type: "message_end" }
  | { type: "delta"; text: string }
  | { type: "tool_start"; toolCallId: string; presentation: ToolPresentation }
  | { type: "tool_end"; toolCallId: string; status: "succeeded" | "failed"; presentation: ToolPresentation }
  | { type: "media"; items: PresentedMedia[] }
  | { type: "user_input"; request: PresentedUserInputRequest }
  | { type: "stopped" }
  | { type: "done" }
  | { type: "error"; message: string };

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

function extractToolPresentation(value: unknown): ToolPresentation {
  const root = record(value);
  const animation = root?.animation;
  return {
    visible: root?.visible === true,
    displayContent: typeof root?.displayContent === "string" ? root.displayContent : "",
    ...(animation === "thinking" || animation === "searching" || animation === "working" ? { animation } : {}),
  };
}

export type DefaultFantoSession = { sessionId: string; agentId: "main"; scopeKey: string };

export async function getDefaultMainSession(signal?: AbortSignal): Promise<DefaultFantoSession> {
  return requestJson<DefaultFantoSession>("/api/agent/main-session", { headers: agentHeaders(), signal });
}

export async function stopAgentSession(sessionId: string): Promise<{ stopping: boolean }> {
  return requestJson(`/api/agent/sessions/${encodeURIComponent(sessionId)}/stop`, {method:"POST",headers:agentHeaders(),signal:AbortSignal.timeout(25_000)});
}

export async function fetchAgentSnapshot(sessionId: string, cursor?: number): Promise<HistoryResult> {
  const paging = cursor === undefined ? "" : `&cursor=${cursor}`;
  return requestJson<HistoryResult>(`/api/agent/sessions/${encodeURIComponent(sessionId)}/history?limit=50${paging}`, { headers: agentHeaders() });
}

export async function fetchAgentHistory(sessionId: string): Promise<AgentHistoryMessage[]> {
  return (await fetchAgentSnapshot(sessionId)).messages;
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
    body: JSON.stringify({ sessionId, message }),
    signal,
  });
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null) as { error?: string; errorCode?: string; errorMsg?: string } | null;
    throw new ApiError(payload?.errorMsg ?? payload?.error ?? `Agent request failed (${response.status})`, response.status, payload?.errorCode);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal = false;
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
      case "finalizing":
        onEvent({ type: "finalizing" });
        break;
      case "turn_start":
        onEvent({ type: "processing" });
        break;
      case "message_start":
        onEvent({ type: "message_start" });
        break;
      case "message_end":
        onEvent({ type: "message_end" });
        break;
      case "tool_start": {
        const payload = JSON.parse(rawData) as { toolCallId?: string; presentation?: unknown };
        if (payload.toolCallId) onEvent({ type: "tool_start", toolCallId: payload.toolCallId, presentation: extractToolPresentation(payload.presentation) });
        break;
      }
      case "tool_end": {
        const payload = JSON.parse(rawData) as { toolCallId?: string; toolName?: string; status?: string; presentation?: unknown; result?: unknown };
        const status = payload.status === "failed" ? "failed" : "succeeded";
        if (payload.toolCallId) onEvent({ type: "tool_end", toolCallId: payload.toolCallId, status, presentation: extractToolPresentation(payload.presentation) });
        if (payload.toolName === "present_media" && status === "succeeded") {
          const items = extractPresentedMedia(payload.result);
          if (items.length > 0) onEvent({ type: "media", items });
        }
        if (payload.toolName === "collect_user_input" && status === "succeeded") {
          const request = extractUserInputRequest(payload.result);
          if (request) onEvent({ type: "user_input", request });
        }
        break;
      }
      case "delta": {
        const payload = JSON.parse(rawData) as { text?: string };
        if (payload.text) onEvent({ type: "delta", text: payload.text });
        break;
      }
      case "stopped":
        terminal = true;
        onEvent({type:"stopped"});
        break;
      case "done":
        terminal = true;
        onEvent({ type: "done" });
        break;
      case "error": {
        terminal = true;
        const payload = JSON.parse(rawData) as { error?: string };
        onEvent({ type: "error", message: payload.error ?? "这次回复没有完成。" });
        break;
      }
    }
  };

  try {
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {if (terminal) break;deliver(block);}
    if (terminal) break;
    if (done) {
      if (buffer.trim()) deliver(buffer);
      break;
    }
  }
  } finally { void reader.cancel().catch(() => {});reader.releaseLock(); }
  if (!terminal) throw new Error("回复连接已中断，请检查历史后重试。");
}
