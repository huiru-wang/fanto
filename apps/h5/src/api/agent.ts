import { FANTO_AGENT_ID, FANTO_AGENT_TOKEN, FANTO_USER_ID } from "../config";
import { ApiError, requestJson } from "./http";

export type AgentHistoryMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type HistoryEntry = {
  id: string;
  message?: {
    role?: string;
    content?: unknown;
  };
};

type HistoryResult = {
  data: HistoryEntry[];
};

export type AgentStreamEvent =
  | { type: "processing" }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

function agentHeaders(): Headers {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${FANTO_AGENT_TOKEN}`);
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  headers.set("X-User-Id", FANTO_USER_ID);
  headers.set("X-Trace-Id", crypto.randomUUID());
  return headers;
}

export function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return "";
        const value = part as { type?: unknown; text?: unknown };
        return value.type === "text" && typeof value.text === "string" ? value.text : "";
      })
      .join("");
  }

  if (content && typeof content === "object") {
    const text = (content as { text?: unknown }).text;
    return typeof text === "string" ? text : "";
  }

  return "";
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

  return result.data
    .flatMap((entry): AgentHistoryMessage[] => {
      const role = entry.message?.role;
      const text = extractMessageText(entry.message?.content).trim();
      if ((role !== "user" && role !== "assistant") || !text) return [];
      return [{ id: entry.id, role, text }];
    })
    .reverse();
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
