import { FANTO_AGENT_ID, FANTO_AGENT_TOKEN, FANTO_USER_ID } from "../config";
import { ApiError, requestJson } from "./http";

export type PresentedMedia = {
  mediaId: string;
  mediaType: "image" | "audio";
  mimeType: string;
  width?: number;
  height?: number;
  durationMs?: number;
};

export type AgentHistoryMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  media: PresentedMedia[];
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
  | { type: "done" }
  | { type: "error"; message: string };

function agentHeaders(): Headers {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${FANTO_AGENT_TOKEN}`);
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  headers.set("X-User-Id", FANTO_USER_ID);
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

export function extractPresentedMedia(value: unknown): PresentedMedia[] {
  const details = record(value);
  if (!details || !Array.isArray(details.items)) return [];

  return details.items.flatMap((item): PresentedMedia[] => {
    const media = record(item);
    if (!media || typeof media.mediaId !== "string" || typeof media.mimeType !== "string") return [];
    if (media.mediaType !== "image" && media.mediaType !== "audio") return [];

    const output: PresentedMedia = {
      mediaId: media.mediaId,
      mediaType: media.mediaType,
      mimeType: media.mimeType,
    };
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

export function projectAgentHistory(entries: HistoryEntry[]): AgentHistoryMessage[] {
  const messages: AgentHistoryMessage[] = [];
  let assistantId: string | null = null;
  let assistantText = "";
  let assistantMedia: PresentedMedia[] = [];

  const flushAssistant = () => {
    const text = assistantText.trim();
    if (text || assistantMedia.length > 0) {
      messages.push({
        id: assistantId ?? `history-assistant-${messages.length}`,
        role: "assistant",
        text,
        media: assistantMedia,
      });
    }
    assistantId = null;
    assistantText = "";
    assistantMedia = [];
  };

  for (const entry of [...entries].reverse()) {
    const message = record(entry.message);
    if (!message || typeof message.role !== "string") continue;

    if (message.role === "user") {
      flushAssistant();
      const text = extractMessageText(message.content).trim();
      if (text) messages.push({ id: entry.id, role: "user", text, media: [] });
      continue;
    }

    if (message.role === "assistant") {
      assistantId = entry.id;
      assistantText += extractMessageText(message.content);
      continue;
    }

    if (
      message.role === "toolResult"
      && message.toolName === "present_media"
      && message.isError !== true
    ) {
      const items = extractPresentedMedia(message.details);
      if (items.length > 0) {
        assistantId ??= entry.id;
        assistantMedia = mergePresentedMedia(assistantMedia, items);
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
  const result = await requestJson<HistoryResult>(
    `/api/agent/sessions/${encodeURIComponent(sessionId)}/history?limit=100`,
    { headers: agentHeaders() },
  );
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

  const response = await fetch("/api/agent/stream", {
    method: "POST",
    headers,
    body: JSON.stringify({
      agentId: FANTO_AGENT_ID,
      sessionId,
      message,
    }),
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
        const payload = JSON.parse(rawData) as {
          toolName?: string;
          status?: string;
          result?: unknown;
        };
        if (payload.toolName === "present_media" && payload.status === "succeeded") {
          const items = extractPresentedMedia(payload.result);
          if (items.length > 0) onEvent({ type: "presentation", items });
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
